import { describe, expect, it } from 'vitest';
import { nextRun } from '../../src/schedules/next-run';

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

describe('next run', () => {
  it('daily, later today or tomorrow', () => {
    expect(iso(nextRun({ kind: 'daily', time: '07:30' }, 'UTC', Date.UTC(2026, 0, 5, 6, 0)))).toBe('2026-01-05T07:30');
    expect(iso(nextRun({ kind: 'daily', time: '07:30' }, 'UTC', Date.UTC(2026, 0, 5, 7, 30)))).toBe('2026-01-06T07:30');
  });

  it('follows the timezone across DST changes', () => {
    // London: GMT until 29 March 2026, then BST (UTC+1).
    expect(iso(nextRun({ kind: 'daily', time: '07:30' }, 'Europe/London', Date.UTC(2026, 2, 28, 12, 0)))).toBe('2026-03-29T06:30');
    expect(iso(nextRun({ kind: 'daily', time: '07:30' }, 'Europe/London', Date.UTC(2026, 2, 27, 12, 0)))).toBe('2026-03-28T07:30');
    expect(iso(nextRun({ kind: 'daily', time: '00:15' }, 'Asia/Karachi', Date.UTC(2026, 5, 1, 12, 0)))).toBe('2026-06-01T19:15');
  });

  it('weekly on a weekday', () => {
    // 2026-01-05 is a Monday; next Friday 09:00 New York (UTC-5).
    expect(iso(nextRun({ kind: 'weekly', day: 5, time: '09:00' }, 'America/New_York', Date.UTC(2026, 0, 5, 12, 0)))).toBe('2026-01-09T14:00');
    expect(iso(nextRun({ kind: 'weekly', day: 1, time: '09:00' }, 'UTC', Date.UTC(2026, 0, 5, 10, 0)))).toBe('2026-01-12T09:00');
  });

  it('monthly on a day of the month', () => {
    expect(iso(nextRun({ kind: 'monthly', day: 1, time: '06:00' }, 'UTC', Date.UTC(2026, 0, 15)))).toBe('2026-02-01T06:00');
    expect(iso(nextRun({ kind: 'monthly', day: 28, time: '06:00' }, 'UTC', Date.UTC(2026, 1, 3)))).toBe('2026-02-28T06:00');
  });
});
