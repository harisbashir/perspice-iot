import { type AlarmRuleInput, type AlarmSchedule, type DeviceStatus, type GeofenceShape, type LatLng, distanceToBoundaryM, isInside } from '@perspice/shared';

type DistributivePick<T, K extends keyof T> = T extends unknown ? Pick<T, K> : never;

/** The parts of a rule the evaluator needs. */
export type EvalRule = DistributivePick<AlarmRuleInput, 'type' | 'condition' | 'clear' | 'schedule'>;

/** Per-(rule, device) state, kept in Redis by the engine. */
export interface RuleState {
  /** An alarm for this rule and device is open. */
  active: boolean;
  /** `duration`: when the condition became true. */
  pendingSince?: number;
  /** `duration`: the value that started (or last kept) the pending condition. */
  pendingValue?: number;
  /** `rate_of_change`: the previous sample. */
  prev?: { ts: number; v: number };
  /** `no_data_key`: when the key last reported (or when watching started). */
  lastSeen?: number;
}

export type EvalInput =
  | { kind: 'telemetry'; ts: number; values: Record<string, unknown> }
  | { kind: 'status'; ts: number; status: DeviceStatus }
  /** Time passing without data (scheduler): fires `duration` and `no_data_key`. */
  | { kind: 'tick'; ts: number }
  /** A new location fix, with the geofences the device's rules refer to. */
  | { kind: 'location'; ts: number; fix: LatLng; geofences: Record<string, { name: string; shape: GeofenceShape }> };

export interface EvalResult {
  state: RuleState;
  transition: 'raise' | 'clear' | null;
  value?: { key: string; v: unknown };
  message?: string;
}

type Op = '>' | '>=' | '<' | '<=';

const compare = (v: number, op: Op, x: number) => (op === '>' ? v > x : op === '>=' ? v >= x : op === '<' ? v < x : v <= x);

/** Past the threshold by at least `margin` in the safe direction (hysteresis). */
function clearedBeyond(v: number, op: Op, x: number, margin: number): boolean {
  switch (op) {
    case '>':
      return v <= x - margin;
    case '>=':
      return v < x - margin;
    case '<':
      return v >= x + margin;
    case '<=':
      return v > x + margin;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : JSON.stringify(v));

// ── Schedules ────────────────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatters = new Map<string, Intl.DateTimeFormat>();

function localTime(ts: number, tz: string): { day: number; minutes: number } {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  return { day: WEEKDAYS.indexOf(parts.weekday!), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Whether `ts` falls in the schedule. `days` are the days a window starts on; a window whose end
 * is before its start runs past midnight into the next day. Equal start and end = the whole day.
 */
export function inSchedule(s: AlarmSchedule, ts: number, fallbackTz: string): boolean {
  const { day, minutes } = localTime(ts, s.timezone ?? fallbackTz);
  const from = toMinutes(s.from);
  const to = toMinutes(s.to);
  if (from === to) return s.days.includes(day);
  if (from < to) return s.days.includes(day) && minutes >= from && minutes < to;
  return (s.days.includes(day) && minutes >= from) || (s.days.includes((day + 6) % 7) && minutes < to);
}

// ── Evaluation ───────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates one rule for one device against one input. Pure: the caller persists `state` and acts
 * on `transition`. Outside the rule's schedule nothing is raised and pending conditions reset;
 * open alarms can still clear.
 */
export function evaluate(rule: EvalRule, state: RuleState, input: EvalInput, timezone: string): EvalResult {
  const scheduled = !rule.schedule || inSchedule(rule.schedule, input.ts, timezone);
  const r = step(rule, { ...state }, input);
  if (r.transition === 'raise' && !scheduled) {
    return { state: { ...r.state, active: false, pendingSince: undefined, pendingValue: undefined }, transition: null };
  }
  if (!scheduled && !r.state.active) r.state.pendingSince = undefined;
  if (r.transition) r.state.active = r.transition === 'raise';
  return r;
}

function step(rule: EvalRule, s: RuleState, input: EvalInput): EvalResult {
  const none = (): EvalResult => ({ state: s, transition: null });

  if (rule.type === 'status') {
    if (input.kind !== 'status') return none();
    const hit = rule.condition.statuses.includes(input.status as 'offline' | 'dead');
    if (hit && !s.active) return { state: s, transition: 'raise', value: { key: 'status', v: input.status }, message: `Device is ${input.status}` };
    if (!hit && s.active) return { state: s, transition: 'clear', value: { key: 'status', v: input.status } };
    return none();
  }

  if (rule.type === 'geofence') {
    if (input.kind !== 'location') return none();
    const g = input.geofences[rule.condition.geofenceId];
    if (!g) return none();
    const inside = isInside(input.fix, g.shape);
    const hit = rule.condition.trigger === 'outside' ? !inside : inside;
    const value = { key: 'location', v: { lat: input.fix.lat, lng: input.fix.lng } };
    if (!s.active && hit) return { state: s, transition: 'raise', value, message: `${inside ? 'Entered' : 'Left'} ${g.name}` };
    // Back on the safe side by at least the margin: GPS jitter at the edge doesn't clear it.
    if (s.active && !hit && distanceToBoundaryM(input.fix, g.shape) >= rule.clear.marginM) return { state: s, transition: 'clear', value };
    return none();
  }

  if (rule.type === 'no_data_key') {
    const { key, forS } = rule.condition;
    s.lastSeen ??= input.ts;
    if (input.kind === 'telemetry' && key in input.values) {
      s.lastSeen = input.ts;
      return s.active ? { state: s, transition: 'clear', value: { key, v: input.values[key] } } : none();
    }
    if (!s.active && input.ts - s.lastSeen >= forS * 1000) {
      return { state: s, transition: 'raise', message: `No ${key} for ${Math.round((input.ts - s.lastSeen) / 60_000)} min` };
    }
    return none();
  }

  if (rule.type === 'duration' && input.kind === 'tick') {
    const { key, op, value, forS } = rule.condition;
    if (!s.active && s.pendingSince !== undefined && input.ts - s.pendingSince >= forS * 1000) {
      const v = s.pendingValue;
      return { state: s, transition: 'raise', value: { key, v }, message: `${key} has been ${op} ${value} for ${forS} s` };
    }
    return none();
  }

  if (input.kind !== 'telemetry') return none();

  switch (rule.type) {
    case 'threshold': {
      const { key, op, value } = rule.condition;
      const v = num(input.values[key]);
      if (v === null) return none();
      if (!s.active && compare(v, op, value)) return { state: s, transition: 'raise', value: { key, v }, message: `${key} is ${fmt(v)} (${op} ${value})` };
      if (s.active && clearedBeyond(v, op, value, rule.clear.margin)) return { state: s, transition: 'clear', value: { key, v } };
      return none();
    }
    case 'range': {
      const { key, min, max, mode } = rule.condition;
      const v = num(input.values[key]);
      if (v === null) return none();
      const m = rule.clear.margin;
      const hit = mode === 'outside' ? v < min || v > max : v >= min && v <= max;
      const cleared = mode === 'outside' ? v >= min + m && v <= max - m : v < min - m || v > max + m;
      if (!s.active && hit) {
        return { state: s, transition: 'raise', value: { key, v }, message: `${key} is ${fmt(v)} (${mode === 'outside' ? 'outside' : 'inside'} ${min}–${max})` };
      }
      if (s.active && cleared) return { state: s, transition: 'clear', value: { key, v } };
      return none();
    }
    case 'duration': {
      const { key, op, value, forS } = rule.condition;
      const v = num(input.values[key]);
      if (v === null) return none();
      if (s.active) {
        if (clearedBeyond(v, op, value, rule.clear.margin)) {
          s.pendingSince = undefined;
          return { state: s, transition: 'clear', value: { key, v } };
        }
        return none();
      }
      if (!compare(v, op, value)) {
        s.pendingSince = undefined;
        s.pendingValue = undefined;
        return none();
      }
      s.pendingSince ??= input.ts;
      s.pendingValue = v;
      if (input.ts - s.pendingSince >= forS * 1000) {
        return { state: s, transition: 'raise', value: { key, v }, message: `${key} has been ${op} ${value} for ${forS} s (now ${fmt(v)})` };
      }
      return none();
    }
    case 'rate_of_change': {
      const { key, perMinute, direction } = rule.condition;
      const v = num(input.values[key]);
      if (v === null) return none();
      const prev = s.prev;
      s.prev = { ts: input.ts, v };
      if (!prev || input.ts <= prev.ts) return none();
      const rate = (v - prev.v) / ((input.ts - prev.ts) / 60_000);
      const signed = direction === 'up' ? rate : direction === 'down' ? -rate : Math.abs(rate);
      if (!s.active && signed >= perMinute) {
        return { state: s, transition: 'raise', value: { key, v }, message: `${key} changing ${fmt(Math.abs(rate))}/min` };
      }
      if (s.active && signed < perMinute - rule.clear.margin) return { state: s, transition: 'clear', value: { key, v } };
      return none();
    }
    case 'state_match': {
      const { key, values } = rule.condition;
      if (!(key in input.values)) return none();
      const v = input.values[key];
      const hit = values.some((x) => x === v);
      if (!s.active && hit) return { state: s, transition: 'raise', value: { key, v }, message: `${key} is ${fmt(v)}` };
      if (s.active && !hit) return { state: s, transition: 'clear', value: { key, v } };
      return none();
    }
  }
  return none();
}
