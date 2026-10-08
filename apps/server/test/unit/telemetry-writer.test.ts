import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WriteRow } from '../../src/ingest/normalize';
import { type FailoverBuffer, type TelemetrySink, TelemetryWriter } from '../../src/ingest/telemetry-writer';

const row = (i: number): WriteRow => ({
  deviceId: 'd1',
  key: 't',
  ts: 1_700_000_000_000 + i,
  valueNum: i,
  valueStr: null,
  valueBool: null,
  valueJson: null,
});

class FakeSink implements TelemetrySink {
  batches: WriteRow[][] = [];
  fail = false;
  async write(rows: WriteRow[]) {
    if (this.fail) throw new Error('db down');
    this.batches.push(rows);
  }
}

class FakeBuffer implements FailoverBuffer {
  saved: WriteRow[][] = [];
  async save(rows: WriteRow[]) {
    this.saved.push(rows);
  }
}

describe('TelemetryWriter', () => {
  let sink: FakeSink;
  let buffer: FakeBuffer;
  let writer: TelemetryWriter;

  beforeEach(() => {
    vi.useFakeTimers();
    sink = new FakeSink();
    buffer = new FakeBuffer();
    writer = new TelemetryWriter(sink, buffer, { maxRows: 1000, flushMs: 250 });
  });

  afterEach(async () => {
    await writer.close();
    vi.useRealTimers();
  });

  it('flushes immediately at 1,000 rows', async () => {
    writer.enqueue(Array.from({ length: 1000 }, (_, i) => row(i)));
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]).toHaveLength(1000);
  });

  it('flushes a small batch after 250 ms', async () => {
    writer.enqueue(Array.from({ length: 10 }, (_, i) => row(i)));
    await vi.advanceTimersByTimeAsync(200);
    expect(sink.batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60);
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]).toHaveLength(10);
  });

  it('moves rows to the failover buffer when the database throws', async () => {
    sink.fail = true;
    writer.enqueue([row(1), row(2)]);
    await vi.advanceTimersByTimeAsync(300);
    expect(sink.batches).toHaveLength(0);
    expect(buffer.saved.flat()).toHaveLength(2);
  });

  it('flushes pending rows on close', async () => {
    writer.enqueue([row(1)]);
    await writer.close();
    expect(sink.batches.flat()).toHaveLength(1);
  });
});
