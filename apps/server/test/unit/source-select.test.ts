import { describe, expect, it } from 'vitest';
import { selectSource } from '../../src/telemetry/source-select';

const H = 3_600_000;
const D = 24 * H;

describe('selectSource', () => {
  it('uses raw data for ranges up to 6 h', () => {
    expect(selectSource(0, H)).toBe('raw');
    expect(selectSource(0, 6 * H)).toBe('raw');
  });

  it('uses 1-minute buckets for a day (1,440 points)', () => {
    expect(selectSource(0, D)).toBe('1m');
  });

  it('uses 1-hour buckets for a week (10,080 minutes exceed 2,000)', () => {
    expect(selectSource(0, 7 * D)).toBe('1h');
  });

  it('uses daily buckets for two years', () => {
    expect(selectSource(0, 730 * D)).toBe('1d');
  });

  it('respects a custom point budget', () => {
    expect(selectSource(0, D, 1000)).toBe('1h');
  });
});
