import { haversineM } from '@perspice/shared';
import { describe, expect, it } from 'vitest';
import { mobileRoute } from '../src/mobility.js';

/** A seeded generator, so routes are repeatable. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const CENTER = { lat: 51.5, lng: -0.12 };

describe('mobile devices', () => {
  const ticks = (n: number, seed = 1) => {
    const next = mobileRoute({ center: CENTER, radiusKm: 5 }, 10, seeded(seed));
    return Array.from({ length: n }, next);
  };

  it('stay within their area', () => {
    for (const seed of [1, 2, 3]) {
      for (const p of ticks(2000, seed)) expect(haversineM(CENTER, p)).toBeLessThan(5000 * 1.05);
    }
  });

  it('drive at plausible speeds and actually cover distance', () => {
    const fixes = ticks(1000);
    const driving = fixes.filter((p) => p.speed > 0);
    expect(driving.length).toBeGreaterThan(100);
    for (const p of driving) {
      expect(p.speed).toBeGreaterThanOrEqual(25);
      expect(p.speed).toBeLessThanOrEqual(70);
    }
    const moved = fixes.slice(1).reduce((m, p, i) => m + haversineM(fixes[i]!, p), 0);
    expect(moved).toBeGreaterThan(10_000);
  });

  it('park long enough for trips to end (over 5 minutes), with only GPS jitter', () => {
    const fixes = ticks(2000);
    let run = 0;
    let longest = 0;
    let parkedFrom: (typeof fixes)[number] | null = null;
    for (const p of fixes) {
      if (p.speed === 0) {
        parkedFrom ??= p;
        run++;
        longest = Math.max(longest, run);
        expect(haversineM(parkedFrom, p)).toBeLessThan(15);
      } else {
        run = 0;
        parkedFrom = null;
      }
    }
    expect(longest * 10).toBeGreaterThan(300);
  });

  it('report a heading within 0–360', () => {
    for (const p of ticks(500)) {
      expect(p.heading).toBeGreaterThanOrEqual(0);
      expect(p.heading).toBeLessThan(360);
    }
  });
});
