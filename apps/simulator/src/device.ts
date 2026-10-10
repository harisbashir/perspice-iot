import type { TelemetryKeyDef } from '@perspice/shared';
import mqtt, { type MqttClient } from 'mqtt';
import type { MobileFix } from './mobility.js';
import { valueGenerator } from './values.js';

export interface SimDeviceOptions {
  id: string;
  token: string;
  mqttUrl: string;
  apiUrl: string;
  keys: TelemetryKeyDef[];
  http: boolean;
  sleepy: boolean;
  onSent: () => void;
  onError: (err: Error) => void;
  /** Mobile devices: the next position, sent with every message. */
  mobile?: () => MobileFix;
}

/** One simulated device: publishes values, acks every command with `{ echo: params }`. */
export class SimDevice {
  private client?: MqttClient;
  private readonly next: () => Record<string, unknown>;

  constructor(private readonly o: SimDeviceOptions) {
    this.next = valueGenerator(o.keys);
  }

  async start(): Promise<void> {
    if (this.o.http || this.o.sleepy) return;
    this.client = await this.connect();
  }

  async tick(): Promise<void> {
    const payload = JSON.stringify({ ts: Date.now(), values: { ...this.next(), ...(this.o.mobile ? this.o.mobile() : {}) } });
    try {
      if (this.o.http) await this.postHttp(payload);
      else if (this.o.sleepy) {
        const c = await this.connect();
        await c.publishAsync(this.topic('telemetry'), payload, { qos: 1 });
        await c.endAsync();
      } else {
        await this.client!.publishAsync(this.topic('telemetry'), payload, { qos: 1 });
      }
      this.o.onSent();
    } catch (err) {
      this.o.onError(err as Error);
    }
  }

  async stop(): Promise<void> {
    await this.client?.endAsync(true);
  }

  private topic(channel: string): string {
    return `perspice/v1/${this.o.id}/${channel}`;
  }

  private connect(): Promise<MqttClient> {
    return new Promise((resolve, reject) => {
      const c = mqtt.connect(this.o.mqttUrl, {
        clientId: this.o.id,
        username: this.o.id,
        password: this.o.token,
        // MQTT 5 reports a refused publish in the PUBACK, so it counts as an error, not as sent.
        protocolVersion: 5,
        reconnectPeriod: this.o.sleepy ? 0 : 2000,
        connectTimeout: 10_000,
      });
      c.once('connect', () => {
        c.subscribe(this.topic('cmd'), { qos: 1 });
        resolve(c);
      });
      c.once('error', reject);
      c.on('message', (topic, buf) => {
        if (!topic.endsWith('/cmd')) return;
        try {
          const cmd = JSON.parse(buf.toString()) as { cid: string; params?: unknown };
          void c.publishAsync(this.topic('cmd/ack'), JSON.stringify({ cid: cmd.cid, status: 'success', result: { echo: cmd.params ?? {} } }), { qos: 1 });
        } catch {
          /* ignore malformed commands */
        }
      });
    });
  }

  private async postHttp(payload: string): Promise<void> {
    const res = await fetch(`${this.o.apiUrl.replace(/\/$/, '')}/api/v1/device/telemetry`, {
      method: 'POST',
      headers: { 'x-device-token': this.o.token, 'content-type': 'application/json' },
      body: payload,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
}
