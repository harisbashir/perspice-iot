import { z } from 'zod';

/**
 * Energy (spec §11): tariffs and the grouping of hourly consumption into local periods with cost.
 * Pure, so the server computes it and widgets and tests share the types.
 */

const Hour = z.number().int().min(0).max(24);

export const TariffPeriodSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    /** Price per unit of the energy key (e.g. per kWh). */
    rate: z.number().min(0).max(1_000_000),
    /** Weekdays, 0 = Sunday. */
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    /** Local hours, from inclusive to exclusive (17–21 is 17:00 to 21:00). */
    from: Hour,
    to: Hour,
  })
  .refine((p) => p.to > p.from, { message: 'A period ends after it starts', path: ['to'] });

export type TariffPeriod = z.infer<typeof TariffPeriodSchema>;

export const TariffSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, 'A three-letter currency code, e.g. EUR'),
  /** Outside every period (or the only rate of a flat tariff). */
  defaultRate: z.number().min(0).max(1_000_000),
  /** Time-of-use periods; the first one covering an hour applies. */
  periods: z.array(TariffPeriodSchema).max(10).default([]),
});
export type Tariff = z.infer<typeof TariffSchema>;

export interface TariffDto extends Tariff {
  /** The customer this tariff is for; null for the platform default. */
  customerId: string | null;
  /** True when a customer has none of its own and the platform default applies. */
  inherited: boolean;
}

export type EnergyPeriod = 'hour' | 'day' | 'week' | 'month';
export const ENERGY_PERIODS: EnergyPeriod[] = ['hour', 'day', 'week', 'month'];

export interface EnergyTotals {
  consumption: number;
  cost: number | null;
}

export interface EnergyData {
  key: string;
  unit: string | null;
  timezone: string;
  currency: string | null;
  period: EnergyPeriod;
  /** `period` labels are local: 2026-10-07T17:00 (hour), 2026-10-07 (day, and the Monday of a week), 2026-10 (month). */
  periods: ({ period: string } & EnergyTotals)[];
  total: EnergyTotals;
  /** The same length of time just before. */
  previous: EnergyTotals;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The local date (YYYY-MM-DD), weekday (0 = Sunday) and hour of an instant in a timezone. */
export function localParts(ts: number, timezone: string): { date: string; weekday: number; hour: number } {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' });
    formatters.set(timezone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(ts).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAYS.indexOf(parts.weekday!), hour: Number(parts.hour) % 24 };
}

export function rateAt(tariff: Tariff, weekday: number, hour: number): number {
  const p = tariff.periods.find((x) => x.days.includes(weekday) && hour >= x.from && hour < x.to);
  return p ? p.rate : tariff.defaultRate;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

function label(parts: { date: string; weekday: number; hour: number }, period: EnergyPeriod): string {
  switch (period) {
    case 'hour':
      return `${parts.date}T${String(parts.hour).padStart(2, '0')}:00`;
    case 'day':
      return parts.date;
    case 'month':
      return parts.date.slice(0, 7);
    case 'week': {
      const [y, m, d] = parts.date.split('-').map(Number) as [number, number, number];
      const monday = new Date(Date.UTC(y, m - 1, d - ((parts.weekday + 6) % 7)));
      return monday.toISOString().slice(0, 10);
    }
  }
}

/**
 * Groups hourly consumption (`ts` = the hour's start) into local periods, each hour priced at the
 * tariff's rate for its local weekday and hour. Cost is null without a tariff.
 */
export function groupEnergy(hours: readonly { ts: number; v: number }[], period: EnergyPeriod, timezone: string, tariff: Tariff | null): { periods: EnergyData['periods']; total: EnergyTotals } {
  const groups = new Map<string, { consumption: number; cost: number }>();
  let consumption = 0;
  let cost = 0;
  for (const h of [...hours].sort((a, b) => a.ts - b.ts)) {
    const parts = localParts(h.ts, timezone);
    const c = tariff ? h.v * rateAt(tariff, parts.weekday, parts.hour) : 0;
    const key = label(parts, period);
    const g = groups.get(key) ?? { consumption: 0, cost: 0 };
    g.consumption += h.v;
    g.cost += c;
    groups.set(key, g);
    consumption += h.v;
    cost += c;
  }
  return {
    periods: [...groups].map(([p, g]) => ({ period: p, consumption: round(g.consumption, 6), cost: tariff ? round(g.cost, 4) : null })),
    total: { consumption: round(consumption, 6), cost: tariff ? round(cost, 4) : null },
  };
}

/** What an energy summary covers: the dashboard's timewindow, or this calendar period so far. */
export const ENERGY_RANGES = ['window', 'today', 'week', 'month', 'year'] as const;
export type EnergyRange = (typeof ENERGY_RANGES)[number];

/**
 * The start of the current local day, week (Monday), month or year, as the UTC hour bucket that
 * contains local midnight (zones with half-hour offsets are approximated to the hour).
 */
export function calendarStart(now: number, timezone: string, range: Exclude<EnergyRange, 'window'>): number {
  const p = localParts(now, timezone);
  const [y, m, d] = p.date.split('-').map(Number) as [number, number, number];
  const target =
    range === 'today'
      ? Date.UTC(y, m - 1, d)
      : range === 'week'
        ? Date.UTC(y, m - 1, d - ((p.weekday + 6) % 7))
        : range === 'month'
          ? Date.UTC(y, m - 1, 1)
          : Date.UTC(y, 0, 1);
  let t = target;
  for (let i = 0; i < 3; i++) {
    const lp = localParts(t, timezone);
    const local = Date.parse(`${lp.date}T${String(lp.hour).padStart(2, '0')}:00:00Z`);
    if (local === target) break;
    t += target - local;
  }
  return Math.floor(t / 3_600_000) * 3_600_000;
}

/** The previous calendar period's start (for "compared with the same point last period"). */
export function previousCalendarStart(start: number, timezone: string, range: Exclude<EnergyRange, 'window'>): number {
  // Any instant just before this period's start lies in the previous period.
  return calendarStart(start - 3_600_000, timezone, range);
}

/** Hourly up to two days, daily up to about three months, else monthly. */
export function periodFor(from: number, to: number): EnergyPeriod {
  const span = to - from;
  if (span <= 2 * 86_400_000) return 'hour';
  if (span <= 93 * 86_400_000) return 'day';
  return 'month';
}
