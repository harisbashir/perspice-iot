import { TOPIC_ROOT } from '@perspice/shared';

const DEVICE_PUBLISH = new Set(['telemetry', 'attributes', 'status', 'cmd/ack', 'ota/progress']);
const DEVICE_SUBSCRIBE = new Set(['cmd', 'config', 'ota']);
const INGEST_SUBSCRIBE = [
  `${TOPIC_ROOT}/#`,
  `${TOPIC_ROOT}/+/+`,
  `${TOPIC_ROOT}/+/+/+`,
  '$SYS/brokers/+/clients/+/connected',
  '$SYS/brokers/+/clients/+/disconnected',
  // AWS IoT Core lifecycle topics (only reached through EMQX when it stands in for IoT Core in tests).
  '$aws/events/presence/connected/+',
  '$aws/events/presence/disconnected/+',
];
const INGEST_PUBLISH = /^perspice\/v1\/[^/+#]+\/(cmd|config|ota)$/;

export interface EmqxAclRule {
  permission: 'allow' | 'deny';
  action: 'publish' | 'subscribe' | 'all';
  topic: string;
}

/**
 * A device's complete ACL, returned with a successful authentication so EMQX doesn't call the
 * ACL hook for each topic: its own channels exactly, and nothing else. (Per-topic HTTP checks
 * cost the API a request per device per cache period, and a check that times out during a
 * connection storm was cached as a denial.)
 */
export function deviceAclRules(deviceId: string): EmqxAclRule[] {
  const prefix = `${TOPIC_ROOT}/${deviceId}/`;
  return [
    ...[...DEVICE_PUBLISH].map((c) => ({ permission: 'allow' as const, action: 'publish' as const, topic: prefix + c })),
    ...[...DEVICE_SUBSCRIBE].map((c) => ({ permission: 'allow' as const, action: 'subscribe' as const, topic: prefix + c })),
    { permission: 'deny', action: 'all', topic: '#' },
  ];
}

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
