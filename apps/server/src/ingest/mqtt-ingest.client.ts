import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import mqtt, { type MqttClient } from 'mqtt';
import { hostname } from 'node:os';
import { CONFIG, type Config } from '../config/config';
import { MessageRouter } from './message-router';

export const INGEST_SUBSCRIPTIONS = [
  '$share/ingest/perspice/v1/+/+',
  '$share/ingest/perspice/v1/+/+/+',
  '$share/ingest/$SYS/brokers/+/clients/+/connected',
  '$share/ingest/$SYS/brokers/+/clients/+/disconnected',
];

const RETRY_MS = 2000;

/** Subscribes to all device traffic through the `ingest` shared-subscription group. */
@Injectable()
export class MqttIngestClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MqttIngestClient.name);
  private client?: MqttClient;
  private stopping = false;
  private retryTimer?: NodeJS.Timeout;
  private readyResolve!: () => void;
  private readonly readyPromise = new Promise<void>((resolve) => (this.readyResolve = resolve));

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly router: MessageRouter,
  ) {}

  onModuleInit(): void {
    this.connect();
  }

  /** Resolves once connected and subscribed (used by tests and health checks). */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    await this.client?.endAsync(true);
  }

  private connect(): void {
    const client = mqtt.connect(this.config.MQTT_URL, {
      clientId: `perspice-ingest-${hostname()}-${process.pid}`,
      username: this.config.MQTT_INGEST_USERNAME,
      password: this.config.MQTT_INGEST_PASSWORD,
      protocolVersion: 5,
      clean: false,
      properties: { sessionExpiryInterval: 3600 },
      reconnectPeriod: 1000,
      connectTimeout: 5_000,
    });
    this.client = client;
    client.on('connect', () => this.subscribe(client));
    client.on('message', (topic, payload) => {
      void this.router.handle(topic, payload);
    });
    client.on('error', (err) => {
      this.logger.warn(`MQTT error: ${err.message}`);
      // A refused CONNACK (e.g. the API was down when the broker asked it to authenticate us)
      // makes mqtt.js stop retrying, so start over with a fresh connection.
      if ('code' in err && typeof err.code === 'number') this.restart(client);
    });
  }

  /**
   * Right after EMQX boots, or while the API restarts, its ACL hook can fail and the broker
   * refuses the subscription. EMQX caches that denial for the connection, so reconnect.
   */
  private subscribe(client: MqttClient): void {
    client.subscribe(INGEST_SUBSCRIPTIONS, { qos: 1 }, (err, granted) => {
      if (err || (granted ?? []).some((g) => g.qos >= 128)) {
        this.logger.warn(`Subscription refused (${err?.message ?? 'not authorized'}); reconnecting`);
        this.restart(client);
        return;
      }
      this.logger.log('Ingest subscribed');
      this.readyResolve();
    });
  }

  private restart(client: MqttClient): void {
    if (this.stopping || client !== this.client || this.retryTimer) return;
    client.end(true);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.stopping) this.connect();
    }, RETRY_MS);
  }
}
