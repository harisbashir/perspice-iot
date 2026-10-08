import { describe, expect, it } from 'vitest';
import { normalizeTelemetry } from '../../src/ingest/normalize';

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const buf = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v));

describe('normalizeTelemetry', () => {
  it('maps value types to columns', () => {
    const r = normalizeTelemetry(buf({ ts: NOW - 1000, values: { t: 21.5, s: 'ok', b: true, o: { a: 1 } } }), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byKey = Object.fromEntries(r.rows.map((x) => [x.key, x]));
    expect(byKey.t).toEqual({ key: 't', ts: NOW - 1000, valueNum: 21.5, valueStr: null, valueBool: null, valueJson: null });
    expect(byKey.s).toMatchObject({ valueStr: 'ok', valueNum: null });
    expect(byKey.b).toMatchObject({ valueBool: true, valueNum: null });
    expect(byKey.o).toMatchObject({ valueJson: { a: 1 }, valueNum: null });
    expect(r.adjusted).toBe(0);
  });

  it('uses server time when ts is absent', () => {
    const r = normalizeTelemetry(buf({ values: { t: 1 } }), NOW);
    expect(r.ok && r.rows[0]!.ts).toBe(NOW);
  });

  describe('bad device timestamps (Review Focus 1)', () => {
    it('converts a seconds timestamp to ms', () => {
      const r = normalizeTelemetry(buf({ ts: Math.floor(NOW / 1000) - 10, values: { t: 1 } }), NOW);
      expect(r.ok && r.rows[0]!.ts).toBe((Math.floor(NOW / 1000) - 10) * 1000);
      expect(r.ok && r.adjusted).toBe(0);
    });

    it('replaces ts 0 (before NTP sync) with now and counts it', () => {
      const r = normalizeTelemetry(buf({ ts: 0, values: { t: 1 } }), NOW);
      expect(r.ok && r.rows[0]!.ts).toBe(NOW);
      expect(r.ok && r.adjusted).toBe(1);
    });

    it('replaces a 1970 millisecond timestamp with now', () => {
      const r = normalizeTelemetry(buf({ ts: 86_400_000_000, values: { t: 1 } }), NOW);
      expect(r.ok && r.rows[0]!.ts).toBe(NOW);
    });

    it('replaces a timestamp more than 1 h in the future with now', () => {
      const r = normalizeTelemetry(buf({ ts: NOW + 2 * 3_600_000, values: { t: 1 } }), NOW);
      expect(r.ok && r.rows[0]!.ts).toBe(NOW);
      expect(r.ok && r.adjusted).toBe(1);
      const near = normalizeTelemetry(buf({ ts: NOW + 59 * 60_000, values: { t: 1 } }), NOW);
      expect(near.ok && near.rows[0]!.ts).toBe(NOW + 59 * 60_000);
    });
  });

  it('preserves per-entry timestamps in a batch', () => {
    const r = normalizeTelemetry(
      buf([
        { ts: NOW - 2000, values: { t: 1 } },
        { ts: NOW - 1000, values: { t: 2 } },
        { values: { t: 3 } },
      ]),
      NOW,
    );
    expect(r.ok && r.rows.map((x) => [x.ts, x.valueNum])).toEqual([
      [NOW - 2000, 1],
      [NOW - 1000, 2],
      [NOW, 3],
    ]);
  });

  describe('oversized/hostile payloads (Review Focus 3)', () => {
    it('rejects payloads over 64 KB', () => {
      const r = normalizeTelemetry(Buffer.alloc(70 * 1024, 'a'), NOW);
      expect(r).toEqual({ ok: false, reason: 'payload_too_large' });
    });

    it('rejects more than 200 keys in a message', () => {
      const values = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, i]));
      expect(normalizeTelemetry(buf({ values }), NOW)).toEqual({ ok: false, reason: 'too_many_keys' });
    });

    it('rejects keys with "/" or SQL characters', () => {
      expect(normalizeTelemetry(buf({ values: { 'a/b': 1 } }), NOW)).toEqual({ ok: false, reason: 'invalid_key' });
      expect(normalizeTelemetry(buf({ values: { "x');DROP TABLE": 1 } }), NOW)).toEqual({ ok: false, reason: 'invalid_key' });
    });

    it('rejects invalid JSON and schema violations', () => {
      expect(normalizeTelemetry(buf('{not json'), NOW)).toEqual({ ok: false, reason: 'invalid_json' });
      expect(normalizeTelemetry(buf({ value: 1 }), NOW)).toEqual({ ok: false, reason: 'invalid_schema' });
      expect(normalizeTelemetry(buf({ values: { t: null } }), NOW)).toEqual({ ok: false, reason: 'invalid_schema' });
    });

    it('rejects an empty values object', () => {
      expect(normalizeTelemetry(buf({ values: {} }), NOW)).toEqual({ ok: false, reason: 'empty' });
    });
  });
});
