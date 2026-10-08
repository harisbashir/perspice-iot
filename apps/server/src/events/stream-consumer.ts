import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { hostname } from 'node:os';
import { DEVICE_EVENTS_STREAM, type DomainEvent } from './events';

export interface StreamConsumerOptions {
  group: string;
  stream?: string;
  /** Handler errors are logged and the entry is acknowledged (no poison-message loops). */
  handle: (event: DomainEvent) => Promise<void>;
}

type StreamReply = [string, [string, string[]][]][] | null;

/** Reads a Redis Stream through a consumer group so each event is handled once per group. */
export class StreamConsumer {
  private readonly logger: Logger;
  private readonly stream: string;
  private readonly consumer = `${hostname()}-${process.pid}`;
  private conn?: Redis;
  private running = false;
  private loop?: Promise<void>;

  constructor(
    private readonly redis: Redis,
    private readonly opts: StreamConsumerOptions,
  ) {
    this.stream = opts.stream ?? DEVICE_EVENTS_STREAM;
    this.logger = new Logger(`StreamConsumer:${opts.group}`);
  }

  async start(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.stream, this.opts.group, '$', 'MKSTREAM');
    } catch (err) {
      if (!(err as Error).message.includes('BUSYGROUP')) throw err;
    }
    this.conn = this.redis.duplicate();
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.conn?.disconnect();
    await this.loop?.catch(() => undefined);
  }

  private async run(): Promise<void> {
    // Entries delivered to this consumer before a crash are retried first ('0'), then new ones ('>').
    let cursor = '0';
    while (this.running) {
      try {
        const reply = (await this.conn!.xreadgroup(
          'GROUP',
          this.opts.group,
          this.consumer,
          'COUNT',
          100,
          'BLOCK',
          2000,
          'STREAMS',
          this.stream,
          cursor,
        )) as StreamReply;
        const entries = reply?.[0]?.[1] ?? [];
        if (cursor === '0' && entries.length === 0) cursor = '>';
        for (const [id, fields] of entries) {
          await this.dispatch(fields);
          await this.redis.xack(this.stream, this.opts.group, id);
        }
      } catch (err) {
        if (!this.running) return;
        this.logger.warn(`Read failed: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async dispatch(fields: string[]): Promise<void> {
    const raw = fields[fields.indexOf('event') + 1];
    if (!raw) return;
    try {
      await this.opts.handle(JSON.parse(raw) as DomainEvent);
    } catch (err) {
      this.logger.error(`Handler failed: ${(err as Error).message}`);
    }
  }
}
