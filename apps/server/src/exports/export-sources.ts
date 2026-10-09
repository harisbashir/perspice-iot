import { Inject, Injectable } from '@nestjs/common';
import {
  type AuditExportParams,
  DEVICE_EXPORT_COLUMNS,
  type DevicesExportParams,
  type ExportRequest,
  type TelemetryExportParams,
  type WidgetExportParams,
} from '@perspice/shared';
import { type SQL, and, arrayContains, asc, count, eq, gt, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { forbidden, validation } from '../common/app-error';
import { windowOf } from '../dashboards/data.service';
import { DB } from '../db/db.module';
import { scoped } from '../db/scoped-repo';
import { customer, device, deviceProfile, telemetry, user } from '../db/schema';
import { DevicesService } from '../devices/devices.service';
import { ScopeService } from '../rbac/scope';
import type { Cell, Column } from './writers';

/** Rows for one export: counted up front (to pick sync vs background), then read in pages. */
export interface ExportSource {
  title: string;
  columns: Column[];
  count(): Promise<number>;
  rows(): AsyncIterable<Cell[]>;
}

const PAGE = 5000;
const time = (header: string): Column => ({ header, kind: 'time' });
const textCol = (header: string): Column => ({ header, kind: 'text' });

const DEVICE_HEADERS: Record<(typeof DEVICE_EXPORT_COLUMNS)[number], Column> = {
  name: textCol('Name'),
  status: textCol('Status'),
  lastSeen: time('Last seen (UTC)'),
  profile: textCol('Profile'),
  customer: textCol('Customer'),
  tags: textCol('Tags'),
};
const BUILT_IN = new Set<string>(DEVICE_EXPORT_COLUMNS);

interface DeviceQuery extends DevicesExportParams {
  deviceIds?: string[];
  title?: string;
}

/** Builds row sources for each export kind, always within the requesting user's scope. */
@Injectable()
export class ExportSources {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly devices: DevicesService,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async for(actor: AuthUser, req: ExportRequest): Promise<ExportSource> {
    switch (req.kind) {
      case 'telemetry':
        return this.telemetry(actor, req.params);
      case 'devices':
        return this.deviceList(actor, req.params);
      case 'audit':
        return this.auditLog(actor, req.params);
      case 'widget':
        return this.widget(actor, req.params);
    }
  }

  /** Wide format: one row per timestamp, one column per key. */
  async telemetry(actor: AuthUser, p: TelemetryExportParams, title?: string): Promise<ExportSource> {
    const d = await this.devices.find(actor, p.deviceId); // 404 outside the caller's scope
    const profile = await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, d.profileId) });
    const defs = new Map((profile?.telemetrySchema ?? []).map((k) => [k.key, k]));
    const columns = [
      time('Time (UTC)'),
      ...p.keys.map((k): Column => {
        const def = defs.get(k);
        if (!def) return textCol(k);
        return { header: def.unit ? `${def.label} (${def.unit})` : def.label, kind: def.type === 'number' ? 'number' : 'text' };
      }),
    ];
    const where = (after: string | null) =>
      and(
        eq(telemetry.deviceId, d.id),
        inArray(telemetry.key, p.keys),
        after === null ? gte(telemetry.ts, new Date(p.from)) : sql`${telemetry.ts} > ${after}::timestamptz`,
        lte(telemetry.ts, new Date(p.to)),
      );
    const db = this.db;
    return {
      title: title ?? `${d.name} telemetry`,
      columns,
      async count() {
        const [row] = await db.select({ n: sql<number>`count(DISTINCT ${telemetry.ts})::int` }).from(telemetry).where(where(null));
        return row?.n ?? 0;
      },
      async *rows() {
        let after: string | null = null;
        for (;;) {
          // Keyset paging on ts; the cursor stays a database string so no precision is lost.
          const res: { rows: { ts: string; cursor: string; v: Record<string, unknown> }[] } = await db.execute<{ ts: string; cursor: string; v: Record<string, unknown> }>(sql`
            SELECT ts, ts::text AS cursor,
                   jsonb_object_agg(key, coalesce(to_jsonb(value_num), to_jsonb(value_str), to_jsonb(value_bool), value_json)) AS v
            FROM ${telemetry} WHERE ${where(after)}
            GROUP BY ts ORDER BY ts LIMIT ${PAGE}`);
          for (const r of res.rows) yield [new Date(r.ts), ...p.keys.map((k) => (r.v[k] ?? null) as Cell)];
          if (res.rows.length < PAGE) return;
          after = res.rows[res.rows.length - 1]!.cursor;
        }
      },
    };
  }

  async deviceList(actor: AuthUser, p: DeviceQuery): Promise<ExportSource> {
    const scope = await this.scopes.forUser(actor);
    // Customer users never see which customer a device belongs to (it is always their own).
    const cols = p.columns.filter((c) => !(c === 'customer' && actor.scopeType === 'customer'));
    if (!cols.length) throw validation([{ path: ['params', 'columns'], message: 'Choose at least one column' }]);
    const conds: (SQL | undefined)[] = [
      p.deviceIds ? inArray(device.id, p.deviceIds) : undefined,
      p.profileId ? eq(device.profileId, p.profileId) : undefined,
      p.filter?.status?.length ? inArray(device.status, p.filter.status) : undefined,
      p.filter?.tags?.length ? arrayContains(device.tags, p.filter.tags) : undefined,
      p.filter?.search ? ilike(device.name, `%${p.filter.search}%`) : undefined,
    ];
    const keys = cols.filter((c) => !BUILT_IN.has(c));
    const { db, devices } = this;
    return {
      title: p.title ?? 'Devices',
      columns: cols.map((c) => DEVICE_HEADERS[c as keyof typeof DEVICE_HEADERS] ?? textCol(c)),
      async count() {
        const [row] = await db.select({ n: count() }).from(device).where(scoped(device, scope, ...conds));
        return row?.n ?? 0;
      },
      async *rows() {
        let after: [string, string] | null = null;
        for (;;) {
          const page: { d: typeof device.$inferSelect; profileName: string; customerName: string | null }[] = await db
            .select({ d: device, profileName: deviceProfile.name, customerName: customer.name })
            .from(device)
            .innerJoin(deviceProfile, eq(deviceProfile.id, device.profileId))
            .leftJoin(customer, eq(customer.id, device.customerId))
            .where(
              scoped(
                device,
                scope,
                ...conds,
                after ? or(gt(device.name, after[0]), and(eq(device.name, after[0]), gt(device.id, after[1]))) : undefined,
              ),
            )
            .orderBy(asc(device.name), asc(device.id))
            .limit(1000);
          const dtos = keys.length || cols.includes('lastSeen') ? await devices.toDtos(page.map((x) => x.d)) : [];
          for (const [i, x] of page.entries()) {
            const values: Record<string, Cell> = {
              name: x.d.name,
              status: x.d.status,
              lastSeen: dtos[i]?.lastSeen ? new Date(dtos[i]!.lastSeen!) : null,
              profile: x.profileName,
              customer: x.customerName,
              tags: x.d.tags.join(' '),
            };
            const latest = dtos[i]?.latest ?? {};
            yield cols.map((c) => (BUILT_IN.has(c) ? values[c] : ((latest[c]?.v ?? null) as Cell)));
          }
          if (page.length < 1000) return;
          const last: typeof device.$inferSelect = page[page.length - 1]!.d;
          after = [last.name, last.id];
        }
      },
    };
  }

  async auditLog(actor: AuthUser, p: AuditExportParams): Promise<ExportSource> {
    if (!actor.permissions.includes('audit.read')) throw forbidden();
    const q = {
      ...p,
      from: p.from !== undefined ? new Date(p.from) : undefined,
      to: p.to !== undefined ? new Date(p.to) : undefined,
      // Customer users only ever see their own customer's trail.
      customerId: actor.scopeType === 'customer' ? actor.customerId : undefined,
    };
    const { db, audit } = this;
    return {
      title: 'Audit log',
      columns: [time('Time (UTC)'), textCol('Action'), textCol('Actor type'), textCol('Actor'), textCol('Target type'), textCol('Target'), textCol('IP')],
      count: () => audit.count(q),
      async *rows() {
        let cursor: string | undefined;
        do {
          const page = await audit.list({ ...q, cursor, limit: 1000 });
          const ids = [...new Set(page.items.map((r) => r.actorId).filter((id): id is string => !!id))];
          const users = ids.length ? await db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.id, ids)) : [];
          const emails = new Map(users.map((u) => [u.id, u.email]));
          for (const r of page.items) {
            yield [r.ts, r.action, r.actorType, (r.actorId && emails.get(r.actorId)) ?? r.actorId, r.targetType, r.targetId, r.ip];
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      },
    };
  }

  /** Exports what a widget shows, with the full result set rather than one page. */
  private async widget(actor: AuthUser, p: WidgetExportParams): Promise<ExportSource> {
    const ds = p.datasource;
    const title = p.title || 'Widget data';
    switch (ds.kind) {
      case 'currentDevice':
      case 'device': {
        const deviceId = ds.kind === 'device' ? ds.deviceId : p.deviceId;
        if (!deviceId) throw validation([], 'This widget needs the dashboard to be opened for a device');
        await this.devices.find(actor, deviceId); // 404 outside the caller's scope, not an empty file
        if (p.mode === 'history') {
          const { from, to } = windowOf(p.timewindow);
          return this.telemetry(actor, { deviceId, keys: ds.keys, from, to }, title);
        }
        return this.deviceList(actor, { columns: ['name', 'lastSeen', ...ds.keys], deviceIds: [deviceId], title });
      }
      case 'devicesOfProfile':
        if (p.mode === 'latest') {
          return this.deviceList(actor, { columns: ['name', 'status', 'lastSeen', ...ds.keys], profileId: ds.profileId, filter: ds.filter, title });
        }
        break;
      case 'entityList':
        return this.deviceList(actor, { columns: ds.columns, profileId: ds.profileId, filter: ds.filter, title });
      case 'none':
        break;
    }
    throw validation([], 'This widget has no exportable data');
  }
}
