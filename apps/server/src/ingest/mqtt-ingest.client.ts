import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { MqttClient } from 'mqtt';
import { hostname } from 'node:os';
import { CONFIG, type Config } from '../config/config';
import { ManagedMqtt } from './managed-mqtt';
import { MessageRouter } from './message-router';

export const INGEST_SUBSCRIPTIONS = [
  '$share/ingest/perspice/v1/+/+',
  '$share/ingest/perspice/v1/+/+/+',
  '$share/ingest/$SYS/brokers/+/clients/+/connected',
  '$share/ingest/$SYS/brokers/+/clients/+/disconnected',
];

/** Subscribes to all device traffic through the `ingest` shared-subscription group. */
@Injectable()
export class MqttIngestClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MqttIngestClient.name);
  private readonly mqtt: ManagedMqtt;
  private readyResolve!: () => void;
  private readonly readyPromise = new Promise<void>((resolve) => (this.readyResolve = resolve));

  constructor(@Inject(CONFIG) config: Config, router: MessageRouter) {
    this.mqtt = new ManagedMqtt(
      config.MQTT_URL,
      {
        clientId: `perspice-ingest-${hostname()}-${process.pid}`,
        username: config.MQTT_INGEST_USERNAME,
        password: config.MQTT_INGEST_PASSWORD,
        protocolVersion: 5,
        clean: false,
        properties: { sessionExpiryInterval: 3600 },
      },
      (client) => this.subscribe(client),
      (topic, payload) => void router.handle(topic, payload),
    );
  }

  onModuleInit(): void {
    this.mqtt.start();
  }

  /** Resolves once connected and subscribed (used by tests and health checks). */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  get connected(): boolean {
    return this.mqtt.connected;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.mqtt.stop();
  }

  /**
   * Right after EMQX boots, or while the API restarts, its ACL hook can fail and the broker
   * refuses the subscription. EMQX caches that denial for the connection, so reconnect.
   */
  private subscribe(client: MqttClient): void {
    client.subscribe(INGEST_SUBSCRIPTIONS, { qos: 1 }, (err, granted) => {
      if (err || (granted ?? []).some((g) => g.qos >= 128)) {
        this.logger.warn(`Subscription refused (${err?.message ?? 'not authorized'}); reconnecting`);
        this.mqtt.restart(client);
        return;
      }
      this.logger.log('Ingest subscribed');
      this.readyResolve();
    });
  }
}
