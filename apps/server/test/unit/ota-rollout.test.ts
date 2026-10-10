import { describe, expect, it } from 'vitest';
import { type RolloutDevice, planRollout } from '../../src/firmware/ota.rollout';

const job = { batchSize: 2, maxFailurePct: 20, timeoutMin: 30 };
const NOW = 1_800_000_000_000;
const dev = (id: string, state: RolloutDevice['state'], extra: Partial<RolloutDevice> = {}): RolloutDevice => ({ deviceId: id, state, sentAt: null, online: true, ...extra });

describe('OTA rollout planner', () => {
  it('sends to at most a batch of online devices at a time', () => {
    const step = planRollout(job, [dev('a', 'pending'), dev('b', 'pending'), dev('c', 'pending')], NOW);
    expect(step).toEqual({ send: ['a', 'b'], timedOut: [], halt: null, complete: false });
    const next = planRollout(job, [dev('a', 'downloading', { sentAt: NOW }), dev('b', 'applied'), dev('c', 'pending')], NOW);
    expect(next.send).toEqual(['c']);
  });

  it('waits for offline devices instead of sending to them', () => {
    const step = planRollout(job, [dev('a', 'pending', { online: false }), dev('b', 'applied')], NOW);
    expect(step).toEqual({ send: [], timedOut: [], halt: null, complete: false });
  });

  it('fails devices that have not finished in time', () => {
    const step = planRollout(job, [dev('a', 'sent', { sentAt: NOW - 31 * 60_000 }), dev('b', 'verifying', { sentAt: NOW - 29 * 60_000 })], NOW);
    expect(step.timedOut).toEqual(['a']);
    expect(step.send).toEqual([]); // b still in flight, a counts as failed: one of a batch done
  });

  it('halts once a batch worth has finished and too many failed', () => {
    const step = planRollout(job, [dev('a', 'failed'), dev('b', 'failed'), dev('c', 'pending'), dev('d', 'pending')], NOW);
    expect(step.halt).toBe('2 of 2 devices failed (more than 20%)');
    expect(step.send).toEqual([]);
  });

  it('keeps going while failures stay under the threshold', () => {
    const devices = [...Array.from({ length: 9 }, (_, i) => dev(`ok${i}`, 'applied')), dev('bad', 'failed'), dev('next', 'pending')];
    const step = planRollout({ ...job, batchSize: 5 }, devices, NOW);
    expect(step.halt).toBeNull();
    expect(step.send).toEqual(['next']);
  });

  it('completes when nothing is pending or in flight', () => {
    expect(planRollout(job, [dev('a', 'applied'), dev('b', 'skipped'), dev('c', 'failed')], NOW).complete).toBe(true);
    expect(planRollout(job, [dev('a', 'applied'), dev('b', 'sent', { sentAt: NOW })], NOW).complete).toBe(false);
  });
});
