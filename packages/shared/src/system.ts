import { z } from 'zod';
import { TimezoneSchema } from './alarms.js';

// ── Backups ──────────────────────────────────────────────────────────────────────────────────

export const BackupScheduleSchema = z.object({
  enabled: z.boolean().default(true),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)').default('02:00'),
  timezone: TimezoneSchema.default('UTC'),
});
export type BackupSchedule = z.infer<typeof BackupScheduleSchema>;

export interface BackupInfo {
  file: string;
  size: number;
  sha256: string;
  version: string;
  createdAt: number;
}

export interface BackupStatusDto {
  latest: BackupInfo | null;
  running: boolean;
  lastError: { at: number; message: string } | null;
  schedule: BackupSchedule;
  nextRunAt: number | null;
  /** False when the server has no BACKUP_PASSPHRASE (backups are then unavailable). */
  configured: boolean;
}

export const RESTORE_STATES = ['idle', 'checking', 'restoring', 'migrating', 'done', 'failed'] as const;
export interface RestoreStatusDto {
  state: (typeof RESTORE_STATES)[number];
  message: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

/** semver-ish `major.minor.patch` → numbers, or null. */
function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** A backup restores into the same major version when it is not newer; older ones run migrations. */
export function isCompatibleBackup(backup: string, current: string): { ok: true; migrate: boolean } | { ok: false; reason: string } {
  const b = parseVersion(backup);
  const c = parseVersion(current);
  if (!b || !c) return { ok: false, reason: `Unrecognised version "${backup}"` };
  if (b[0] !== c[0]) return { ok: false, reason: `The backup is from version ${backup}; this server runs ${current} (a different major version)` };
  const cmp = b[1] - c[1] || b[2] - c[2];
  if (cmp > 0) return { ok: false, reason: `The backup is from a newer version (${backup}) than this server (${current}); update first` };
  return { ok: true, migrate: cmp < 0 };
}

// ── System status ────────────────────────────────────────────────────────────────────────────

export interface ProcessInfo {
  role: string;
  instance: string;
  version: string;
  startedAt: number;
  lastSeen: number;
}

export interface SystemStatusDto {
  version: string;
  processes: ProcessInfo[];
  /** Roles a complete deployment runs, for spotting missing ones. */
  expectedRoles: string[];
  messagesPerMinute: number;
  connectedDevices: number;
  websocketClients: number;
  queues: Record<string, { waiting: number; active: number; failed: number; delayed: number }>;
  database: { sizeBytes: number };
  storage: { driver: 'local' | 's3'; usedBytes: number | null; freeBytes: number | null };
  backup: Pick<BackupStatusDto, 'latest' | 'lastError' | 'running'>;
  maintenance: boolean;
}

// ── AWS IoT Core ─────────────────────────────────────────────────────────────────────────────

/** Credentials for a device on AWS IoT Core. Returned once; the private key is not kept. */
export interface AwsIotBundle {
  endpoint: string;
  /** MQTT client id: must equal the thing name (the device id). */
  clientId: string;
  certificatePem: string;
  privateKey: string;
  /** Amazon's root CA for the endpoint's TLS certificate. */
  rootCaUrl: string;
  topicPrefix: string;
}
