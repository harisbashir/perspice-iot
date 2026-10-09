import mqtt, { type MqttClient } from 'mqtt';
import { generateSync } from 'otplib';

export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:18025';
export const MQTT_URL = process.env.E2E_MQTT_URL ?? 'mqtt://localhost:11883';

export const totp = (secret: string) => generateSync({ secret });

interface MailpitMessage {
  ID: string;
  Subject: string;
}

/** Waits for an email to `to` whose subject contains `subject`; returns its plain-text body. */
export async function waitForEmail(to: string, subject: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: MailpitMessage[] };
    const hit = messages.find((m) => m.Subject.includes(subject));
    if (hit) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as { Text: string };
      return msg.Text;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No "${subject}" email to ${to} within ${timeoutMs} ms`);
}

export function linkIn(text: string, path: string): string {
  const match = new RegExp(`https?://\\S+${path.replace('?', '\\?')}=[A-Za-z0-9_-]+`).exec(text);
  if (!match) throw new Error(`No ${path} link in email:\n${text}`);
  return match[0];
}

/** A simulated device: publishes on demand and acks every command with `{ echo: params }`. */
export async function connectDevice(id: string, token: string): Promise<{ client: MqttClient; publish: (values: Record<string, unknown>) => Promise<void> }> {
  const client = await mqtt.connectAsync(MQTT_URL, { clientId: id, username: id, password: token, reconnectPeriod: 0 });
  await client.subscribeAsync(`perspice/v1/${id}/cmd`, { qos: 1 });
  client.on('message', (topic, payload) => {
    if (!topic.endsWith('/cmd')) return;
    const cmd = JSON.parse(payload.toString()) as { cid: string; params: unknown };
    void client.publishAsync(`perspice/v1/${id}/cmd/ack`, JSON.stringify({ cid: cmd.cid, status: 'success', result: { echo: cmd.params } }), { qos: 1 });
  });
  return {
    client,
    publish: async (values) => {
      await client.publishAsync(`perspice/v1/${id}/telemetry`, JSON.stringify({ values }), { qos: 1 });
    },
  };
}
