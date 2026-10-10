import type { OtaDeviceState } from '@perspice/shared';

export interface RolloutDevice {
  deviceId: string;
  state: OtaDeviceState;
  /** When the OTA message was (last) sent. */
  sentAt: number | null;
  online: boolean;
}

export interface RolloutStep {
  /** In-flight devices past the job's timeout: they fail. */
  timedOut: string[];
  /** Pending devices to send the update to now. */
  send: string[];
  /** Why the rollout must stop, if it must. */
  halt: string | null;
  /** Nothing pending or in flight. */
  complete: boolean;
}

const IN_FLIGHT: readonly OtaDeviceState[] = ['sent', 'downloading', 'verifying'];

/**
 * One rollout step (pure; the service applies it). At most `batchSize` devices are updating at a
 * time, online ones only (offline devices wait). Once at least a batch worth of devices has
 * finished, more than `maxFailurePct` failures halts the rollout.
 */
export function planRollout(job: { batchSize: number; maxFailurePct: number; timeoutMin: number }, devices: RolloutDevice[], now: number): RolloutStep {
  const timedOut = devices.filter((d) => IN_FLIGHT.includes(d.state) && d.sentAt !== null && now - d.sentAt >= job.timeoutMin * 60_000).map((d) => d.deviceId);
  const failedNow = new Set(timedOut);
  const state = (d: RolloutDevice): OtaDeviceState => (failedNow.has(d.deviceId) ? 'failed' : d.state);
  const inFlight = devices.filter((d) => IN_FLIGHT.includes(state(d))).length;
  const applied = devices.filter((d) => state(d) === 'applied').length;
  const failed = devices.filter((d) => state(d) === 'failed').length;
  const pending = devices.filter((d) => state(d) === 'pending');
  const eligible = devices.filter((d) => state(d) !== 'skipped').length;

  const finished = applied + failed;
  // Everything finished: the job is complete, whatever the failure rate.
  if (pending.length === 0 && inFlight === 0) return { timedOut, send: [], halt: null, complete: true };
  let halt: string | null = null;
  if (failed > 0 && finished >= Math.min(job.batchSize, eligible) && failed * 100 > job.maxFailurePct * finished) {
    halt = `${failed} of ${finished} devices failed (more than ${job.maxFailurePct}%)`;
  }
  const send = halt ? [] : pending.filter((d) => d.online).slice(0, Math.max(0, job.batchSize - inFlight)).map((d) => d.deviceId);
  return { timedOut, send, halt, complete: false };
}
