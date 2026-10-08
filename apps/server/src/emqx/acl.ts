import { TOPIC_ROOT } from '@perspice/shared';

const DEVICE_PUBLISH = new Set(['telemetry', 'attributes', 'status', 'cmd/ack', 'ota/progress']);
const DEVICE_SUBSCRIBE = new Set(['cmd', 'config', 'ota']);
const INGEST_SUBSCRIBE = [
  `${TOPIC_ROOT}/#`,
  `${TOPIC_ROOT}/+/+`,
  `${TOPIC_ROOT}/+/+/+`,
  '$SYS/brokers/+/clients/+/connected',
  '$SYS/brokers/+/clients/+/disconnected',
];
const INGEST_PUBLISH = /^perspice\/v1\/[^/+#]+\/(cmd|config|ota)$/;

/** EMQX may pass shared subscriptions with or without the `$share/<group>/` prefix. */
const stripShare = (topic: string) => topic.replace(/^\$share\/[^/]+\//, '');

/** A device may only use its own subtree, exactly (no wildcards). */
export function deviceMayAccess(deviceId: string, topic: string, action: 'publish' | 'subscribe'): boolean {
  const prefix = `${TOPIC_ROOT}/${deviceId}/`;
  if (!topic.startsWith(prefix)) return false;
  const channel = topic.slice(prefix.length);
  return action === 'publish' ? DEVICE_PUBLISH.has(channel) : DEVICE_SUBSCRIBE.has(channel);
}

export function ingestMayAccess(topic: string, action: 'publish' | 'subscribe'): boolean {
  if (action === 'publish') return INGEST_PUBLISH.test(topic);
  if (topic.startsWith('$share/') && !topic.startsWith('$share/ingest/')) return false;
  return INGEST_SUBSCRIBE.includes(stripShare(topic));
}
