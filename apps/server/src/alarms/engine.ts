import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { LatestValue } from '@perspice/shared';
import { and, eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { alarm, customer, device } from '../db/schema';
import { LATEST_KEY } from '../devices/devices.service';
import { DEVICE_EVENTS_STREAM, type DomainEvent, TELEMETRY_EVENTS_STREAM } from '../events/events';
import { StreamConsumer } from '../events/stream-consumer';
import { AlarmStore } from './alarm-store';
import { type RuleRow, type RuleTarget, effectiveRules } from './effective';
import { type EvalInput, type EvalRule, type RuleState, evaluate } from './evaluator';
import { AlarmRulesService, RULES_VERSION_KEY } from './rules.service';

/** Members are `ruleId:deviceId`, scored by when a duration or no-data timer is due. */
export const TIMERS_KEY = 'alarm:timers';
/** Versioned, so editing a rule starts its evaluation afresh. */
const stateKey = (rule: Pick<RuleRow, 'id' | 'version'>, deviceId: string) => `alarm:state:${rule.id}:${rule.version}:${deviceId}`;
const STATE_TTL_S = 30 * 86_400;
const CONTEXT_TTL_MS = 60_000;

interface DeviceContext {
  target: RuleTarget;
  timezone: string;
  rules: RuleRow[];
  version: string;
  loadedAt: number;
}

/**
 * The rules engine (spec §6.1). In the `rules` role it consumes telemetry and status events;
 * `tick` (scheduler role) fires duration and no-data timers. Per-(rule, device) state lives in
 * Redis; evaluation for one device is serialised with a short lock.
 */
@Injectable()
export class AlarmEngine implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AlarmEngine.name);
  private consumers: StreamConsumer[] = [];
  private readonly contexts = new Map<string, DeviceContext>();

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly rules: AlarmRulesService,
    private readonly store: AlarmStore,
    @Inject('RUN_ALARM_ENGINE') private readonly consume: boolean,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.consume) return;
    // Status changes and telemetry come on separate streams (see TELEMETRY_EVENTS_STREAM).
    this.consumers = [DEVICE_EVENTS_STREAM, TELEMETRY_EVENTS_STREAM].map(
      (stream) => new StreamConsumer(this.redis, { group: 'alarms', stream, handle: (e) => this.handle(e) }),
    );
    for (const c of this.consumers) await c.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.consumers.map((c) => c.stop()));
  }

  async handle(e: DomainEvent): Promise<void> {
    let input: EvalInput;
    if (e.type === 'telemetry') {
      input = { kind: 'telemetry', ts: e.ts, values: await this.valuesOf(e.deviceId, e.keys, e.values) };
    } else if (e.type === 'device.status_changed') {
      input = { kind: 'status', ts: e.ts, status: e.to };
    } else {
      return;
    }
    await this.withDevice(e.deviceId, async (ctx) => {
      for (const rule of ctx.rules) await this.evaluateOne(ctx, rule, input);
    });
  }

  /** Fires due duration and no-data timers. */
  async tick(now = Date.now()): Promise<number> {
    const due = await this.redis.zrangebyscore(TIMERS_KEY, 0, now, 'LIMIT', 0, 1000);
    for (const member of due) {
      const [ruleId, deviceId] = member.split(':') as [string, string];
      await this.withDevice(deviceId, async (ctx) => {
        const rule = ctx.rules.find((r) => r.id === ruleId);
        if (!rule) {
          await this.redis.zrem(TIMERS_KEY, member);
          return;
        }
        await this.evaluateOne(ctx, rule, { kind: 'tick', ts: now });
      }).catch((err: Error) => this.logger.error(`Timer ${member} failed: ${err.message}`));
    }
    return due.length;
  }

  /** Forgets a device's state after an alarm was cleared by hand, so the rule can raise again. */
  async resetState(rule: Pick<RuleRow, 'id' | 'version'>, deviceId: string): Promise<void> {
    await this.redis.del(stateKey(rule, deviceId));
  }

  private async evaluateOne(ctx: DeviceContext, rule: RuleRow, input: EvalInput): Promise<void> {
    const key = stateKey(rule, ctx.target.id);
    const raw = await this.redis.get(key);
    // Without state (new rule version, expiry), start from whether an alarm is actually open.
    const state = raw ? (JSON.parse(raw) as RuleState) : { active: await this.isOpen(rule.id, ctx.target.id) };
    const r = evaluate(rule as unknown as EvalRule, state, input, ctx.timezone);
    if (r.transition === 'raise') {
      await this.store.raise(rule, ctx.target, r.value, r.message ?? rule.name, input.ts);
    } else if (r.transition === 'clear') {
      await this.store.clearOpen(rule, ctx.target.id, r.value, input.ts);
    }
    await this.redis.set(key, JSON.stringify(r.state), 'EX', STATE_TTL_S);
    const due = dueAt(rule, r.state);
    const member = `${rule.id}:${ctx.target.id}`;
    if (due === null) await this.redis.zrem(TIMERS_KEY, member);
    else await this.redis.zadd(TIMERS_KEY, due, member);
  }

  private async isOpen(ruleId: string, deviceId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: alarm.id })
      .from(alarm)
      .where(and(eq(alarm.ruleId, ruleId), eq(alarm.deviceId, deviceId), sql`${alarm.status} <> 'cleared'`))
      .limit(1);
    return !!row;
  }

  private async valuesOf(deviceId: string, keys: string[], values?: Record<string, { ts: number; v: unknown }>): Promise<Record<string, unknown>> {
    if (values) return Object.fromEntries(Object.entries(values).map(([k, x]) => [k, x.v]));
    const raw = keys.length ? await this.redis.hmget(LATEST_KEY(deviceId), ...keys) : [];
    const out: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      if (raw[i]) out[k] = (JSON.parse(raw[i]!) as LatestValue).v;
    });
    return out;
  }

  /** Runs `fn` with the device's rules, one evaluation per device at a time across instances. */
  private async withDevice(deviceId: string, fn: (ctx: DeviceContext) => Promise<void>): Promise<void> {
    const ctx = await this.context(deviceId);
    if (!ctx?.rules.length) return;
    const lock = `lock:alarm:${deviceId}`;
    const token = `${process.pid}-${Math.random()}`;
    for (let i = 0; ; i++) {
      if (await this.redis.set(lock, token, 'PX', 10_000, 'NX')) break;
      if (i > 250) throw new Error(`Device ${deviceId} is busy`);
      await new Promise((r) => setTimeout(r, 20));
    }
    try {
      await fn(ctx);
    } finally {
      if ((await this.redis.get(lock)) === token) await this.redis.del(lock);
    }
  }

  private async context(deviceId: string): Promise<DeviceContext | null> {
    const version = (await this.redis.get(RULES_VERSION_KEY)) ?? '0';
    const cached = this.contexts.get(deviceId);
    if (cached && cached.version === version && Date.now() - cached.loadedAt < CONTEXT_TTL_MS) return cached;
    const [row] = await this.db
      .select({ id: device.id, profileId: device.profileId, customerId: device.customerId, timezone: customer.timezone })
      .from(device)
      .leftJoin(customer, eq(customer.id, device.customerId))
      .where(eq(device.id, deviceId));
    if (!row) {
      this.contexts.delete(deviceId);
      return null;
    }
    const target = { id: row.id, profileId: row.profileId, customerId: row.customerId };
    const ctx = { target, timezone: row.timezone ?? 'UTC', rules: effectiveRules(await this.rules.candidates(target), target), version, loadedAt: Date.now() };
    if (this.contexts.size > 50_000) this.contexts.clear();
    this.contexts.set(deviceId, ctx);
    return ctx;
  }
}

function dueAt(rule: RuleRow, s: RuleState): number | null {
  if (s.active) return null;
  const forS = (rule.condition as { forS?: number }).forS;
  if (rule.type === 'duration' && s.pendingSince !== undefined && forS) return s.pendingSince + forS * 1000;
  if (rule.type === 'no_data_key' && s.lastSeen !== undefined && forS) return s.lastSeen + forS * 1000;
  return null;
}
