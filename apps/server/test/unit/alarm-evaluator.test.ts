import { describe, expect, it } from 'vitest';
import { type EvalInput, type EvalRule, type RuleState, evaluate, inSchedule } from '../../src/alarms/evaluator';

const T0 = Date.UTC(2026, 9, 5, 12, 0); // Monday 12:00 UTC
const tel = (ts: number, values: Record<string, unknown>): EvalInput => ({ kind: 'telemetry', ts, values });

/** Feeds inputs in order and returns the transitions. */
function run(rule: EvalRule, inputs: EvalInput[], state: RuleState = { active: false }, tz = 'UTC') {
  const out: (string | null)[] = [];
  for (const i of inputs) {
    const r = evaluate(rule, state, i, tz);
    state = r.state;
    out.push(r.transition);
  }
  return { out, state };
}

const threshold = (op: '<' | '<=' | '>' | '>=', value: number, margin = 0): EvalRule => ({ type: 'threshold', condition: { key: 'fuel', op, value }, clear: { margin }, schedule: null });

describe('threshold', () => {
  it('raises once and clears only past the margin (Review Focus 1)', () => {
    const vals = [25, 19, 18, 21, 19.5, 22, 23, 15];
    const { out } = run(threshold('<', 20, 2), vals.map((v, i) => tel(T0 + i * 1000, { fuel: v })));
    expect(out).toEqual([null, 'raise', null, null, null, 'clear', null, 'raise']);
  });

  it('handles every operator at the boundary', () => {
    expect(run(threshold('>', 10), [tel(T0, { fuel: 10 })]).out).toEqual([null]);
    expect(run(threshold('>=', 10), [tel(T0, { fuel: 10 })]).out).toEqual(['raise']);
    expect(run(threshold('<=', 10), [tel(T0, { fuel: 10 }), tel(T0 + 1, { fuel: 10.5 })]).out).toEqual(['raise', 'clear']);
    expect(run(threshold('>', 10, 1), [tel(T0, { fuel: 11 }), tel(T0 + 1, { fuel: 9.5 }), tel(T0 + 2, { fuel: 9 })]).out).toEqual(['raise', null, 'clear']);
  });

  it('ignores other keys and non-numbers', () => {
    expect(run(threshold('<', 20), [tel(T0, { other: 1 }), tel(T0 + 1, { fuel: 'low' }), tel(T0 + 2, { fuel: null })]).out).toEqual([null, null, null]);
  });

  it('describes the raising value', () => {
    const r = evaluate(threshold('<', 20), { active: false }, tel(T0, { fuel: 12.5 }), 'UTC');
    expect(r).toMatchObject({ transition: 'raise', value: { key: 'fuel', v: 12.5 }, message: 'fuel is 12.5 (< 20)' });
  });
});

describe('range', () => {
  const range = (mode: 'outside' | 'inside', margin = 0): EvalRule => ({ type: 'range', condition: { key: 'v', min: 200, max: 250, mode }, clear: { margin }, schedule: null });
  it('outside with margin', () => {
    const vals = [230, 260, 249, 245, 190, 210];
    expect(run(range('outside', 5), vals.map((v, i) => tel(T0 + i, { v }))).out).toEqual([null, 'raise', null, 'clear', 'raise', 'clear']);
  });
  it('inside', () => {
    expect(run(range('inside', 5), [190, 220, 252, 256].map((v, i) => tel(T0 + i, { v }))).out).toEqual([null, 'raise', null, 'clear']);
  });
});

describe('duration', () => {
  const rule: EvalRule = { type: 'duration', condition: { key: 't', op: '>', value: 40, forS: 300 }, clear: { margin: 1 }, schedule: null };
  it('raises after the condition holds for the full period, by data or by tick', () => {
    expect(run(rule, [tel(T0, { t: 41 }), tel(T0 + 299_000, { t: 42 }), tel(T0 + 300_000, { t: 43 })]).out).toEqual([null, null, 'raise']);
    expect(run(rule, [tel(T0, { t: 41 }), { kind: 'tick', ts: T0 + 301_000 }]).out).toEqual([null, 'raise']);
  });
  it('restarts when the condition drops before the period ends', () => {
    expect(run(rule, [tel(T0, { t: 41 }), tel(T0 + 200_000, { t: 39 }), tel(T0 + 250_000, { t: 41 }), { kind: 'tick', ts: T0 + 400_000 }]).out).toEqual([null, null, null, null]);
  });
  it('clears with the margin', () => {
    const r = run(rule, [tel(T0, { t: 41 }), tel(T0 + 300_000, { t: 41 }), tel(T0 + 301_000, { t: 39.5 }), tel(T0 + 302_000, { t: 38.9 })]);
    expect(r.out).toEqual([null, 'raise', null, 'clear']);
  });
});

describe('rate of change', () => {
  const rule = (direction: 'up' | 'down' | 'either'): EvalRule => ({ type: 'rate_of_change', condition: { key: 'f', perMinute: 5, direction }, clear: { margin: 1 }, schedule: null });
  const min = 60_000;
  it('compares the change per minute with the previous sample', () => {
    expect(run(rule('down'), [tel(T0, { f: 80 }), tel(T0 + min, { f: 74 }), tel(T0 + 2 * min, { f: 70 }), tel(T0 + 3 * min, { f: 67 })]).out).toEqual([null, 'raise', null, 'clear']);
    expect(run(rule('up'), [tel(T0, { f: 80 }), tel(T0 + min, { f: 74 })]).out).toEqual([null, null]);
    expect(run(rule('either'), [tel(T0, { f: 80 }), tel(T0 + min, { f: 86 })]).out).toEqual([null, 'raise']);
  });
  it('spreads a change over long gaps', () => {
    expect(run(rule('down'), [tel(T0, { f: 80 }), tel(T0 + 60 * min, { f: 60 })]).out).toEqual([null, null]);
  });
});

describe('state match, status and no data', () => {
  it('matches states', () => {
    const rule: EvalRule = { type: 'state_match', condition: { key: 'door', values: [true, 'open'] }, clear: {}, schedule: null };
    expect(run(rule, [tel(T0, { door: false }), tel(T0 + 1, { door: true }), tel(T0 + 2, { door: 'open' }), tel(T0 + 3, { door: false })]).out).toEqual([null, 'raise', null, 'clear']);
  });
  it('follows device status', () => {
    const rule: EvalRule = { type: 'status', condition: { statuses: ['offline', 'dead'] }, clear: {}, schedule: null };
    const st = (status: string, ts: number): EvalInput => ({ kind: 'status', ts, status: status as never });
    expect(run(rule, [st('offline', T0), st('dead', T0 + 1), st('online', T0 + 2), tel(T0 + 3, { x: 1 })]).out).toEqual(['raise', null, 'clear', null]);
  });
  it('raises when a key stops reporting and clears when it returns', () => {
    const rule: EvalRule = { type: 'no_data_key', condition: { key: 'fuel', forS: 3600 }, clear: {}, schedule: null };
    const h = 3_600_000;
    const r = run(rule, [tel(T0, { fuel: 1 }), tel(T0 + h / 2, { other: 1 }), { kind: 'tick', ts: T0 + h - 1 }, { kind: 'tick', ts: T0 + h }, tel(T0 + 2 * h, { fuel: 2 })]);
    expect(r.out).toEqual([null, null, null, 'raise', 'clear']);
  });
});

describe('schedules', () => {
  const night = { days: [1, 2, 3, 4, 5], from: '22:00', to: '06:00' };
  it('handles windows across midnight', () => {
    expect(inSchedule(night, Date.UTC(2026, 9, 5, 23, 0), 'UTC')).toBe(true); // Mon 23:00
    expect(inSchedule(night, Date.UTC(2026, 9, 6, 5, 59), 'UTC')).toBe(true); // Tue 05:59 (Mon night)
    expect(inSchedule(night, Date.UTC(2026, 9, 6, 6, 0), 'UTC')).toBe(false);
    expect(inSchedule(night, Date.UTC(2026, 9, 5, 3, 0), 'UTC')).toBe(false); // Mon 03:00 belongs to Sunday night
    expect(inSchedule(night, Date.UTC(2026, 9, 10, 23, 0), 'UTC')).toBe(false); // Sat
  });
  it('uses the timezone, including across DST changes', () => {
    const office = { days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '17:00', timezone: 'Europe/London' };
    expect(inSchedule(office, Date.UTC(2026, 6, 1, 8, 30), 'UTC')).toBe(true); // 09:30 BST
    expect(inSchedule(office, Date.UTC(2026, 11, 1, 8, 30), 'UTC')).toBe(false); // 08:30 GMT
  });
  it('does not raise outside the schedule but still clears', () => {
    const rule: EvalRule = { ...threshold('<', 20), schedule: { days: [1], from: '09:00', to: '10:00' } };
    expect(run(rule, [tel(T0, { fuel: 5 })]).out).toEqual([null]); // Monday 12:00
    expect(run(rule, [tel(T0, { fuel: 25 })], { active: true }).out).toEqual(['clear']);
  });
});

describe('geofence', () => {
  const G = '22222222-2222-4222-8222-222222222222';
  const depot = { name: 'Depot', shape: { type: 'circle' as const, center: { lat: 51.5, lng: -0.12 }, radiusM: 500 } };
  /** `m` metres north of the depot's centre. */
  const at = (ts: number, m: number): EvalInput => ({
    kind: 'location',
    ts,
    fix: { lat: 51.5 + m / 111_195, lng: -0.12 },
    geofences: { [G]: depot },
  });
  const rule = (trigger: 'outside' | 'inside', marginM = 20): EvalRule => ({
    type: 'geofence',
    condition: { geofenceId: G, trigger },
    clear: { marginM },
    schedule: null,
  });

  it('raises on leaving and clears only once back inside by the margin', () => {
    // 400 m in, 510 m out, jitter 495 m (5 m inside), 470 m (30 m inside).
    const { out } = run(rule('outside'), [at(T0, 400), at(T0 + 1, 510), at(T0 + 2, 495), at(T0 + 3, 505), at(T0 + 4, 470)]);
    expect(out).toEqual([null, 'raise', null, null, 'clear']);
  });

  it('says which geofence and where', () => {
    const r = evaluate(rule('outside'), { active: false }, at(T0, 900), 'UTC');
    expect(r).toMatchObject({ transition: 'raise', message: 'Left Depot', value: { key: 'location' } });
    expect(evaluate(rule('inside'), { active: false }, at(T0, 10), 'UTC').message).toBe('Entered Depot');
  });

  it('raises on entering with trigger inside', () => {
    const { out } = run(rule('inside'), [at(T0, 900), at(T0 + 1, 450), at(T0 + 2, 510), at(T0 + 3, 600)]);
    expect(out).toEqual([null, 'raise', null, 'clear']);
  });

  it('ignores telemetry, and locations without the geofence', () => {
    expect(run(rule('outside'), [tel(T0, { lat: 0 })]).out).toEqual([null]);
    expect(evaluate(rule('outside'), { active: false }, { ...(at(T0, 900) as Extract<EvalInput, { kind: 'location' }>), geofences: {} }, 'UTC').transition).toBeNull();
  });
});
