import { Inject, Injectable } from '@nestjs/common';
import {
  ALARM_SEVERITIES,
  type AlarmDto,
  type AlarmEventDto,
  type AlarmFilter,
  type AlarmSummary,
} from '@perspice/shared';
import { type SQL, and, asc, count, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AuthUser } from '../auth/auth.types';
import { conflict, notFound, validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { isUuid, scoped } from '../db/scoped-repo';
import { alarm, alarmEvent, alarmRule, customer, device, user } from '../db/schema';
import { ScopeService } from '../rbac/scope';
import { AlarmStore, type AlarmRow } from './alarm-store';
import { AlarmEngine } from './engine';

const ackUser = alias(user, 'ack_user');

const encodeCursor = (a: { startedAt: Date; id: string }) => Buffer.from(JSON.stringify([a.startedAt.toISOString(), a.id])).toString('base64url');
function decodeCursor(c: string): [Date, string] {
  try {
    const [ts, id] = JSON.parse(Buffer.from(c, 'base64url').toString()) as [string, string];
    return [new Date(ts), id];
  } catch {
    throw validation([{ path: ['cursor'], message: 'Invalid cursor' }]);
  }
}

/** Reading and acting on alarms; every query is constrained to the viewer's devices. */
@Injectable()
export class AlarmsService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly scopes: ScopeService,
    private readonly store: AlarmStore,
    private readonly engine: AlarmEngine,
  ) {}

  /** Conditions for alarms the actor may see, plus the filter. */
  async where(actor: AuthUser, f: AlarmFilter): Promise<SQL | undefined> {
    const scope = await this.scopes.forUser(actor);
    return scoped(
      device,
      scope,
      f.status?.length ? inArray(alarm.status, f.status) : undefined,
      f.severity?.length ? inArray(alarm.severity, f.severity) : undefined,
      f.deviceId ? eq(alarm.deviceId, f.deviceId) : undefined,
      f.profileId ? eq(device.profileId, f.profileId) : undefined,
      f.customerId ? eq(alarm.customerId, f.customerId) : undefined,
      f.from !== undefined ? gte(alarm.startedAt, new Date(f.from)) : undefined,
      f.to !== undefined ? lte(alarm.startedAt, new Date(f.to)) : undefined,
    );
  }

  /** Rows joined for DTOs, newest first. */
  query(where: SQL | undefined, limit: number) {
    return this.db
      .select({ a: alarm, deviceName: device.name, profileId: device.profileId, customerName: customer.name, ackName: ackUser.name })
      .from(alarm)
      .innerJoin(device, eq(device.id, alarm.deviceId))
      .leftJoin(customer, eq(customer.id, alarm.customerId))
      .leftJoin(ackUser, eq(ackUser.id, alarm.acknowledgedBy))
      .where(where)
      .orderBy(desc(alarm.startedAt), desc(alarm.id))
      .limit(limit);
  }

  async list(actor: AuthUser, f: AlarmFilter, cursor: string | undefined, limit: number): Promise<{ items: AlarmDto[]; nextCursor: string | null }> {
    let where = await this.where(actor, f);
    if (cursor) {
      const [ts, id] = decodeCursor(cursor);
      where = and(where, or(lt(alarm.startedAt, ts), and(eq(alarm.startedAt, ts), lt(alarm.id, id))));
    }
    const rows = await this.query(where, limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => toDto(r, actor)),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!.a) : null,
    };
  }

  async get(actor: AuthUser, id: string): Promise<AlarmDto & { timeline: AlarmEventDto[] }> {
    const row = await this.find(actor, id);
    const events = await this.db
      .select({ e: alarmEvent, userName: user.name })
      .from(alarmEvent)
      .leftJoin(user, eq(user.id, alarmEvent.userId))
      .where(eq(alarmEvent.alarmId, row.a.id))
      .orderBy(asc(alarmEvent.ts), asc(alarmEvent.id));
    return {
      ...toDto(row, actor),
      timeline: events.map(({ e, userName }) => ({
        id: e.id,
        type: e.type,
        ts: e.ts.getTime(),
        user: e.userId ? { id: e.userId, name: userName ?? '' } : null,
        comment: e.comment,
        data: e.data,
      })),
    };
  }

  async acknowledge(actor: AuthUser, id: string, comment?: string): Promise<AlarmDto> {
    const { a } = await this.find(actor, id);
    const now = new Date();
    const [row] = await this.db
      .update(alarm)
      .set({ status: 'acknowledged', acknowledgedAt: now, acknowledgedBy: actor.id, updatedAt: now })
      .where(and(eq(alarm.id, a.id), eq(alarm.status, 'active')))
      .returning();
    if (!row) throw conflict(a.status === 'cleared' ? 'This alarm is already cleared' : 'This alarm is already acknowledged');
    await this.db.insert(alarmEvent).values({ alarmId: a.id, type: 'acknowledged', userId: actor.id, comment: comment ?? null, ts: now });
    await this.store.announce('acknowledged', row, null);
    return toDto(await this.find(actor, id), actor);
  }

  /** Clears by hand; the rule evaluates afresh, so it raises again if its condition still holds. */
  async clear(actor: AuthUser, id: string, comment?: string): Promise<AlarmDto> {
    const { a } = await this.find(actor, id);
    const now = new Date();
    const [row] = await this.db
      .update(alarm)
      .set({ status: 'cleared', clearedAt: now, clearReason: 'manual', updatedAt: now })
      .where(and(eq(alarm.id, a.id), sql`${alarm.status} <> 'cleared'`))
      .returning();
    if (!row) throw conflict('This alarm is already cleared');
    await this.db.insert(alarmEvent).values({ alarmId: a.id, type: 'cleared', userId: actor.id, comment: comment ?? null, data: { reason: 'manual' }, ts: now });
    if (row.ruleId) {
      const rule = await this.db.query.alarmRule.findFirst({ where: eq(alarmRule.id, row.ruleId), columns: { id: true, version: true } });
      if (rule) await this.engine.resetState(rule, row.deviceId);
    }
    await this.store.announce('cleared', row, null);
    return toDto(await this.find(actor, id), actor);
  }

  async comment(actor: AuthUser, id: string, text: string): Promise<AlarmEventDto> {
    const { a } = await this.find(actor, id);
    const [e] = await this.db.insert(alarmEvent).values({ alarmId: a.id, type: 'comment', userId: actor.id, comment: text }).returning();
    return { id: e!.id, type: 'comment', ts: e!.ts.getTime(), user: { id: actor.id, name: actor.name }, comment: text, data: null };
  }

  async count(actor: AuthUser, f: AlarmFilter): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(alarm).innerJoin(device, eq(device.id, alarm.deviceId)).where(await this.where(actor, f));
    return row?.n ?? 0;
  }

  /** Open alarms by severity (optionally narrowed, e.g. to a profile or device). */
  async summary(actor: AuthUser, f: Omit<AlarmFilter, 'status'> = {}): Promise<AlarmSummary> {
    const rows = await this.db
      .select({ severity: alarm.severity, status: alarm.status, n: count() })
      .from(alarm)
      .innerJoin(device, eq(device.id, alarm.deviceId))
      .where(await this.where(actor, { ...f, status: ['active', 'acknowledged'] }))
      .groupBy(alarm.severity, alarm.status);
    const out = Object.fromEntries(ALARM_SEVERITIES.map((s) => [s, 0])) as AlarmSummary;
    out.total = 0;
    out.unacknowledged = 0;
    for (const r of rows) {
      out[r.severity] += r.n;
      out.total += r.n;
      if (r.status === 'active') out.unacknowledged += r.n;
    }
    return out;
  }

  private async find(actor: AuthUser, id: string) {
    if (!isUuid(id)) throw notFound();
    const [row] = await this.query(and(await this.where(actor, {}), eq(alarm.id, id)), 1);
    if (!row) throw notFound();
    return row;
  }
}

type Joined = { a: AlarmRow; deviceName: string; profileId: string; customerName: string | null; ackName: string | null };

export function toDto(r: Joined, viewer: Pick<AuthUser, 'scopeType'>): AlarmDto {
  const a = r.a;
  return {
    id: a.id,
    ruleId: a.ruleId,
    ruleName: a.ruleName,
    type: a.type,
    severity: a.severity,
    status: a.status,
    device: { id: a.deviceId, name: r.deviceName, profileId: r.profileId },
    customer: a.customerId && viewer.scopeType === 'platform' ? { id: a.customerId, name: r.customerName ?? '' } : null,
    startedAt: a.startedAt.getTime(),
    acknowledgedAt: a.acknowledgedAt?.getTime() ?? null,
    acknowledgedBy: a.acknowledgedBy ? { id: a.acknowledgedBy, name: r.ackName ?? '' } : null,
    clearedAt: a.clearedAt?.getTime() ?? null,
    clearReason: a.clearReason,
    value: a.value,
    message: a.message,
  };
}
