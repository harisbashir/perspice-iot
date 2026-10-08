import { type DynamicModule, Global, Module } from '@nestjs/common';
import { IngestMetrics } from './ingest.metrics';
import { LatestCache } from './latest-cache';
import { MessageRouter } from './message-router';
import { MqttIngestClient } from './mqtt-ingest.client';
import { ACK_HANDLER, PRESENCE_TOUCH, SESSION_EVENTS, noopAckHandler, noopPresence } from './ports';
import { TelemetryStore } from './telemetry-store';

@Global()
@Module({})
export class IngestModule {
  /** The router serves both transports; the MQTT subscriber runs only in the ingest role. */
  static forRoot(opts: { mqtt: boolean }): DynamicModule {
    return {
      module: IngestModule,
      providers: [
        IngestMetrics,
        LatestCache,
        TelemetryStore,
        MessageRouter,
        { provide: PRESENCE_TOUCH, useValue: noopPresence },
        { provide: SESSION_EVENTS, useValue: noopPresence },
        { provide: ACK_HANDLER, useValue: noopAckHandler },
        ...(opts.mqtt ? [MqttIngestClient] : []),
      ],
      exports: [MessageRouter, LatestCache, IngestMetrics, TelemetryStore],
    };
  }
}
