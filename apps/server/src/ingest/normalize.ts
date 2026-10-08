import { KEY_PATTERN, MAX_KEYS_PER_MESSAGE, MAX_PAYLOAD_BYTES, TelemetryPayload } from '@perspice/shared';

export interface TelemetryRow {
  key: string;
  ts: number;
  valueNum: number | null;
  valueStr: string | null;
  valueBool: boolean | null;
  valueJson: unknown;
}

export interface WriteRow extends TelemetryRow {
  deviceId: string;
}

export type RejectReason =
  | 'payload_too_large'
  | 'invalid_json'
  | 'invalid_schema'
  | 'too_many_keys'
  | 'invalid_key'
  | 'empty';

export type NormalizeResult = { ok: true; rows: TelemetryRow[]; adjusted: number } | { ok: false; reason: RejectReason };

/** Earliest plausible device timestamp; anything before is an unsynchronised clock. */
export const MIN_VALID_TS = Date.UTC(2020, 0, 1);
export const MAX_FUTURE_MS = 3_600_000;
/** Below this a timestamp is taken to be in seconds rather than milliseconds. */
const SECONDS_THRESHOLD = 1e11;

function toRow(key: string, ts: number, v: unknown): TelemetryRow {
  const row: TelemetryRow = { key, ts, valueNum: null, valueStr: null, valueBool: null, valueJson: null };
  if (typeof v === 'number') row.valueNum = v;
  else if (typeof v === 'string') row.valueStr = v;
  else if (typeof v === 'boolean') row.valueBool = v;
  else row.valueJson = v;
  return row;
}

/**
 * Validates and flattens a telemetry payload (spec §5.1). Bad device clocks are repaired
 * rather than rejected (Review Focus 1); hostile payloads are rejected whole (Review Focus 3).
 */
export function normalizeTelemetry(raw: Buffer, now: number): NormalizeResult {
  if (raw.length > MAX_PAYLOAD_BYTES) return { ok: false, reason: 'payload_too_large' };
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const parsed = TelemetryPayload.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'invalid_schema' };
  const messages = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  const rows: TelemetryRow[] = [];
  let adjusted = 0;
  for (const msg of messages) {
    const keys = Object.keys(msg.values);
    if (keys.length > MAX_KEYS_PER_MESSAGE) return { ok: false, reason: 'too_many_keys' };
    if (!keys.every((k) => KEY_PATTERN.test(k))) return { ok: false, reason: 'invalid_key' };

    let ts = msg.ts ?? now;
    if (msg.ts !== undefined) {
      if (ts < SECONDS_THRESHOLD) ts *= 1000;
      ts = Math.round(ts);
      if (ts < MIN_VALID_TS || ts > now + MAX_FUTURE_MS) {
        ts = now;
        adjusted++;
      }
    }
    for (const k of keys) rows.push(toRow(k, ts, msg.values[k]));
  }
  if (rows.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, rows, adjusted };
}
