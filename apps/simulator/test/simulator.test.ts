import { describe, expect, it } from 'vitest';
import { percentile } from '../src/run.js';
import { boundsFor, isCounter, randomWalk, valueGenerator } from '../src/values.js';

describe('random walk', () => {
  it('stays within the bounds and moves at most one step', () => {
    const bounds = { min: 10, max: 20, step: 3 };
    const next = randomWalk(bounds, 15);
    let prev = 15;
    for (let i = 0; i < 5000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
      expect(Math.abs(v - prev)).toBeLessThanOrEqual(3.01);
      prev = v;
    }
  });

  it('uses plausible bounds for known keys', () => {
    expect(boundsFor('mains_v').min).toBeGreaterThan(100);
    expect(boundsFor('fuel_level')).toMatchObject({ min: 0, max: 100 });
  });

  it('generates values for every profile key with the right type', () => {
    const gen = valueGenerator([
      { key: 'fuel_level', label: 'Fuel', type: 'number' },
      { key: 'door_open', label: 'Door', type: 'boolean' },
      { key: 'state', label: 'State', type: 'string' },
    ]);
    const v = gen();
    expect(typeof v.fuel_level).toBe('number');
    expect(typeof v.door_open).toBe('boolean');
    expect(v.state).toBe('ok');
  });
});

describe('cumulative counters', () => {
  it('recognises counter keys', () => {
    expect(['energy_kwh', 'import_wh', 'pulses_total', 'water_counter'].every(isCounter)).toBe(true);
    expect(['fuel_level', 'kwh_rate', 'temp'].some(isCounter)).toBe(false);
  });

  it('only ever rises, by small steps', () => {
    const gen = valueGenerator([{ key: 'energy_kwh', label: 'Energy', type: 'number' }]);
    let prev = gen().energy_kwh as number;
    for (let i = 0; i < 1000; i++) {
      const v = gen().energy_kwh as number;
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v - prev).toBeLessThanOrEqual(1);
      prev = v;
    }
  });
});

describe('percentile', () => {
  it('computes nearest-rank percentiles', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(data, 50)).toBe(50);
    expect(percentile(data, 95)).toBe(95);
    expect(percentile([], 95)).toBeNull();
  });
});
