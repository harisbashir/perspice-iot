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

/** The oldest release whose backups the migrations can bring forward. */
export const OLDEST_RESTORABLE_VERSION = '0.1.0';

const compareVersions = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * A backup restores when it isn't newer than the server and not older than the oldest release the
 * migrations start from; older backups are migrated forward (across majors: 1.0 changed no schema).
 */
export function isCompatibleBackup(backup: string, current: string): { ok: true; migrate: boolean } | { ok: false; reason: string } {
  // The same build is always compatible, also with a non-release version (e.g. a test image tag).
  if (backup === current) return { ok: true, migrate: false };
  const b = parseVersion(backup);
  const c = parseVersion(current);
  if (!b || !c) return { ok: false, reason: `Unrecognised version "${backup}"` };
  const cmp = compareVersions(b, c);
  if (cmp > 0) return { ok: false, reason: `The backup is from a newer version (${backup}) than this server (${current}); update first` };
  if (compareVersions(b, parseVersion(OLDEST_RESTORABLE_VERSION)!) < 0) {
    return { ok: false, reason: `The backup is from ${backup}, older than ${OLDEST_RESTORABLE_VERSION}, which this server can't migrate` };
  }
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
