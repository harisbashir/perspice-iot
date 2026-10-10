import { z } from 'zod';

export const TOPIC_ROOT = 'perspice/v1';

export const MAX_PAYLOAD_BYTES = 65536;
export const MAX_KEYS_PER_MESSAGE = 200;
export const MAX_BATCH_MESSAGES = 500;
export const KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/** Channels a device publishes to (platform subscribes). */
export type UpstreamChannel = 'telemetry' | 'attributes' | 'status' | 'cmd/ack' | 'ota/progress';
/** Channels the platform publishes to (device subscribes). */
export type DownstreamChannel = 'cmd' | 'config' | 'ota';

const UPSTREAM_CHANNELS: ReadonlySet<string> = new Set<UpstreamChannel>([
  'telemetry',
  'attributes',
  'status',
  'cmd/ack',
  'ota/progress',
]);

export function parseTopic(topic: string): { deviceId: string; channel: UpstreamChannel } | null {
  const prefix = `${TOPIC_ROOT}/`;
  if (!topic.startsWith(prefix)) return null;
  const rest = topic.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const deviceId = rest.slice(0, slash);
  const channel = rest.slice(slash + 1);
  if (!UPSTREAM_CHANNELS.has(channel)) return null;
  return { deviceId, channel: channel as UpstreamChannel };
}

export function deviceTopic(deviceId: string, channel: DownstreamChannel): string {
  return `${TOPIC_ROOT}/${deviceId}/${channel}`;
}

const TelemetryValue = z.union([z.number(), z.string(), z.boolean(), z.record(z.unknown()), z.array(z.unknown())]);

export const TelemetryMessage = z.object({
  ts: z.number().finite().nonnegative().optional(),
  values: z.record(TelemetryValue),
});
export type TelemetryMessage = z.infer<typeof TelemetryMessage>;

export const TelemetryPayload = z.union([TelemetryMessage, z.array(TelemetryMessage).min(1).max(MAX_BATCH_MESSAGES)]);
export type TelemetryPayload = z.infer<typeof TelemetryPayload>;

export const AttributesPayload = z.record(z.unknown());
export type AttributesPayload = z.infer<typeof AttributesPayload>;

export const CommandMessage = z.object({
  cid: z.string().min(1),
  name: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});
export type CommandMessage = z.infer<typeof CommandMessage>;

export const CommandAck = z.object({
  cid: z.string().min(1),
  status: z.enum(['success', 'failed']),
  result: z.unknown().optional(),
});
export type CommandAck = z.infer<typeof CommandAck>;

// OTA progress (`ota/progress`): see OtaProgressSchema in fleet.ts.
