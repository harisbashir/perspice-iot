import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type CommandMessage, type OtaMessage, deviceTopic } from '@perspice/shared';
import { hostname } from 'node:os';
import { CONFIG, type Config } from '../config/config';
import { ManagedMqtt } from '../ingest/managed-mqtt';

/**
 * Publishes commands and config to devices: on EMQX with the ingest credentials (the ACL allows
 * downstream topics), on AWS IoT Core through the data-plane API.
 */
@Injectable()
export class CommandsPublisher implements OnModuleInit, OnApplicationShutdown {
  private readonly mqtt?: ManagedMqtt;
  private readonly dataPlane?: IoTDataPlaneClient;

  constructor(@Inject(CONFIG) config: Config) {
    if (config.MQTT_TRANSPORT === 'aws-iot') {
      this.dataPlane = new IoTDataPlaneClient({ region: config.AWS_REGION, endpoint: `https://${config.AWS_IOT_ENDPOINT}` });
      return;
    }
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
    this.mqtt?.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.mqtt?.stop();
    this.dataPlane?.destroy();
  }

  /** Whether a publish can go out now (always on AWS IoT Core, which is reached over HTTPS). */
  get connected(): boolean {
    return this.dataPlane ? true : (this.mqtt?.connected ?? false);
  }

  async publishCommand(deviceId: string, msg: CommandMessage): Promise<void> {
    await this.publish(deviceTopic(deviceId, 'cmd'), JSON.stringify(msg), false);
  }

  /** A firmware update (not retained: a device that misses it gets it again on reconnect). */
  async publishOta(deviceId: string, msg: OtaMessage): Promise<void> {
    await this.publish(deviceTopic(deviceId, 'ota'), JSON.stringify(msg), false);
  }

  /** Shared attributes, retained so a device gets them as soon as it subscribes. */
  async publishConfig(deviceId: string, shared: Record<string, unknown>): Promise<void> {
    await this.publish(deviceTopic(deviceId, 'config'), JSON.stringify(shared), true);
  }

  private async publish(topic: string, payload: string, retain: boolean): Promise<void> {
    if (this.dataPlane) {
      await this.dataPlane.send(new PublishCommand({ topic, qos: 1, retain, payload: Buffer.from(payload) }));
      return;
    }
    const client = this.mqtt!.client;
    if (!client?.connected) throw new Error('MQTT publisher not connected');
    await client.publishAsync(topic, payload, { qos: 1, retain });
  }
}
