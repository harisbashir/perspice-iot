import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { IClientOptions, MqttClient } from 'mqtt';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { CONFIG, type Config } from '../config/config';
import { ManagedMqtt } from './managed-mqtt';
import { MessageRouter } from './message-router';

/** On AWS IoT Core: the same device topics, and lifecycle events for presence. */
export const AWS_INGEST_SUBSCRIPTIONS = [
  '$share/ingest/perspice/v1/+/+',
  '$share/ingest/perspice/v1/+/+/+',
  '$share/ingest/$aws/events/presence/connected/+',
  '$share/ingest/$aws/events/presence/disconnected/+',
];

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
  private readonly subscriptions: string[];
  private readyResolve!: () => void;
  private readonly readyPromise = new Promise<void>((resolve) => (this.readyResolve = resolve));

  constructor(@Inject(CONFIG) config: Config, router: MessageRouter) {
    const aws = config.MQTT_TRANSPORT === 'aws-iot';
    this.subscriptions = aws ? AWS_INGEST_SUBSCRIPTIONS : INGEST_SUBSCRIPTIONS;
    const common: IClientOptions = {
      clientId: `perspice-ingest-${hostname()}-${process.pid}`,
      protocolVersion: 5,
      clean: false,
      properties: { sessionExpiryInterval: 3600 },
    };
    this.mqtt = new ManagedMqtt(
      aws ? (config.AWS_IOT_MQTT_URL ?? `mqtts://${config.AWS_IOT_ENDPOINT}:8883`) : config.MQTT_URL,
      aws ? { ...common, ...awsTls(config) } : { ...common, username: config.MQTT_INGEST_USERNAME, password: config.MQTT_INGEST_PASSWORD },
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
    client.subscribe(this.subscriptions, { qos: 1 }, (err, granted) => {
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

/** Mutual TLS with the ingest certificate (`cli aws-iot-setup` writes it). */
function awsTls(config: Config): IClientOptions {
  const read = (p: string | undefined) => {
    try {
      return p ? readFileSync(p) : undefined;
    } catch {
      return undefined; // a URL override without TLS (tests) needs no files
    }
  };
  return { key: read(config.AWS_IOT_KEY_PATH), cert: read(config.AWS_IOT_CERT_PATH), ca: read(config.AWS_IOT_CA_PATH) };
}
