import { describe, expect, it } from 'vitest';
import { TariffSchema, calendarStart, groupEnergy, localParts, periodFor, previousCalendarStart, rateAt } from '../src/energy.js';

const H = 3_600_000;
const utc = (s: string) => Date.parse(`${s}Z`);

describe('local time parts', () => {
  it('gives the local date, weekday and hour in a timezone', () => {
    // 2026-03-29 00:30 UTC is a Sunday; in London summer time starts at 01:00 UTC that day.
    expect(localParts(utc('2026-03-29T00:30:00'), 'Europe/London')).toEqual({ date: '2026-03-29', weekday: 0, hour: 0 });
    expect(localParts(utc('2026-03-29T01:30:00'), 'Europe/London')).toEqual({ date: '2026-03-29', weekday: 0, hour: 2 });
    expect(localParts(utc('2026-10-09T22:00:00'), 'Asia/Karachi')).toEqual({ date: '2026-10-10', weekday: 6, hour: 3 });
  });
});

describe('tariffs', () => {
  const tou = TariffSchema.parse({
    currency: 'GBP',
    defaultRate: 0.2,
    periods: [
      { name: 'Peak', rate: 0.4, days: [1, 2, 3, 4, 5], from: 17, to: 21 },
      { name: 'Night', rate: 0.1, days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 7 },
    ],
  });

  it('uses the first period covering the weekday and hour, else the default rate', () => {
    expect(rateAt(tou, 3, 18)).toBe(0.4);
    expect(rateAt(tou, 3, 21)).toBe(0.2); // "to" is exclusive
    expect(rateAt(tou, 6, 18)).toBe(0.2); // Saturday: no peak
    expect(rateAt(tou, 6, 3)).toBe(0.1);
  });

  it('rejects periods that end before they start, and odd currencies', () => {
    expect(TariffSchema.safeParse({ currency: 'GBP', defaultRate: 1, periods: [{ name: 'X', rate: 1, days: [1], from: 10, to: 9 }] }).success).toBe(false);
    expect(TariffSchema.safeParse({ currency: 'pounds', defaultRate: 1 }).success).toBe(false);
    expect(TariffSchema.parse({ currency: 'EUR', defaultRate: 0.3 }).periods).toEqual([]);
  });

  it('groups hourly use by day in the timezone, priced at each hour’s rate', () => {
    // Wednesday 2026-10-07 in London (UTC+1): 16:00–19:00 local = 15:00–18:00 UTC.
    const hours = [
      { ts: utc('2026-10-07T15:00:00'), v: 1 }, // 16:00 local, default
      { ts: utc('2026-10-07T16:00:00'), v: 2 }, // 17:00 peak
      { ts: utc('2026-10-07T17:00:00'), v: 2 }, // 18:00 peak
      { ts: utc('2026-10-07T23:00:00'), v: 4 }, // 00:00 Thursday, night
    ];
    const out = groupEnergy(hours, 'day', 'Europe/London', tou);
    expect(out.periods).toEqual([
      { period: '2026-10-07', consumption: 5, cost: 1.8 },
      { period: '2026-10-08', consumption: 4, cost: 0.4 },
    ]);
    expect(out.total).toEqual({ consumption: 9, cost: 2.2 });
  });

  it('groups weeks from Monday and months, and leaves cost null without a tariff', () => {
    const hours = [utc('2026-10-04T12:00:00'), utc('2026-10-05T12:00:00'), utc('2026-10-11T12:00:00'), utc('2026-11-01T12:00:00')].map((ts) => ({ ts, v: 1 }));
    expect(groupEnergy(hours, 'week', 'UTC', null).periods).toEqual([
      { period: '2026-09-28', consumption: 1, cost: null }, // Sunday the 4th belongs to the week of Monday the 28th
      { period: '2026-10-05', consumption: 2, cost: null },
      { period: '2026-10-26', consumption: 1, cost: null },
    ]);
    expect(groupEnergy(hours, 'month', 'UTC', null).periods.map((p) => [p.period, p.consumption])).toEqual([
      ['2026-10', 3],
      ['2026-11', 1],
    ]);
    expect(groupEnergy(hours, 'hour', 'UTC', null).periods[0]).toEqual({ period: '2026-10-04T12:00', consumption: 1, cost: null });
    expect(groupEnergy([], 'day', 'UTC', null).total).toEqual({ consumption: 0, cost: null });
  });

  it('rounds sums so floating point noise does not show', () => {
    const hours = Array.from({ length: 10 }, (_, i) => ({ ts: utc('2026-10-07T00:00:00') + i * H, v: 0.1 }));
    expect(groupEnergy(hours, 'day', 'UTC', TariffSchema.parse({ currency: 'EUR', defaultRate: 0.3 })).total).toEqual({ consumption: 1, cost: 0.3 });
  });
});

describe('calendar periods', () => {
  const now = utc('2026-10-07T10:20:00'); // Wednesday, 11:20 in London (UTC+1)

  it('starts today, this week, this month and this year at local midnight', () => {
    expect(calendarStart(now, 'Europe/London', 'today')).toBe(utc('2026-10-06T23:00:00'));
    expect(calendarStart(now, 'Europe/London', 'week')).toBe(utc('2026-10-04T23:00:00'));
    expect(calendarStart(now, 'Europe/London', 'month')).toBe(utc('2026-09-30T23:00:00'));
    expect(calendarStart(now, 'Europe/London', 'year')).toBe(utc('2026-01-01T00:00:00')); // winter time: UTC+0
    expect(calendarStart(now, 'UTC', 'today')).toBe(utc('2026-10-07T00:00:00'));
    expect(calendarStart(now, 'America/New_York', 'today')).toBe(utc('2026-10-07T04:00:00'));
  });

  it('finds the previous period across a clock change', () => {
    // London's clocks went back on 2026-10-25: the previous month (October) started at UTC+1.
    const nov = utc('2026-11-10T12:00:00');
    const start = calendarStart(nov, 'Europe/London', 'month');
    expect(start).toBe(utc('2026-11-01T00:00:00'));
    expect(previousCalendarStart(start, 'Europe/London', 'month')).toBe(utc('2026-09-30T23:00:00'));
  });

  it('picks a period length for a window', () => {
    expect(periodFor(0, 86_400_000)).toBe('hour');
    expect(periodFor(0, 31 * 86_400_000)).toBe('day');
    expect(periodFor(0, 365 * 86_400_000)).toBe('month');
  });
});
