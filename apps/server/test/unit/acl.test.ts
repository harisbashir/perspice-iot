import { describe, expect, it } from 'vitest';
import { deviceMayAccess, ingestMayAccess } from '../../src/emqx/acl';

describe('device ACL', () => {
  it('allows publishing to its own upstream channels only', () => {
    for (const ch of ['telemetry', 'attributes', 'status', 'cmd/ack', 'ota/progress']) {
      expect(deviceMayAccess('d1', `perspice/v1/d1/${ch}`, 'publish')).toBe(true);
    }
    expect(deviceMayAccess('d1', 'perspice/v1/d1/cmd', 'publish')).toBe(false);
    expect(deviceMayAccess('d1', 'perspice/v1/d2/telemetry', 'publish')).toBe(false);
    expect(deviceMayAccess('d1', 'perspice/v1/d1/telemetry/x', 'publish')).toBe(false);
  });

  it('allows subscribing to its own downstream channels only, without wildcards', () => {
    for (const ch of ['cmd', 'config', 'ota']) expect(deviceMayAccess('d1', `perspice/v1/d1/${ch}`, 'subscribe')).toBe(true);
    expect(deviceMayAccess('d1', 'perspice/v1/d1/#', 'subscribe')).toBe(false);
    expect(deviceMayAccess('d1', 'perspice/v1/+/cmd', 'subscribe')).toBe(false);
    expect(deviceMayAccess('d1', 'perspice/v1/d1/telemetry', 'subscribe')).toBe(false);
  });
});

describe('ingest ACL', () => {
  it('may subscribe to device topics and client events via the ingest share group', () => {
    expect(ingestMayAccess('$share/ingest/perspice/v1/+/+', 'subscribe')).toBe(true);
    expect(ingestMayAccess('perspice/v1/+/+/+', 'subscribe')).toBe(true);
    expect(ingestMayAccess('$share/ingest/$SYS/brokers/+/clients/+/connected', 'subscribe')).toBe(true);
    expect(ingestMayAccess('$share/other/perspice/v1/+/+', 'subscribe')).toBe(false);
    expect(ingestMayAccess('#', 'subscribe')).toBe(false);
  });

  it('may publish only downstream device channels', () => {
    expect(ingestMayAccess('perspice/v1/d1/cmd', 'publish')).toBe(true);
    expect(ingestMayAccess('perspice/v1/d1/config', 'publish')).toBe(true);
    expect(ingestMayAccess('perspice/v1/d1/telemetry', 'publish')).toBe(false);
    expect(ingestMayAccess('perspice/v1/+/cmd', 'publish')).toBe(false);
  });
});
