import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type CommandMessage, deviceTopic } from '@perspice/shared';
import { hostname } from 'node:os';
import { CONFIG, type Config } from '../config/config';
import { ManagedMqtt } from '../ingest/managed-mqtt';

/** Publishes commands and config to devices, using the ingest credentials (ACL allows downstream topics). */
@Injectable()
export class CommandsPublisher implements OnModuleInit, OnApplicationShutdown {
  private readonly mqtt: ManagedMqtt;

  constructor(@Inject(CONFIG) config: Config) {
    this.mqtt = new ManagedMqtt(
      config.MQTT_URL,
      {
        clientId: `perspice-api-${hostname()}-${process.pid}`,
        username: config.MQTT_INGEST_USERNAME,
        password: config.MQTT_INGEST_PASSWORD,
        protocolVersion: 5,
        clean: true,
      },
      () => undefined,
    );
  }

  onModuleInit(): void {
    this.mqtt.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.mqtt.stop();
  }

  async publishCommand(deviceId: string, msg: CommandMessage): Promise<void> {
    await this.publish(deviceTopic(deviceId, 'cmd'), JSON.stringify(msg), false);
  }

  /** Shared attributes, retained so a device gets them as soon as it subscribes. */
  async publishConfig(deviceId: string, shared: Record<string, unknown>): Promise<void> {
    await this.publish(deviceTopic(deviceId, 'config'), JSON.stringify(shared), true);
  }

  private async publish(topic: string, payload: string, retain: boolean): Promise<void> {
    const client = this.mqtt.client;
    if (!client?.connected) throw new Error('MQTT publisher not connected');
    await client.publishAsync(topic, payload, { qos: 1, retain });
  }
}
