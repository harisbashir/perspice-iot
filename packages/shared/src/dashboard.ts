import { z } from 'zod';
import { KEY_PATTERN } from './protocol.js';

export const GRID_COLUMNS = 12;
export const MAX_STATES = 20;
export const MAX_WIDGETS_PER_STATE = 60;
/** Most devices one dashboard may show at once (list sources, live subscriptions). */
export const MAX_DASHBOARD_DEVICES = 500;

const Key = z.string().regex(KEY_PATTERN);
const Keys = z.array(Key).max(50);
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const TimewindowSchema = z.union([
  z.object({ kind: z.literal('relative'), lastMs: z.number().int().min(60_000).max(5 * 366 * 86_400_000) }),
  z
    .object({ kind: z.literal('absolute'), fromMs: z.number().int(), toMs: z.number().int() })
    .refine((t) => t.fromMs < t.toMs, 'fromMs must be before toMs'),
]);
export type Timewindow = z.infer<typeof TimewindowSchema>;

const DeviceFilter = z
  .object({
    status: z.array(z.enum(['never', 'online', 'offline', 'dead'])).max(4).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    search: z.string().max(200).optional(),
  })
  .optional();

/**
 * Where a widget's data comes from. Every source is resolved within the viewer's scope on the
 * server; `currentDevice` is the device the dashboard was opened for.
 */
export const DataSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('currentDevice'), keys: Keys }),
  z.object({ kind: z.literal('device'), deviceId: z.string().uuid(), keys: Keys }),
  z.object({ kind: z.literal('devicesOfProfile'), profileId: z.string().uuid().nullable(), filter: DeviceFilter, keys: Keys }),
  z.object({
    kind: z.literal('entityList'),
    profileId: z.string().uuid().nullable(),
    filter: DeviceFilter,
    // Built-in columns (status, name, profile, customer, lastSeen) or telemetry keys.
    columns: Keys.min(1),
    pageSize: z.number().int().min(1).max(MAX_DASHBOARD_DEVICES).default(25),
  }),
]);
export type DataSource = z.infer<typeof DataSourceSchema>;

export const WidgetConfigSchema = z.object({
  id: Id,
  // Unknown types are kept (rendered as "Unknown widget") so newer templates still load.
  type: z.string().regex(/^[a-z0-9-]{1,64}$/),
  title: z.string().max(200).optional(),
  datasource: DataSourceSchema,
  settings: z.record(z.unknown()).default({}),
});
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

export const LayoutItemSchema = z
  .object({
    i: Id,
    x: z.number().int().min(0).max(GRID_COLUMNS - 1),
    y: z.number().int().min(0).max(1000),
    w: z.number().int().min(1).max(GRID_COLUMNS),
    h: z.number().int().min(1).max(100),
  })
  .refine((l) => l.x + l.w <= GRID_COLUMNS, 'Layout item extends past the 12-column grid');
export type LayoutItem = z.infer<typeof LayoutItemSchema>;

export const DashboardStateSchema = z
  .object({
    id: Id,
    name: z.string().trim().min(1).max(100),
    layout: z.array(LayoutItemSchema).max(MAX_WIDGETS_PER_STATE),
    widgets: z.array(WidgetConfigSchema).max(MAX_WIDGETS_PER_STATE),
  })
  .superRefine((s, ctx) => {
    const ids = s.widgets.map((w) => w.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate widget ids', path: ['widgets'] });
    const placed = s.layout.map((l) => l.i);
    if (new Set(placed).size !== placed.length || placed.length !== ids.length || !placed.every((i) => ids.includes(i))) {
      ctx.addIssue({ code: 'custom', message: 'Every widget needs exactly one layout item', path: ['layout'] });
    }
  });
export type DashboardState = z.infer<typeof DashboardStateSchema>;

export const DashboardDefinitionSchema = z
  .object({
    states: z.array(DashboardStateSchema).min(1).max(MAX_STATES),
    settings: z.object({
      timewindow: TimewindowSchema,
      refreshS: z.number().int().min(0).max(3600).default(0),
    }),
  })
  .superRefine((d, ctx) => {
    const ids = d.states.map((s) => s.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate state ids', path: ['states'] });
  });
export type DashboardDefinition = z.infer<typeof DashboardDefinitionSchema>;

/** Columns an entity table can show besides telemetry keys. */
export const ENTITY_COLUMNS = ['status', 'name', 'profile', 'customer', 'lastSeen'] as const;

// ── Widget data API (POST /api/dashboards/data) ───────────────────────────────────────────

export const DATA_MODES = ['latest', 'history', 'list', 'stats'] as const;
export type DataMode = (typeof DATA_MODES)[number];
export const MAX_DATA_REQUESTS = 60;

export const DataRequestSchema = z.object({
  widgetId: Id,
  datasource: DataSourceSchema,
  mode: z.enum(DATA_MODES),
  timewindow: TimewindowSchema.optional(),
  agg: z.enum(['auto', 'raw', 'avg', 'min', 'max']).default('auto'),
  page: z.number().int().min(0).max(10_000).default(0),
  sort: z
    .object({ by: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), dir: z.enum(['asc', 'desc']).default('asc') })
    .optional(),
  /** Entity lists: narrow to one customer (platform viewers; customers only ever see their own). */
  customerId: z.string().uuid().optional(),
});
export type DataRequest = z.infer<typeof DataRequestSchema>;

export const DataQuerySchema = z.object({
  /** The device a device dashboard was opened for (resolves `currentDevice`). */
  deviceId: z.string().uuid().optional(),
  requests: z.array(DataRequestSchema).max(MAX_DATA_REQUESTS),
});
export type DataQuery = z.infer<typeof DataQuerySchema>;

export interface DeviceSummary {
  id: string;
  name: string;
  status: 'never' | 'online' | 'offline' | 'dead';
  lastSeen: number | null;
  profileId: string;
  customerId: string | null;
}

export interface LatestValueDto {
  ts: number;
  v: unknown;
}

/** mode `latest` on a single-device source. */
export interface LatestData {
  device: DeviceSummary;
  values: Record<string, LatestValueDto>;
}
/** mode `latest` on `devicesOfProfile`. */
export interface FleetLatestData {
  devices: (DeviceSummary & { values: Record<string, LatestValueDto> })[];
}
/** mode `history` on a single-device source. */
export interface HistoryData {
  source: 'raw' | '1m' | '1h' | '1d';
  series: Record<string, [number, unknown][]>;
}
/** mode `list` on `entityList`. */
export interface ListData {
  items: (DeviceSummary & { profileName: string | null; customerName: string | null; values: Record<string, LatestValueDto> })[];
  total: number;
  page: number;
  /** Platform viewers only: the customers owning matching devices, for the customer filter. */
  customers?: { id: string; name: string }[];
  pageSize: number;
}
/** mode `stats` on `devicesOfProfile`; `messages24h` counts values received in the last 24 h. */
export interface StatsData {
  total: number;
  online: number;
  offline: number;
  dead: number;
  never: number;
  messages24h: number;
}

export type WidgetDataResult<T = unknown> = { ok: true; data: T } | { ok: false; code: string; message: string };
export interface DataResponse {
  results: Record<string, WidgetDataResult>;
}

/** GET /api/dashboards/device/:id and /api/dashboards/overview (or `{ dashboard: null }`). */
export interface DashboardViewDto {
  instanceId: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  overridden: boolean;
  baseVersion: number | null;
  /** The template changed after this instance was customised. */
  outdated: boolean;
  definition: DashboardDefinition;
}

// ── Key mapping (clone a template onto a profile with different key names) ────────────────

const BUILT_IN_COLUMNS = new Set<string>(ENTITY_COLUMNS);

/** Telemetry keys referenced by a definition (datasource keys and entity-table columns). */
export function templateKeys(def: DashboardDefinition): string[] {
  const keys = new Set<string>();
  for (const state of def.states) {
    for (const w of state.widgets) {
      const ds = w.datasource;
      if ('keys' in ds) ds.keys.forEach((k) => keys.add(k));
      if (ds.kind === 'entityList') ds.columns.filter((c) => !BUILT_IN_COLUMNS.has(c)).forEach((k) => keys.add(k));
    }
  }
  return [...keys].sort();
}

/**
 * Rewrites telemetry keys when a template is cloned onto a profile with different key names:
 * datasource `keys`, entity-table columns, and widget settings named `key` / `keys`.
 */
export function remapKeys(def: DashboardDefinition, mapping: Record<string, string>): DashboardDefinition {
  const map = (k: string) => mapping[k] ?? k;
  const out = structuredClone(def);
  for (const state of out.states) {
    for (const w of state.widgets) {
      const ds = w.datasource;
      if ('keys' in ds) ds.keys = ds.keys.map(map);
      if (ds.kind === 'entityList') ds.columns = ds.columns.map((c) => (BUILT_IN_COLUMNS.has(c) ? c : map(c)));
      if (typeof w.settings.key === 'string') w.settings.key = map(w.settings.key);
      if (Array.isArray(w.settings.keys)) w.settings.keys = w.settings.keys.map((k) => (typeof k === 'string' ? map(k) : k));
    }
  }
  return out;
}
