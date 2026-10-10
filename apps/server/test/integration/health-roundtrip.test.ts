import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli';
import { type TestApp, createTestApp, testEnv } from '../harness';

describe('cli health --mqtt-roundtrip', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('publishes through EMQX and sees the value ingested', async () => {
    const out: string[] = [];
    const code = await runCli(['health', '--mqtt-roundtrip'], {
      env: { ...testEnv(t.config.DATABASE_URL), REDIS_URL: t.config.REDIS_URL, MQTT_URL: t.mqttUrl },
      out: (l) => out.push(l),
      err: (l) => out.push(l),
    });
    expect(out.join('\n')).toContain('mqtt roundtrip: ok');
    expect(code).toBe(0);
  });
});
