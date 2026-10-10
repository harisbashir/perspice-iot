import { describe, expect, it } from 'vitest';
import { TelemetryPayload, deviceTopic, parseTopic } from '../src/index.js';

describe('parseTopic', () => {
  it('parses a telemetry topic', () => {
    expect(parseTopic('perspice/v1/abc/telemetry')).toEqual({ deviceId: 'abc', channel: 'telemetry' });
  });

  it('parses a two-segment channel', () => {
    expect(parseTopic('perspice/v1/abc/cmd/ack')?.channel).toBe('cmd/ack');
    expect(parseTopic('perspice/v1/abc/ota/progress')?.channel).toBe('ota/progress');
  });

  it('rejects a different version', () => {
    expect(parseTopic('perspice/v2/abc/telemetry')).toBeNull();
  });

  it('rejects extra segments', () => {
    expect(parseTopic('perspice/v1/a/b/telemetry')).toBeNull();
  });

  it('rejects downstream channels', () => {
    expect(parseTopic('perspice/v1/abc/cmd')).toBeNull();
  });
});

describe('deviceTopic', () => {
  it('builds downstream topics', () => {
    expect(deviceTopic('abc', 'cmd')).toBe('perspice/v1/abc/cmd');
    expect(deviceTopic('abc', 'config')).toBe('perspice/v1/abc/config');
  });
});

describe('TelemetryPayload', () => {
  it('accepts a single message', () => {
    expect(TelemetryPayload.safeParse({ values: { t: 1 } }).success).toBe(true);
  });

  it('accepts an array of messages', () => {
    expect(TelemetryPayload.safeParse([{ ts: 1, values: { t: 1 } }]).success).toBe(true);
  });

  it('rejects an array of 501 messages', () => {
    const batch = Array.from({ length: 501 }, () => ({ values: { t: 1 } }));
    expect(TelemetryPayload.safeParse(batch).success).toBe(false);
  });
});
