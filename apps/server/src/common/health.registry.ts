import { Injectable } from '@nestjs/common';

export type ReadinessCheck = () => Promise<void>;

/** Modules register dependency checks here; `/ready` runs them all. */
@Injectable()
export class HealthRegistry {
  private readonly checks = new Map<string, ReadinessCheck>();

  register(name: string, check: ReadinessCheck): void {
    this.checks.set(name, check);
  }

  async run(timeoutMs = 3000): Promise<{ ok: boolean; failing: string[] }> {
    const failing: string[] = [];
    await Promise.all(
      [...this.checks].map(async ([name, check]) => {
        try {
          await Promise.race([
            check(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs).unref()),
          ]);
        } catch {
          failing.push(name);
        }
      }),
    );
    return { ok: failing.length === 0, failing: failing.sort() };
  }
}
