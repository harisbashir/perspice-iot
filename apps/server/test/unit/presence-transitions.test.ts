import { describe, expect, it } from 'vitest';
import { nextStatus } from '../../src/presence/presence.service';

const t = { offlineS: 300, deadS: 86400 };
const NOW = 1_800_000_000_000;

describe('nextStatus', () => {
  it('never stays never without activity', () => {
    expect(nextStatus('never', null, NOW, t)).toBe('never');
  });

  it('stays online inside the offline timeout', () => {
    expect(nextStatus('online', NOW - 299_999, NOW, t)).toBe('online');
  });

  it('goes offline exactly at the offline timeout', () => {
    expect(nextStatus('online', NOW - 300_000, NOW, t)).toBe('offline');
  });

  it('goes dead exactly at the dead timeout, from online or offline', () => {
    expect(nextStatus('offline', NOW - 86_399_999, NOW, t)).toBe('offline');
    expect(nextStatus('offline', NOW - 86_400_000, NOW, t)).toBe('dead');
    expect(nextStatus('online', NOW - 86_400_000, NOW, t)).toBe('dead');
  });

  it('never brings a device online (only activity does)', () => {
    expect(nextStatus('offline', NOW - 1000, NOW, t)).toBe('offline');
    expect(nextStatus('dead', NOW - 1000, NOW, t)).toBe('dead');
  });
});
