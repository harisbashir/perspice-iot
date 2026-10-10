import { Logger } from '@nestjs/common';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';

const RETRY_MS = 2000;

/**
 * An MQTT connection that keeps itself alive. mqtt.js reconnects after network errors but
 * stops after a refused CONNACK (e.g. the API was down when EMQX asked it to authenticate us),
 * so on any refusal this replaces the client with a fresh connection.
 */
export class ManagedMqtt {
  private readonly logger: Logger;
  private current?: MqttClient;
  private stopping = false;
  private retryTimer?: NodeJS.Timeout;

  constructor(
    private readonly url: string,
    private readonly options: IClientOptions,
    private readonly onConnect: (client: MqttClient) => void,
    private readonly onMessage?: (topic: string, payload: Buffer) => void,
  ) {
    this.logger = new Logger(`Mqtt:${options.clientId ?? 'client'}`);
  }

  get client(): MqttClient | undefined {
    return this.current;
  }

  get connected(): boolean {
    return this.current?.connected ?? false;
  }

  start(): void {
    const client = mqtt.connect(this.url, { reconnectPeriod: 1000, connectTimeout: 5000, ...this.options });
    this.current = client;
    client.on('connect', () => this.onConnect(client));
    if (this.onMessage) client.on('message', this.onMessage);
    client.on('error', (err) => {
      this.logger.warn(`MQTT error: ${err.message}`);
      if ('code' in err && typeof err.code === 'number') this.restart(client);
    });
  }

  /** Drops `client` (if still current) and connects again after a short delay. */
  restart(client: MqttClient): void {
    if (this.stopping || client !== this.current || this.retryTimer) return;
    client.end(true);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.stopping) this.start();
    }, RETRY_MS);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    await this.current?.endAsync(true);
  }
}
