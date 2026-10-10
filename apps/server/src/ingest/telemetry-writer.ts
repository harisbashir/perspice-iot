import type { WriteRow } from './normalize';

export interface TelemetrySink {
  write(rows: WriteRow[]): Promise<void>;
}

/** Where batches go when the database is unavailable; replayed later. */
export interface FailoverBuffer {
  save(rows: WriteRow[]): Promise<void>;
}

export interface WriterOptions {
  maxRows: number;
  flushMs: number;
}

/**
 * Batches telemetry rows and writes them every `flushMs` or when `maxRows` accumulate
 * (spec §4.1: 250 ms / 1,000 rows). Flushes run one at a time so `latest` stays ordered.
 */
export class TelemetryWriter {
  private pending: WriteRow[] = [];
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly sink: TelemetrySink,
    private readonly failover: FailoverBuffer,
    private readonly opts: WriterOptions,
    private readonly onError: (err: Error) => void = () => undefined,
  ) {}

  enqueue(rows: WriteRow[]): void {
    if (!rows.length) return;
    this.pending.push(...rows);
    if (this.pending.length >= this.opts.maxRows) this.flush();
    else if (!this.timer && !this.closed) this.timer = setTimeout(() => this.flush(), this.opts.flushMs);
  }

  /** Starts a flush of everything pending; resolves when it (and earlier flushes) finished. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.pending.length) {
      const batch = this.pending.splice(0, this.opts.maxRows);
      this.chain = this.chain.then(() => this.write(batch));
    }
    return this.chain;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  private async write(batch: WriteRow[]): Promise<void> {
    try {
      await this.sink.write(batch);
    } catch (err) {
      this.onError(err as Error);
      try {
        await this.failover.save(batch);
      } catch (bufferErr) {
        this.onError(bufferErr as Error);
      }
    }
  }
}
