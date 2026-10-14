import { z } from 'zod';
import { KEY_PATTERN } from './protocol.js';

const Uuid = z.string().uuid();

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────

/** RFC 4180 CSV: quoted fields (with "" escapes, commas and newlines), CRLF or LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV text (CRLF). Cells that a spreadsheet would run as a formula get a leading apostrophe. */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+@]/.test(s) || /^-[^0-9.]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// ── Firmware and OTA ─────────────────────────────────────────────────────────────────────────

export const FirmwareUploadSchema = z.object({
  profileId: Uuid,
  version: z.string().regex(/^[A-Za-z0-9._+-]{1,40}$/, 'Use letters, digits, ".", "_", "+" or "-" (max 40)'),
  notes: z.string().max(2000).default(''),
});
export type FirmwareUpload = z.infer<typeof FirmwareUploadSchema>;

export const FIRMWARE_MAX_BYTES = 16 * 1024 * 1024;

export interface FirmwareDto {
  id: string;
  profileId: string;
  version: string;
  size: number;
  sha256: string;
  notes: string;
  createdAt: number;
}

export const OtaTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('devices'), deviceIds: z.array(Uuid).min(1).max(10_000) }),
  /** Every device of the firmware's profile, optionally one customer's and/or with all these tags. */
  z.object({ kind: z.literal('profile'), customerId: Uuid.nullish(), tags: z.array(z.string().max(64)).max(20).default([]) }),
]);
export type OtaTarget = z.infer<typeof OtaTargetSchema>;

export const OtaJobInputSchema = z.object({
  firmwareId: Uuid,
  target: OtaTargetSchema,
  /** Devices updated at a time. */
  batchSize: z.number().int().min(1).max(1000).default(10),
  /** Stop once more than this share of finished devices failed. */
  maxFailurePct: z.number().int().min(0).max(100).default(20),
  /** A device that hasn't applied the update after this long fails. */
  timeoutMin: z.number().int().min(5).max(24 * 60).default(30),
});
export type OtaJobInput = z.infer<typeof OtaJobInputSchema>;

export const OTA_DEVICE_STATES = ['pending', 'sent', 'downloading', 'verifying', 'applied', 'failed', 'skipped'] as const;
export type OtaDeviceState = (typeof OTA_DEVICE_STATES)[number];
/** States a device has finished in. */
export const OTA_DONE: readonly OtaDeviceState[] = ['applied', 'failed', 'skipped'];

/** `perspice/v1/{id}/ota/progress` from the device. */
export const OtaProgressSchema = z.object({
  version: z.string().max(40),
  state: z.enum(['downloading', 'verifying', 'applied', 'failed']),
  pct: z.number().min(0).max(100).optional(),
  error: z.string().max(200).optional(),
});
export type OtaProgress = z.infer<typeof OtaProgressSchema>;

/** `perspice/v1/{id}/ota` to the device. */
export interface OtaMessage {
  jobId: string;
  version: string;
  url: string;
  sha256: string;
  size: number;
}

export type OtaJobStatus = 'running' | 'halted' | 'completed' | 'cancelled';

export interface OtaJobDto {
  id: string;
  firmware: { id: string; version: string; profileId: string };
  status: OtaJobStatus;
  target: OtaTarget;
  batchSize: number;
  maxFailurePct: number;
  timeoutMin: number;
  counts: Record<OtaDeviceState, number>;
  haltReason: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface OtaDeviceDto {
  deviceId: string;
  deviceName: string;
  state: OtaDeviceState;
  pct: number | null;
  error: string | null;
  updatedAt: number;
}

// ── Claim codes ──────────────────────────────────────────────────────────────────────────────

/** Unambiguous letters and digits (no 0/O, 1/I/L). 12 characters ≈ 60 bits. */
export const CLAIM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CLAIM_CODE_LENGTH = 12;

export const normalizeClaimCode = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');
export const isClaimCode = (s: string) => s.length === CLAIM_CODE_LENGTH && [...s].every((c) => CLAIM_ALPHABET.includes(c));
/** For display: ABCD-EFGH-JKMN. */
export const formatClaimCode = (s: string) => s.match(/.{1,4}/g)?.join('-') ?? s;

export const ClaimRequestSchema = z.object({
  code: z.string().max(40).transform(normalizeClaimCode).refine(isClaimCode, 'Not a valid claim code'),
  name: z.string().trim().min(1).max(200).optional(),
  groupId: Uuid.nullish(),
});

// ── Provisioning ─────────────────────────────────────────────────────────────────────────────

/** A device's own identifier (MAC, serial number): letters, digits and `. _ : -`, up to 64. */
export const SERIAL_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
export const SerialSchema = z.string().trim().regex(SERIAL_PATTERN, 'Use letters, digits, ".", "_", ":" or "-" (up to 64)');

export const PROVISIONING_MODES = ['create', 'preregistered'] as const;
export type ProvisioningMode = (typeof PROVISIONING_MODES)[number];

export const ProvisioningKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  mode: z.enum(PROVISIONING_MODES),
  customerId: z.string().uuid().nullable().default(null),
  groupId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().regex(KEY_PATTERN)).max(20).default([]),
  issueClaimCodes: z.boolean().default(false),
  allowReprovision: z.boolean().default(false),
  maxDevices: z.number().int().min(1).max(1_000_000).nullable().default(null),
  expiresAt: z.number().int().nullable().default(null),
});
export type ProvisioningKeyInput = z.infer<typeof ProvisioningKeyInputSchema>;

export interface ProvisioningKeyDto {
  id: string;
  profileId: string;
  name: string;
  mode: ProvisioningMode;
  customerId: string | null;
  groupId: string | null;
  tags: string[];
  issueClaimCodes: boolean;
  allowReprovision: boolean;
  maxDevices: number | null;
  provisionedCount: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
}

/** `POST /api/v1/device/provision`: sent by a device on first boot. */
export const ProvisionRequestSchema = z.object({
  key: z.string().min(10).max(200),
  serial: SerialSchema,
  /** The name for a new device (default: "<profile> <serial>"). */
  name: z.string().trim().min(1).max(200).optional(),
  /** Client attributes to record straight away, e.g. `{ "fw": "1.0.0" }`. */
  attributes: z.record(z.unknown()).optional(),
});
export type ProvisionRequest = z.infer<typeof ProvisionRequestSchema>;

export interface ProvisionResponse {
  deviceId: string;
  token: string;
  /** Where to connect: the platform's broker. */
  mqtt: { host: string; port: number; tls: boolean };
  /** Unassigned devices of a key that issues them: for the label. */
  claimCode: string | null;
}

// ── CSV import ───────────────────────────────────────────────────────────────────────────────

const optionalNumber = z
  .string()
  .optional()
  .transform((s) => (s === undefined || s.trim() === '' ? undefined : Number(s)))
  .pipe(z.number().finite().optional());

/** One row of a device import, as text from the CSV. */
export const ImportRowSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    profile: z.string().trim().min(1, 'Profile is required'),
    customer: z.string().trim().optional().transform((s) => s || undefined),
    group: z.string().trim().optional().transform((s) => s || undefined),
    tags: z
      .string()
      .optional()
      .transform((s) => (s ?? '').split(';').map((t) => t.trim()).filter(Boolean))
      .pipe(z.array(z.string().regex(KEY_PATTERN, 'Tags use letters, digits, ".", "_" or "-"')).max(20)),
    lat: optionalNumber.pipe(z.number().min(-90).max(90).optional()),
    lng: optionalNumber.pipe(z.number().min(-180).max(180).optional()),
    claim: z
      .string()
      .optional()
      .transform((s) => /^(y|yes|true|1)$/i.test((s ?? '').trim())),
    serial: z
      .string()
      .optional()
      .transform((s) => (s ?? '').trim() || undefined)
      .pipe(z.string().regex(SERIAL_PATTERN, 'Use letters, digits, ".", "_", ":" or "-" (up to 64)').optional()),
  })
  .refine((r) => (r.lat === undefined) === (r.lng === undefined), { message: 'Give both lat and lng, or neither', path: ['lat'] });
export type ImportRow = z.infer<typeof ImportRowSchema>;

export const IMPORT_COLUMNS = ['name', 'profile', 'customer', 'group', 'tags', 'lat', 'lng', 'claim', 'serial'] as const;
export const IMPORT_MAX_ROWS = 5000;

export interface ImportReport {
  ok: boolean;
  rows: number;
  /** Row numbers are 1-based data rows (the header is row 0). */
  errors: { row: number; field: string; message: string }[];
  /** After a real import: one line per device, with credentials (shown once). */
  created?: { id: string; name: string; token: string; claimCode: string | null }[];
}

// ── Bulk operations ──────────────────────────────────────────────────────────────────────────

export const BulkActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('assign'), customerId: Uuid.nullable() }),
  z.object({ kind: z.literal('group'), groupId: Uuid.nullable() }),
  z.object({ kind: z.literal('tags'), add: z.array(z.string().regex(KEY_PATTERN)).max(20).default([]), remove: z.array(z.string().max(64)).max(20).default([]) }),
  z.object({ kind: z.literal('command'), name: z.string().max(64), params: z.record(z.unknown()).default({}) }),
  z.object({ kind: z.literal('delete') }),
  /** Attach to an asset of the device's customer, or detach (null). */
  z.object({ kind: z.literal('asset'), assetId: Uuid.nullable() }),
]);
export type BulkAction = z.infer<typeof BulkActionSchema>;

export const BulkRequestSchema = z.object({
  deviceIds: z.array(Uuid).min(1).max(500),
  action: BulkActionSchema,
});

export interface BulkResult {
  ok: number;
  results: { deviceId: string; ok: boolean; error?: string }[];
}
