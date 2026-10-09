import { BUILT_IN_ROLE_KEYS, KEY_PATTERN, LocationKeysSchema } from '@perspice/shared';
import { z } from 'zod';

const TelemetryKeyDef = z.object({
  key: z.string().regex(KEY_PATTERN, 'Use 1–64 letters, digits, "_", "." or "-"'),
  label: z.string().trim().min(1).max(100),
  unit: z.string().max(20).optional(),
  type: z.enum(['number', 'string', 'boolean', 'json']),
  decimals: z.number().int().min(0).max(10).optional(),
});

const CommandDef = z.object({
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  label: z.string().trim().min(1).max(100),
  paramsSchema: z.record(z.unknown()).optional(),
  confirm: z.boolean().default(false),
});

const StatusNotify = z.object({
  enabled: z.boolean(),
  roleKeys: z.array(z.enum(BUILT_IN_ROLE_KEYS)).max(10),
  channels: z.array(z.enum(['email', 'inapp'])).max(2),
});

const uniqueBy = <T>(field: keyof T) => (items: T[]) => new Set(items.map((i) => i[field])).size === items.length;

export const ProfileFields = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable(),
  telemetrySchema: z.array(TelemetryKeyDef).max(200).refine(uniqueBy('key'), 'Duplicate telemetry keys'),
  commands: z.array(CommandDef).max(100).refine(uniqueBy('name'), 'Duplicate command names'),
  offlineTimeoutS: z.number().int().min(10).max(30 * 86400),
  deadTimeoutS: z.number().int().min(11).max(365 * 86400),
  sleepy: z.boolean(),
  transport: z.enum(['mqtt', 'http', 'aws-iot']),
  retentionDays: z.number().int().min(1).max(3650),
  statusNotify: StatusNotify,
  locationMode: z.enum(['none', 'fixed', 'reported']),
  locationKeys: LocationKeysSchema,
});

export const CreateProfile = ProfileFields.partial().required({ name: true });
export const UpdateProfile = ProfileFields.partial();

export const timeoutIssue = { path: ['deadTimeoutS'], message: 'Must be greater than offlineTimeoutS' };
