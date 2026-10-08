import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { LeaderLock } from './leader-lock';

/**
 * Runs periodic jobs so that each runs at most once per interval across all instances: every
 * tick, whichever instance claims the job's window (a lock that expires just before the next
 * tick) runs it.
 */
@Injectable()
export class JobRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger(JobRegistry.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();

  constructor(private readonly lock: LeaderLock) {}

  every(name: string, intervalMs: number, fn: () => Promise<void>): void {
    if (this.timers.has(name)) throw new Error(`Job ${name} already registered`);
    const window = Math.max(50, intervalMs - Math.min(250, Math.floor(intervalMs / 4)));
    const tick = async () => {
      if (this.running.has(name)) return;
      if (!(await this.lock.claim(`job:${name}`, window).catch(() => false))) return;
      this.running.add(name);
      try {
        await fn();
      } catch (err) {
        this.logger.error(`Job ${name} failed: ${(err as Error).message}`);
      } finally {
        this.running.delete(name);
      }
    };
    this.timers.set(name, setInterval(() => void tick(), intervalMs));
  }

  onApplicationShutdown(): void {
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }
}
