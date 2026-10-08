import mqtt, { type MqttClient } from 'mqtt';
import type { TestApp } from './harness';
import { INGEST_PASSWORD } from './harness';

export interface ConnectResult {
  client: MqttClient;
}

/** Connects once (no auto-reconnect); rejects with the CONNACK error on refusal. */
export function connect(t: TestApp, opts: { clientId: string; username: string; password: string }): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(t.mqttUrl!, {
      clientId: opts.clientId,
      username: opts.username,
      password: opts.password,
      reconnectPeriod: 0,
      connectTimeout: 10_000,
      protocolVersion: 5,
    });
    client.once('connect', () => resolve(client));
    client.once('error', (err) => {
      client.end(true);
      reject(err);
    });
  });
}

export const connectDevice = (t: TestApp, deviceId: string, token: string) =>
  connect(t, { clientId: deviceId, username: deviceId, password: token });

export const connectIngest = (t: TestApp, clientId = `perspice-test-${Math.random().toString(36).slice(2)}`) =>
  connect(t, { clientId, username: 'perspice-ingest', password: INGEST_PASSWORD });

/** Resolves when the client is disconnected by the broker (or rejects after `timeoutMs`). */
export function waitForClose(client: MqttClient, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!client.connected) return resolve();
    const timer = setTimeout(() => reject(new Error(`still connected after ${timeoutMs} ms`)), timeoutMs);
    client.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Subscribes to `subscription` and returns a function that resolves, after `ms`, with the
 * messages whose topic equals `topic`.
 */
export async function listen(
  client: MqttClient,
  subscription: string,
  topic: string,
): Promise<(ms: number) => Promise<{ topic: string; payload: string }[]>> {
  const seen: { topic: string; payload: string }[] = [];
  const onMessage = (tp: string, payload: Buffer) => {
    if (tp === topic) seen.push({ topic: tp, payload: payload.toString() });
  };
  client.on('message', onMessage);
  await client.subscribeAsync(subscription, { qos: 1 });
  return async (ms: number) => {
    await new Promise((r) => setTimeout(r, ms));
    client.off('message', onMessage);
    return seen;
  };
}
