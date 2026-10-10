import { type DynamicModule, Global, Module } from '@nestjs/common';
import { CalculatedService } from './calculated';
import { DeviceTokenGuard } from './device-token.guard';
import { HttpDeviceController } from './http-device.controller';
import { IngestMetrics } from './ingest.metrics';
import { LatestCache } from './latest-cache';
import { MessageRouter } from './message-router';
import { MqttIngestClient } from './mqtt-ingest.client';
import { PresenceService } from '../presence/presence.service';
import { CommandsService } from '../commands/commands.service';
import { ACK_HANDLER, PRESENCE_TOUCH, SESSION_EVENTS } from './ports';
import { TelemetryStore } from './telemetry-store';

@Global()
@Module({})
export class IngestModule {
  /** The router serves both transports; MQTT runs in the ingest role, HTTP in the api role. */
  static forRoot(opts: { mqtt: boolean; http: boolean }): DynamicModule {
    return {
      module: IngestModule,
      controllers: opts.http ? [HttpDeviceController] : [],
      providers: [
        DeviceTokenGuard,
        IngestMetrics,
        LatestCache,
        CalculatedService,
        TelemetryStore,
        MessageRouter,
        { provide: PRESENCE_TOUCH, useExisting: PresenceService },
        { provide: SESSION_EVENTS, useExisting: PresenceService },
        { provide: ACK_HANDLER, useExisting: CommandsService },
        ...(opts.mqtt ? [MqttIngestClient] : []),
      ],
      exports: [MessageRouter, LatestCache, IngestMetrics, TelemetryStore],
    };
  }
}
