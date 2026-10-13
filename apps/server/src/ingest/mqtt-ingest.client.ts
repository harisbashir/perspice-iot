import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { IClientOptions, MqttClient } from 'mqtt';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { CONFIG, type Config } from '../config/config';
import { ManagedMqtt } from './managed-mqtt';
import { EmqxClient } from '../emqx/emqx.client';
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

  private readonly clientId: string;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    router: MessageRouter,
    private readonly emqx: EmqxClient,
  ) {
    const aws = config.MQTT_TRANSPORT === 'aws-iot';
    this.subscriptions = aws ? AWS_INGEST_SUBSCRIPTIONS : INGEST_SUBSCRIPTIONS;
    // Stable across container restarts (INGEST_ID), so a new container resumes the same session.
    this.clientId = `perspice-ingest-${config.INGEST_ID ?? `${hostname()}-${process.pid}`}`;
    const common: IClientOptions = {
      clientId: this.clientId,
      protocolVersion: 5,
      clean: false,
      properties: { sessionExpiryInterval: 3600 },
    };
    this.mqtt = new ManagedMqtt(
      aws ? (config.AWS_IOT_MQTT_URL ?? `mqtts://${config.AWS_IOT_ENDPOINT}:8883`) : config.MQTT_URL,
      aws ? { ...common, ...awsTls(config) } : { ...common, username: config.MQTT_INGEST_USERNAME, password: config.MQTT_INGEST_PASSWORD },
      (client) => this.subscribe(client),
      (topic, payload) => this.inOrder(topic, () => router.handle(topic, payload)),
    );
  }

  /** Per device, the message being handled and those queued behind it. */
  private readonly chains = new Map<string, Promise<void>>();

  /**
   * Handles one device's messages strictly in arrival order (different devices in parallel), so
   * a burst of buffered positions reaches trips and alarms in the order the device sent it.
   */
  private inOrder(topic: string, handle: () => Promise<void>): void {
    const deviceId = /^perspice\/v1\/([^/]+)\//.exec(topic)?.[1];
    if (!deviceId) {
      void handle();
      return;
    }
    const next = (this.chains.get(deviceId) ?? Promise.resolve()).then(handle, handle);
    this.chains.set(deviceId, next);
    void next.finally(() => {
      if (this.chains.get(deviceId) === next) this.chains.delete(deviceId);
    });
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
   * Removes other ingest sessions that are no longer connected. Ingest shares its subscriptions,
   * so a persistent session left by a previous container (older releases named it after the
   * container) would be sent its share of the messages, which nobody reads.
   */
  async removeStaleSessions(): Promise<void> {
    if (this.config.MQTT_TRANSPORT === 'aws-iot') return;
    for (let page = 1; page <= 50; page++) {
      const { data } = await this.emqx.listClients(page, 100);
      for (const c of data) {
        if (c.clientid !== this.clientId && c.clientid.startsWith('perspice-ingest-') && c.username === this.config.MQTT_INGEST_USERNAME && !c.connected) {
          await this.emqx.kick(c.clientid);
          this.logger.log(`Removed the stale ingest session ${c.clientid}`);
        }
      }
      if (data.length < 100) break;
    }
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
      void this.removeStaleSessions().catch((e: Error) => this.logger.warn(`Could not check for stale ingest sessions: ${e.message}`));
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
