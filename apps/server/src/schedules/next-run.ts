import type { ScheduleCadence } from '@perspice/shared';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock parts of `ts` in `tz`. */
function parts(ts: number, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!) };
}

/** UTC instant of a wall-clock time in `tz` (two passes settle DST offsets). */
function zoned(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, h, min);
  let ts = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(ts, tz);
    ts += wall - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  }
  return ts;
}

/** The first run strictly after `after`. */
export function nextRun(c: ScheduleCadence, tz: string, after: number): number {
  const [h, min] = c.time.split(':').map(Number) as [number, number];
  const start = parts(after, tz);
  for (let i = 0; i < 62; i++) {
    // Walk calendar days in the zone (noon avoids DST edges when stepping).
    const day = parts(zoned(start.y, start.m, start.d, 12, 0, tz) + i * 86_400_000, tz);
    if (c.kind === 'weekly' && day.weekday !== c.day) continue;
    if (c.kind === 'monthly' && day.d !== c.day) continue;
    const ts = zoned(day.y, day.m, day.d, h, min, tz);
    if (ts > after) return ts;
  }
  throw new Error('No run within 62 days');
}
