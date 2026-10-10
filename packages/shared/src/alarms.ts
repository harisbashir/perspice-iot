import { z } from 'zod';
import { ALARM_SEVERITIES, ALARM_STATUSES, type AlarmSeverity, type AlarmStatus } from './alarm-constants.js';
import { TimewindowSchema } from './dashboard.js';
import { KEY_PATTERN } from './protocol.js';
import { BUILT_IN_ROLE_KEYS } from './roles.js';

export { ALARM_SEVERITIES, ALARM_STATUSES, type AlarmSeverity, type AlarmStatus } from './alarm-constants.js';

// ── Common ───────────────────────────────────────────────────────────────────────────────────

/** True for IANA zone names the runtime knows (and `UTC`). */
export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const TimezoneSchema = z.string().max(64).refine(isTimezone, 'Unknown timezone');
const Uuid = z.string().uuid();
const Key = z.string().regex(KEY_PATTERN, 'Use letters, digits, ".", "_" or "-" (max 64)');
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

/** One scale for alarms and other notifications (status changes are `info`/`warning`/`critical`). */
export const NOTIFY_LEVELS = ['info', 'warning', 'minor', 'major', 'critical'] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
export const notifyLevelAtLeast = (level: NotifyLevel, min: NotifyLevel) => NOTIFY_LEVELS.indexOf(level) >= NOTIFY_LEVELS.indexOf(min);

export const NOTIFY_CHANNELS = ['inapp', 'email', 'push', 'webhook'] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

// ── Alarm rules ──────────────────────────────────────────────────────────────────────────────

export const ALARM_RULE_TYPES = ['threshold', 'range', 'duration', 'rate_of_change', 'state_match', 'status', 'no_data_key', 'geofence', 'maintenance_due'] as const;
/** Types not available yet (none at the moment). */
export const RESERVED_ALARM_RULE_TYPES = [] as const;
export type AlarmRuleType = (typeof ALARM_RULE_TYPES)[number];

const Op = z.enum(['>', '>=', '<', '<=']);
const Margin = z.object({ margin: z.number().min(0).default(0) }).default({});
const NoClear = z.object({}).strict().default({});

export const AlarmScopeSchema = z.discriminatedUnion('kind', [
  /** Default for every device of the profile, in every customer. */
  z.object({ kind: z.literal('profile'), profileId: Uuid }),
  /** One device (an addition, or an opt-out of an inherited rule via `disablesRuleId`). */
  z.object({ kind: z.literal('device'), deviceId: Uuid }),
  /** All of one customer's devices, optionally only those of one profile. */
  z.object({ kind: z.literal('customer'), customerId: Uuid, profileId: Uuid.nullish() }),
]);
export type AlarmScope = z.infer<typeof AlarmScopeSchema>;

export const AlarmScheduleSchema = z.object({
  /** 0 = Sunday … 6 = Saturday. */
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  from: Time,
  /** May be earlier than `from` (window across midnight). */
  to: Time,
  /** Defaults to the device's customer timezone (or UTC). */
  timezone: TimezoneSchema.optional(),
});
export type AlarmSchedule = z.infer<typeof AlarmScheduleSchema>;

export const RecipientsSchema = z
  .object({
    roles: z.array(z.enum(BUILT_IN_ROLE_KEYS)).max(10).default([]),
    userIds: z.array(Uuid).max(100).default([]),
    groupIds: z.array(Uuid).max(50).default([]),
  })
  .default({});
export type Recipients = z.infer<typeof RecipientsSchema>;

const common = {
  name: z.string().trim().min(1).max(120),
  severity: z.enum(ALARM_SEVERITIES),
  scope: AlarmScopeSchema,
  enabled: z.boolean().default(true),
  schedule: AlarmScheduleSchema.nullable().default(null),
  /** Minimum time between notifications for the same rule and device. */
  cooldownS: z.number().int().min(0).max(86_400).default(300),
  recipients: RecipientsSchema,
  channels: z.array(z.enum(NOTIFY_CHANNELS)).max(4).default(['inapp']),
  /** Set on a device/customer rule that switches off an inherited rule instead of adding one. */
  disablesRuleId: Uuid.nullish(),
};

const RULE_VARIANTS = [
  z.object({ ...common, type: z.literal('threshold'), condition: z.object({ key: Key, op: Op, value: z.number() }), clear: Margin }),
  z.object({
    ...common,
    type: z.literal('range'),
    condition: z
      .object({ key: Key, min: z.number(), max: z.number(), mode: z.enum(['outside', 'inside']).default('outside') })
      .refine((c) => c.min < c.max, { message: '"min" must be below "max"', path: ['max'] }),
    clear: Margin,
  }),
  z.object({
    ...common,
    type: z.literal('duration'),
    condition: z.object({ key: Key, op: Op, value: z.number(), forS: z.number().int().min(1).max(86_400) }),
    clear: Margin,
  }),
  z.object({
    ...common,
    type: z.literal('rate_of_change'),
    condition: z.object({ key: Key, perMinute: z.number().positive(), direction: z.enum(['up', 'down', 'either']).default('either') }),
    clear: Margin,
  }),
  z.object({
    ...common,
    type: z.literal('state_match'),
    condition: z.object({ key: Key, values: z.array(z.union([z.string().max(200), z.number(), z.boolean()])).min(1).max(20) }),
    clear: NoClear,
  }),
  z.object({
    ...common,
    type: z.literal('status'),
    condition: z.object({ statuses: z.array(z.enum(['offline', 'dead'])).min(1) }),
    clear: NoClear,
  }),
  z.object({
    ...common,
    type: z.literal('geofence'),
    /** `outside`: raise when the device leaves the geofence; `inside`: when it enters. */
    condition: z.object({ geofenceId: Uuid, trigger: z.enum(['outside', 'inside']).default('outside') }),
    /** Clear only once back by this many metres (against GPS jitter at the boundary). */
    clear: z.object({ marginM: z.number().min(0).max(5000).default(20) }).default({}),
  }),
  z.object({
    ...common,
    type: z.literal('no_data_key'),
    condition: z.object({ key: Key, forS: z.number().int().min(60).max(30 * 86_400) }),
    clear: NoClear,
  }),
  z.object({
    ...common,
    type: z.literal('maintenance_due'),
    /** Service intervals by run hours (from a runtime key) and/or days; cleared by logging a service. */
    condition: z
      .object({
        runtimeKey: Key.optional(),
        everyHours: z.number().positive().max(1_000_000).optional(),
        everyDays: z.number().int().min(1).max(3650).optional(),
        /** Remind once this share of an interval is reached (100 = when due). */
        remindAtPct: z.number().int().min(50).max(100).default(100),
      })
      .refine((c) => c.everyHours !== undefined || c.everyDays !== undefined, { message: 'Give a service interval in run hours or days', path: ['everyHours'] })
      .refine((c) => c.everyHours === undefined || !!c.runtimeKey, { message: 'Run hours need the run time key', path: ['runtimeKey'] }),
    clear: NoClear,
  }),
] as const;

const RuleUnion = z.discriminatedUnion('type', [...RULE_VARIANTS]);

export const AlarmRuleInputSchema = z
  .object({ type: z.string() })
  .passthrough()
  .superRefine((r, ctx) => {
    if ((RESERVED_ALARM_RULE_TYPES as readonly string[]).includes(r.type)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['type'], message: `Rule type "${r.type}" is not available yet`, fatal: true });
    }
  })
  .pipe(RuleUnion);
export type AlarmRuleInput = z.infer<typeof RuleUnion>;
export type AlarmCondition<T extends AlarmRuleType> = Extract<AlarmRuleInput, { type: T }>['condition'];

export type AlarmRuleDto = AlarmRuleInput & {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Where the rule comes from, for effective-rule listings. */
  origin?: 'profile' | 'device' | 'customer';
};

// ── Alarms ───────────────────────────────────────────────────────────────────────────────────


export interface AlarmDto {
  id: string;
  ruleId: string | null;
  ruleName: string;
  type: AlarmRuleType;
  severity: AlarmSeverity;
  status: AlarmStatus;
  device: { id: string; name: string; profileId: string };
  customer: { id: string; name: string } | null;
  startedAt: number;
  acknowledgedAt: number | null;
  acknowledgedBy: { id: string; name: string } | null;
  clearedAt: number | null;
  clearReason: 'condition' | 'manual' | 'rule_removed' | null;
  /** The value that raised the alarm (key and value), when there is one. */
  value: { key: string; v: unknown } | null;
  message: string;
}

export interface AlarmEventDto {
  id: string;
  type: 'raised' | 'acknowledged' | 'cleared' | 'comment' | 'notified';
  ts: number;
  user: { id: string; name: string } | null;
  comment: string | null;
  data: Record<string, unknown> | null;
}

export const AlarmFilterSchema = z.object({
  status: z.array(z.enum(ALARM_STATUSES)).optional(),
  severity: z.array(z.enum(ALARM_SEVERITIES)).optional(),
  deviceId: Uuid.optional(),
  profileId: Uuid.optional(),
  customerId: Uuid.optional(),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
});
export type AlarmFilter = z.infer<typeof AlarmFilterSchema>;

export type AlarmSummary = Record<AlarmSeverity, number> & { total: number; unacknowledged: number };

// ── Notification preferences ─────────────────────────────────────────────────────────────────

export const NotificationPreferencesSchema = z.object({
  email: z.boolean().default(true),
  push: z.boolean().default(true),
  /** Email and push below this level are skipped (in-app always records them). */
  minSeverity: z.enum(NOTIFY_LEVELS).default('info'),
  /** In the user's timezone; email and push are held, then sent as a digest. */
  quietHours: z.object({ from: Time, to: Time }).nullable().default(null),
  criticalBypassesQuietHours: z.boolean().default(true),
  /** More than `threshold` emails/pushes within `windowMin` minutes → the rest go into one digest. */
  digest: z
    .object({ threshold: z.number().int().min(1).max(100).default(10), windowMin: z.number().int().min(1).max(120).default(15) })
    .default({}),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

// ── Webhooks ─────────────────────────────────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = ['alarm.raised', 'alarm.acknowledged', 'alarm.cleared', 'device.status_changed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WebhookInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z
    .string()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), 'Use an http(s) URL'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  enabled: z.boolean().default(true),
  /** Platform users may create customer webhooks; customer admins always get their own customer. */
  customerId: Uuid.nullish(),
});
export type WebhookInput = z.infer<typeof WebhookInputSchema>;

export interface WebhookDto extends Omit<WebhookInput, 'customerId'> {
  id: string;
  customerId: string | null;
  createdAt: number;
  /** Only in the response that created the webhook (or rotated its secret). */
  secret?: string;
}

// ── Delivery log ─────────────────────────────────────────────────────────────────────────────

export interface DeliveryDto {
  id: string;
  channel: NotifyChannel;
  recipient: string;
  subject: string;
  status: 'queued' | 'sent' | 'failed' | 'dead' | 'held';
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

// ── Report schedules ─────────────────────────────────────────────────────────────────────────

export const ScheduleCadenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), time: Time }),
  z.object({ kind: z.literal('weekly'), day: z.number().int().min(0).max(6), time: Time }),
  /** Days 1–28 so every month has the day. */
  z.object({ kind: z.literal('monthly'), day: z.number().int().min(1).max(28), time: Time }),
]);
export type ScheduleCadence = z.infer<typeof ScheduleCadenceSchema>;

export const ReportScheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('dashboard'), deviceId: Uuid.optional(), overview: z.boolean().optional(), stateId: z.string().max(64).optional() }),
    z.object({ kind: z.literal('telemetry'), deviceId: Uuid, keys: z.array(Key).min(1).max(50), format: z.enum(['csv', 'xlsx', 'pdf']) }),
  ]),
  /** Relative windows only: each run covers the period up to the run time. */
  timewindow: TimewindowSchema.refine((t) => t.kind === 'relative', 'Schedules use a relative time window'),
  cadence: ScheduleCadenceSchema,
  timezone: TimezoneSchema,
  recipients: z.array(Uuid).min(1).max(50),
  enabled: z.boolean().default(true),
});
export type ReportScheduleInput = z.infer<typeof ReportScheduleInputSchema>;

export interface ReportScheduleDto extends ReportScheduleInput {
  id: string;
  ownerId: string;
  nextRunAt: number | null;
  lastRun: { at: number; status: 'ok' | 'skipped' | 'failed'; message: string | null; jobId: string | null } | null;
}

// ── Maintenance ──────────────────────────────────────────────────────────────────────────────

/** A logged service of a device; `runHours` are the totals of its runtime keys at the time. */
export interface DeviceServiceDto {
  id: string;
  deviceId: string;
  servicedAt: number;
  note: string;
  runHours: Record<string, number>;
  createdBy: string | null;
}

export const DeviceServiceInputSchema = z.object({
  note: z.string().trim().max(500).default(''),
  /** When it was done (default now); not in the future. */
  servicedAt: z.number().int().optional(),
});

export interface RunHoursDto {
  key: string;
  total: number;
  sinceService: number;
  lastService: DeviceServiceDto | null;
}
