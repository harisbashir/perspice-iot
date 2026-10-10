import { TripSettingsSchema, haversineM } from '@perspice/shared';
import { describe, expect, it } from 'vitest';
import { type TripEvent, type TripInput, type TripState, emptyTripState, stepTrip, timeoutTrip } from '../../src/location/trips';

const S = TripSettingsSchema.parse({ enabled: true }); // 5 km/h, 50 m, 300 s
const BASE = 1_700_000_000_000;
const HOME = { lat: 51.5, lng: -0.12 };
/** `m` metres north of HOME. */
const north = (m: number) => ({ lat: HOME.lat + m / 111_195, lng: HOME.lng });

function run(inputs: TripInput[], settings = S, state: TripState = emptyTripState()) {
  const events: TripEvent[] = [];
  for (const i of inputs) {
    const r = stepTrip(state, i, settings);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe('trip detection', () => {
  it('ignores GPS jitter while parked', () => {
    const jitter = Array.from({ length: 60 }, (_, i) => ({ ts: BASE + i * 10_000, fix: north((i % 5) * 8) }));
    const { state, events } = run(jitter);
    expect(events).toEqual([]);
    expect(state.phase).toBe('parked');
  });

  it('starts when the device leaves its parked spot and ends after five minutes without moving', () => {
    const parked = [0, 1, 2].map((i) => ({ ts: BASE + i * 10_000, fix: north(0) }));
    // Drive north 100 m every 10 s for 2 minutes (36 km/h)…
    const drive = Array.from({ length: 12 }, (_, i) => ({ ts: BASE + 30_000 + i * 10_000, fix: north((i + 1) * 100) }));
    // …then stand still for 6 minutes.
    const stop = Array.from({ length: 36 }, (_, i) => ({ ts: BASE + 150_000 + i * 10_000, fix: north(1200 + (i % 2) * 5) }));
    const { state, events } = run([...parked, ...drive, ...stop]);
    expect(events.map((e) => e.kind)).toEqual(['start', 'end']);
    expect(events[0]).toMatchObject({ kind: 'start', ts: BASE + 20_000, at: north(0) });
    // Ends at the last movement, where it stopped.
    expect(events[1]).toMatchObject({ kind: 'end', ts: BASE + 140_000 });
    expect(haversineM((events[1] as Extract<TripEvent, { kind: 'end' }>).at, north(1200))).toBeLessThan(1);
    expect(state.phase).toBe('parked');
  });

  it('a reported speed starts a trip even before the device has moved far', () => {
    const { events } = run([
      { ts: BASE, fix: north(0), speed: 0 },
      { ts: BASE + 10_000, fix: north(10), speed: 12 },
    ]);
    expect(events).toEqual([expect.objectContaining({ kind: 'start', ts: BASE })]);
  });

  it('keeps a running distance and leaves out jumps faster than 300 km/h', () => {
    const { state } = run([
      { ts: BASE, fix: north(0) },
      { ts: BASE + 10_000, fix: north(100) },
      { ts: BASE + 20_000, fix: north(200) },
      { ts: BASE + 21_000, fix: north(50_200) }, // 50 km in a second: a bad fix
      { ts: BASE + 30_000, fix: north(300) },
    ]);
    expect(state.trip?.distanceM).toBeCloseTo(200, -1);
  });

  it('ignores fixes older than the last one', () => {
    const r1 = run([
      { ts: BASE, fix: north(0) },
      { ts: BASE + 10_000, fix: north(100) },
    ]);
    const r2 = run([{ ts: BASE + 5_000, fix: north(5000) }], S, r1.state);
    expect(r2.state).toEqual(r1.state);
    expect(r2.events).toEqual([]);
  });

  it('with an ignition key, ignition alone starts and ends trips', () => {
    const settings = TripSettingsSchema.parse({ enabled: true, ignitionKey: 'ignition' });
    const { events } = run(
      [
        { ts: BASE, fix: north(0), ignition: false },
        { ts: BASE + 10_000, fix: north(500) }, // moved without ignition: towed, not a trip
        { ts: BASE + 20_000, fix: north(500), ignition: true },
        { ts: BASE + 600_000, fix: north(500) }, // idling 10 minutes: still the same trip
        { ts: BASE + 610_000, fix: north(900), ignition: false },
      ],
      settings,
    );
    expect(events).toEqual([
      expect.objectContaining({ kind: 'start', ts: BASE + 20_000 }),
      expect.objectContaining({ kind: 'end', ts: BASE + 610_000 }),
    ]);
  });

  it('closes a trip when the device goes silent', () => {
    const { state } = run([
      { ts: BASE, fix: north(0) },
      { ts: BASE + 10_000, fix: north(200) },
    ]);
    expect(timeoutTrip(state, BASE + 200_000, S).events).toEqual([]);
    const closed = timeoutTrip(state, BASE + 400_000, S);
    expect(closed.events).toEqual([expect.objectContaining({ kind: 'end', ts: BASE + 10_000 })]);
    expect(closed.state.phase).toBe('parked');
  });

  it('a jump while parked moves the parked spot instead of starting a trip', () => {
    const { events, state } = run([
      { ts: BASE, fix: north(0) },
      { ts: BASE + 1000, fix: north(80_000) }, // 80 km in a second
      { ts: BASE + 11_000, fix: north(80_010) },
    ]);
    expect(events).toEqual([]);
    expect(haversineM(state.anchor!, north(80_000))).toBeLessThan(1);
  });
});
