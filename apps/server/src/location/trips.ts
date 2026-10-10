import { type LatLng, type TripSettings, haversineM } from '@perspice/shared';

/** Faster than this between two fixes is a bad fix, not driving. */
export const MAX_PLAUSIBLE_KMH = 300;

interface Point extends LatLng {
  ts: number;
}

export interface TripState {
  phase: 'parked' | 'moving';
  /** The last accepted fix. */
  last: Point | null;
  /** Parked: where the device stands. Moving: where movement was last seen. */
  anchor: Point | null;
  lastMoveTs: number | null;
  ignition: boolean | null;
  /** The trip under way (live estimate; final figures are computed from stored fixes). */
  trip: { startTs: number; start: LatLng; distanceM: number; maxSpeedKmh: number } | null;
}

export interface TripInput {
  ts: number;
  fix?: LatLng;
  /** km/h, when the device reports it. */
  speed?: number;
  ignition?: boolean;
}

export type TripEvent =
  | { kind: 'start'; ts: number; at: LatLng }
  /** `trip`: the live figures at the end (distance, top speed). */
  | { kind: 'end'; ts: number; at: LatLng; trip: { distanceM: number; maxSpeedKmh: number } };

export const emptyTripState = (): TripState => ({ phase: 'parked', last: null, anchor: null, lastMoveTs: null, ignition: null, trip: null });

const pos = (p: LatLng): LatLng => ({ lat: p.lat, lng: p.lng });

function end(state: TripState, ts: number, at: LatLng): { state: TripState; events: TripEvent[] } {
  return {
    state: { ...state, phase: 'parked', anchor: { ...pos(at), ts }, lastMoveTs: null, trip: null },
    events: [{ kind: 'end', ts, at: pos(at), trip: { distanceM: state.trip?.distanceM ?? 0, maxSpeedKmh: state.trip?.maxSpeedKmh ?? 0 } }],
  };
}

/**
 * Trip boundaries from a device's fixes (and ignition, when the profile names a key). Without an
 * ignition key, a trip starts when the device leaves its parked spot by `minMoveM` or reports
 * `minSpeedKmh`, and ends at the last movement once `stopAfterS` passes without any. With one,
 * ignition alone starts and ends trips. Pure: the caller keeps the state.
 */
export function stepTrip(state: TripState, input: TripInput, s: TripSettings): { state: TripState; events: TripEvent[] } {
  if (state.last && input.ts <= state.last.ts) return { state, events: [] };
  const ignitionMode = !!s.ignitionKey;
  let next: TripState = { ...state };
  const events: TripEvent[] = [];

  if (input.fix) {
    const p: Point = { ...pos(input.fix), ts: input.ts };
    const prev = state.last;
    const stepM = prev ? haversineM(prev, p) : 0;
    const impliedKmh = prev ? (stepM / Math.max(1, input.ts - prev.ts)) * 3600 : 0;
    const jump = !!prev && impliedKmh > MAX_PLAUSIBLE_KMH;
    next.last = p;
    if (jump) {
      // A bad fix (or a long gap with a big move): keep it as the new reference, add nothing.
      if (next.phase === 'parked') next.anchor = p;
    } else if (next.phase === 'parked') {
      next.anchor ??= p;
      const moved = haversineM(next.anchor, p) >= s.minMoveM || (input.speed ?? 0) >= s.minSpeedKmh;
      if (moved && !ignitionMode) {
        const from = prev ?? p;
        next = {
          ...next,
          phase: 'moving',
          trip: { startTs: from.ts, start: pos(next.anchor), distanceM: stepM, maxSpeedKmh: Math.max(input.speed ?? 0, impliedKmh) },
          anchor: p,
          lastMoveTs: input.ts,
        };
        events.push({ kind: 'start', ts: from.ts, at: pos(state.anchor ?? from) });
      }
      // Otherwise parked jitter: the parked spot stays put.
    } else {
      if (next.trip) {
        next.trip = { ...next.trip, distanceM: next.trip.distanceM + stepM, maxSpeedKmh: Math.max(next.trip.maxSpeedKmh, input.speed ?? 0, impliedKmh) };
      }
      const moved = !next.anchor || haversineM(next.anchor, p) >= s.minMoveM || (input.speed ?? 0) >= s.minSpeedKmh;
      if (moved) {
        next.anchor = p;
        next.lastMoveTs = input.ts;
      } else if (!ignitionMode && next.lastMoveTs !== null && input.ts - next.lastMoveTs >= s.stopAfterS * 1000) {
        const r = end(next, next.lastMoveTs, next.anchor!);
        next = r.state;
        events.push(...r.events);
      }
    }
  }

  if (ignitionMode && input.ignition !== undefined) {
    const at = next.last ?? next.anchor;
    if (input.ignition && next.phase === 'parked' && at) {
      next = { ...next, phase: 'moving', trip: { startTs: input.ts, start: pos(at), distanceM: 0, maxSpeedKmh: input.speed ?? 0 }, anchor: { ...pos(at), ts: input.ts }, lastMoveTs: input.ts };
      events.push({ kind: 'start', ts: input.ts, at: pos(at) });
    } else if (!input.ignition && next.phase === 'moving' && at) {
      const r = end(next, input.ts, at);
      next = r.state;
      events.push(...r.events);
    }
    next.ignition = input.ignition;
  }
  return { state: next, events };
}

/** Ends a trip whose device went quiet: no movement (or, with ignition, no message) for `stopAfterS`. */
export function timeoutTrip(state: TripState, now: number, s: TripSettings): { state: TripState; events: TripEvent[] } {
  if (state.phase !== 'moving') return { state, events: [] };
  const since = s.ignitionKey ? state.last?.ts : state.lastMoveTs;
  if (since === null || since === undefined || now - since < s.stopAfterS * 1000) return { state, events: [] };
  const at = s.ignitionKey ? state.last! : state.anchor!;
  return end(state, since, at);
}
