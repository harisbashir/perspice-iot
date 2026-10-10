import { Inject, Injectable } from '@nestjs/common';
import { type CalculatedKey, CalculatedKeysSchema, type Expr, type LatestValue, evaluate, inputsOf, parseExpr } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { deviceProfile } from '../db/schema';
import { LATEST_KEY } from '../devices/devices.service';
import type { TelemetryRow } from './normalize';

const PROFILE_TTL_MS = 60_000;
export const calcStateKey = (deviceId: string) => `calc:${deviceId}`;

type Compiled = { def: CalculatedKey; expr?: Expr };
interface ProfileCalc {
  defs: Compiled[];
  names: Set<string>;
  /** Keys formulas read, for the one latest-values read per message. */
  formulaInputs: string[];
  stateful: Compiled[];
  at: number;
}

/** The previous reading a stateful key compares against. */
interface State {
  ts: number;
  v: number | boolean;
}

const valueOf = (r: TelemetryRow): unknown => r.valueNum ?? r.valueStr ?? r.valueBool ?? r.valueJson;
const toRow = (key: string, ts: number, v: number | boolean): TelemetryRow => ({
  key,
  ts,
  valueNum: typeof v === 'number' ? v : null,
  valueStr: null,
  valueBool: typeof v === 'boolean' ? v : null,
  valueJson: null,
});
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null);

/**
 * Calculated telemetry (spec §11): derived keys added to a message's rows before they are
 * written, cached and evaluated, so they behave like any other key. Formulas read the message's
 * values over the device's latest ones; counter, runtime and fuel keys compare with the previous
 * reading kept in `calc:{deviceId}` and only advance on newer timestamps.
 */
@Injectable()
export class CalculatedService {
  private readonly profiles = new Map<string, ProfileCalc>();

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async apply(deviceId: string, profileId: string, rows: TelemetryRow[]): Promise<{ rows: TelemetryRow[]; issues: string[] }> {
    const calc = await this.profileCalc(profileId);
    if (!calc.defs.length) return { rows, issues: [] };
    // A value sent under a calculated key's name is replaced by the calculated one.
    const own = rows.filter((r) => !calc.names.has(r.key));
    const groups = new Map<number, Map<string, unknown>>();
    for (const r of own) {
      const g = groups.get(r.ts) ?? new Map<string, unknown>();
      g.set(r.key, valueOf(r));
      groups.set(r.ts, g);
    }

    const [latest, state] = await Promise.all([this.latestOf(deviceId, calc.formulaInputs), this.stateOf(deviceId, calc.stateful)]);
    const changedState = new Map<string, State>();
    const out: TelemetryRow[] = [];
    const issues: string[] = [];
    for (const ts of [...groups.keys()].sort((a, b) => a - b)) {
      const values = groups.get(ts)!;
      for (const { def, expr } of calc.defs) {
        let v: number | boolean | null = null;
        if (def.kind === 'formula') {
          v = evaluate(expr!, (k) => (values.has(k) ? values.get(k) : latest[k]));
        } else {
          const reading = def.kind === 'runtime' ? values.get(def.source) : asNumber(values.get(def.source));
          if (reading === undefined || reading === null || (def.kind === 'runtime' && asNumber(reading) === null)) continue;
          const prev = changedState.get(def.key) ?? state.get(def.key);
          if (prev && ts <= prev.ts) continue; // out of order: stateful keys only move forward
          const step = this.step(def, prev, ts, reading as number | boolean);
          changedState.set(def.key, step.state);
          if (step.issue) issues.push(step.issue);
          v = step.value;
        }
        if (v === null) continue;
        values.set(def.key, v); // later calculated keys can use it
        latest[def.key] = v;
        out.push(toRow(def.key, ts, v));
      }
      for (const [k, v] of values) latest[k] = v;
    }
    if (changedState.size) {
      await this.redis.hset(calcStateKey(deviceId), Object.fromEntries([...changedState].map(([k, s]) => [k, JSON.stringify(s)])));
    }
    return { rows: [...own, ...out], issues };
  }

  /** One stateful key: the value for this reading and the state to keep. */
  private step(def: Exclude<CalculatedKey, { kind: 'formula' }>, prev: State | undefined, ts: number, reading: number | boolean): { value: number | null; state: State; issue?: string } {
    const here: State = { ts, v: reading };
    if (!prev) return { value: null, state: here }; // the first reading has nothing to compare with
    switch (def.kind) {
      case 'counter_delta': {
        const cur = reading as number;
        let delta = cur - (prev.v as number);
        if (delta < 0) delta = cur; // the counter was reset: count up from zero
        if (def.maxDelta !== undefined && delta > def.maxDelta) {
          return { value: null, state: here, issue: `${def.key}: a jump of ${delta} is above maxDelta ${def.maxDelta}; not counted` };
        }
        return { value: delta, state: here };
      }
      case 'runtime': {
        const gapS = (ts - prev.ts) / 1000;
        const wasRunning = (asNumber(prev.v) ?? 0) > 0;
        return { value: wasRunning && gapS <= def.gapCapS ? gapS : 0, state: here };
      }
      case 'fuel_used': {
        const level = reading as number;
        const ref = prev.v as number;
        // Within the deadband the reference level stays, so slow use still adds up.
        if (Math.abs(ref - level) <= def.deadband) return { value: 0, state: { ts, v: ref } };
        return { value: level < ref ? ref - level : 0, state: here };
      }
    }
  }

  private async latestOf(deviceId: string, keys: string[]): Promise<Record<string, unknown>> {
    // No prototype: a key named "constructor" is just a missing key.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    if (!keys.length) return out;
    const raw = await this.redis.hmget(LATEST_KEY(deviceId), ...keys);
    keys.forEach((k, i) => {
      if (raw[i]) out[k] = (JSON.parse(raw[i]!) as LatestValue).v;
    });
    return out;
  }

  private async stateOf(deviceId: string, stateful: Compiled[]): Promise<Map<string, State>> {
    const out = new Map<string, State>();
    if (!stateful.length) return out;
    const raw = await this.redis.hmget(calcStateKey(deviceId), ...stateful.map((s) => s.def.key));
    stateful.forEach((s, i) => {
      if (raw[i]) out.set(s.def.key, JSON.parse(raw[i]!) as State);
    });
    return out;
  }

  private async profileCalc(profileId: string): Promise<ProfileCalc> {
    const cached = this.profiles.get(profileId);
    if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached;
    const row = await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, profileId), columns: { calculated: true } });
    const parsed = CalculatedKeysSchema.safeParse(row?.calculated ?? []);
    const defs: Compiled[] = [];
    // Saved definitions were checked; anything that no longer parses is skipped, not fatal.
    for (const def of parsed.success ? parsed.data : []) {
      if (def.kind !== 'formula') defs.push({ def });
      else {
        try {
          defs.push({ def, expr: parseExpr(def.expr) });
        } catch {
          /* skipped */
        }
      }
    }
    const names = new Set(defs.map((d) => d.def.key));
    const formulaInputs = [...new Set(defs.flatMap((d) => (d.expr ? inputsOf(d.expr) : [])))].filter((k) => !names.has(k));
    const entry: ProfileCalc = { defs, names, formulaInputs, stateful: defs.filter((d) => d.def.kind !== 'formula'), at: Date.now() };
    this.profiles.set(profileId, entry);
    return entry;
  }
}
