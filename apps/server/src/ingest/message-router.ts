import { Inject, Injectable, Logger } from '@nestjs/common';
import { AttributesPayload, CommandAck, KEY_PATTERN, parseTopic } from '@perspice/shared';
import { eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { device } from '../db/schema';
import { DebugLogService } from '../devices/debug-log.service';
import { devMetaKey } from '../devices/devices.service';
import { EventBus } from '../events/event-bus';
import { IngestMetrics } from './ingest.metrics';
import { LatestCache } from './latest-cache';
import { normalizeTelemetry } from './normalize';
import {
  ACK_HANDLER,
  type AckHandler,
  PRESENCE_TOUCH,
  type PresenceTouch,
  SESSION_EVENTS,
  type SessionEvents,
} from './ports';
import { sessionKey } from '../presence/presence.service';
import { TelemetryStore } from './telemetry-store';

// Device updates and deletes invalidate it (devices.service), so a long TTL stays correct.
const DEVMETA_TTL_S = 600;
const MAX_ATTRIBUTES_BYTES = 16 * 1024;
const SYS_CLIENT_EVENT = /^\$SYS\/brokers\/[^/]+\/clients\/([^/]+)\/(connected|disconnected)$/;
/** AWS IoT Core lifecycle events (the client id is the thing name, i.e. the device id). */
const AWS_PRESENCE_EVENT = /^\$aws\/events\/presence\/(connected|disconnected)\/([^/]+)$/;

export interface DeviceMeta {
  customerId: string | null;
  profileId: string;
}

export type TelemetryOutcome = { ok: true; rows: number } | { ok: false; reason: string };

/** Routes device messages (MQTT topics or HTTP calls) into storage, presence and live fan-out. */
@Injectable()
export class MessageRouter {
  private readonly logger = new Logger(MessageRouter.name);

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly store: TelemetryStore,
    private readonly latest: LatestCache,
    private readonly debug: DebugLogService,
    private readonly events: EventBus,
    private readonly metrics: IngestMetrics,
    @Inject(PRESENCE_TOUCH) private readonly presence: PresenceTouch,
    @Inject(SESSION_EVENTS) private readonly sessions: SessionEvents,
    @Inject(ACK_HANDLER) private readonly acks: AckHandler,
  ) {}

  /** Never throws: a bad message is logged against its device and the worker keeps running. */
  async handle(topic: string, payload: Buffer): Promise<void> {
    try {
      if (topic.startsWith('$SYS/')) return await this.handleClientEvent(topic, payload);
      if (topic.startsWith('$aws/')) return await this.handleAwsPresence(topic, payload);
      const parsed = parseTopic(topic);
      if (!parsed) return;
      const meta = await this.deviceMeta(parsed.deviceId);
      if (!meta) return;
      switch (parsed.channel) {
        case 'telemetry':
          await this.handleTelemetry(parsed.deviceId, meta, payload);
          return;
        case 'attributes':
          await this.handleAttributes(parsed.deviceId, payload);
          return;
        case 'cmd/ack':
          await this.handleAck(parsed.deviceId, payload);
          return;
        case 'status':
        case 'ota/progress':
          await this.debug.push(parsed.deviceId, {
            ts: Date.now(),
            kind: 'attributes',
            summary: `${parsed.channel}: ${payload.toString('utf8').slice(0, 200)}`,
          });
          return;
      }
    } catch (err) {
      this.metrics.inc('ingest_messages_total', 1, { result: 'error' });
      this.logger.error(`Failed to handle ${topic}: ${(err as Error).message}`);
    }
  }

  async handleTelemetry(deviceId: string, meta: DeviceMeta, payload: Buffer): Promise<TelemetryOutcome> {
    const now = Date.now();
    const result = normalizeTelemetry(payload, now);
    if (!result.ok) {
      this.metrics.inc('ingest_messages_total', 1, { result: 'rejected' });
      await this.debug.push(deviceId, {
        ts: now,
        kind: 'rejected',
        summary: `Rejected telemetry: ${result.reason}`,
        raw: payload.subarray(0, 2048).toString('utf8'),
      });
      return result;
    }
    this.metrics.inc('ingest_messages_total', 1, { result: 'accepted' });
    this.store.writer.enqueue(result.rows.map((r) => ({ ...r, deviceId })));
    const changed = await this.latest.update(deviceId, result.rows);
    await this.presence.touch(deviceId, now);

    const keys = [...new Set(result.rows.map((r) => r.key))];
    const values: Record<string, { ts: number; v: unknown }> = {};
    for (const r of result.rows) {
      if (!values[r.key] || r.ts >= values[r.key]!.ts) values[r.key] = { ts: r.ts, v: r.valueNum ?? r.valueStr ?? r.valueBool ?? r.valueJson };
    }
    await Promise.all([
      this.events.publish({ type: 'telemetry', deviceId, customerId: meta.customerId, keys, values, ts: now }),
      Object.keys(changed).length
        ? this.redis.publish(`ws:telemetry:${deviceId}`, JSON.stringify({ deviceId, values: changed }))
        : undefined,
      this.debug.push(deviceId, {
        ts: now,
        kind: 'telemetry',
        summary: `${result.rows.length} value(s): ${keys.slice(0, 10).join(', ')}`,
        raw: payload.subarray(0, 2048).toString('utf8'),
      }),
      result.adjusted
        ? this.debug.push(deviceId, {
            ts: now,
            kind: 'ts_adjusted',
            summary: `${result.adjusted} message(s) had an implausible timestamp; server time used`,
          })
        : undefined,
    ]);
    return { ok: true, rows: result.rows.length };
  }

  /** Merges client attributes; `fw` also updates the device's firmware version. */
  async handleAttributes(deviceId: string, payload: Buffer): Promise<TelemetryOutcome> {
    const reject = async (reason: string) => {
      await this.debug.push(deviceId, {
        ts: Date.now(),
        kind: 'rejected',
        summary: `Rejected attributes: ${reason}`,
        raw: payload.subarray(0, 2048).toString('utf8'),
      });
      return { ok: false as const, reason };
    };
    if (payload.length > MAX_ATTRIBUTES_BYTES) return reject('payload_too_large');
    let attrs: Record<string, unknown>;
    try {
      const parsed = AttributesPayload.safeParse(JSON.parse(payload.toString('utf8')));
      if (!parsed.success || Array.isArray(parsed.data)) return reject('invalid_schema');
      attrs = parsed.data;
    } catch {
      return reject('invalid_json');
    }
    if (!Object.keys(attrs).every((k) => KEY_PATTERN.test(k))) return reject('invalid_key');
    const fw = typeof attrs.fw === 'string' ? attrs.fw.slice(0, 64) : null;
    await this.db
      .update(device)
      .set({
        attributes: sql`jsonb_set(${device.attributes}, '{client}', coalesce(${device.attributes}->'client', '{}'::jsonb) || ${JSON.stringify(attrs)}::jsonb)`,
        ...(fw ? { firmwareVersion: fw } : {}),
      })
      .where(eq(device.id, deviceId));
    await this.presence.touch(deviceId, Date.now());
    await this.debug.push(deviceId, {
      ts: Date.now(),
      kind: 'attributes',
      summary: `Attributes: ${Object.keys(attrs).join(', ')}`,
      raw: payload.subarray(0, 2048).toString('utf8'),
    });
    return { ok: true, rows: Object.keys(attrs).length };
  }

  async handleAck(deviceId: string, payload: Buffer): Promise<void> {
    let ack: CommandAck;
    try {
      ack = CommandAck.parse(JSON.parse(payload.toString('utf8')));
    } catch {
      await this.debug.push(deviceId, {
        ts: Date.now(),
        kind: 'rejected',
        summary: 'Rejected command ack: invalid payload',
        raw: payload.subarray(0, 2048).toString('utf8'),
      });
      return;
    }
    await this.presence.touch(deviceId, Date.now());
    await this.acks.handleAck(deviceId, ack);
  }

  private async handleClientEvent(topic: string, payload: Buffer): Promise<void> {
    const match = SYS_CLIENT_EVENT.exec(topic);
    if (!match) return;
    const [, clientId, kind] = match as unknown as [string, string, 'connected' | 'disconnected'];
    if (!isUuid(clientId) || !(await this.deviceMeta(clientId))) return;
    const event = JSON.parse(payload.toString('utf8')) as { connected_at?: number; reason?: string; ipaddress?: string };
    const connectedAt = Number(event.connected_at ?? Date.now());
    if (kind === 'connected') {
      await this.sessions.onConnected(clientId, connectedAt);
      await this.debug.push(clientId, { ts: Date.now(), kind: 'connect', summary: `MQTT connected from ${event.ipaddress ?? '?'}` });
    } else {
      await this.sessions.onDisconnected(clientId, connectedAt, event.reason ?? 'unknown');
      await this.debug.push(clientId, { ts: Date.now(), kind: 'disconnect', summary: `MQTT disconnected: ${event.reason ?? 'unknown'}` });
    }
  }

  private async handleAwsPresence(topic: string, payload: Buffer): Promise<void> {
    const match = AWS_PRESENCE_EVENT.exec(topic);
    if (!match) return;
    const [, kind, clientId] = match as unknown as [string, 'connected' | 'disconnected', string];
    if (!isUuid(clientId) || !(await this.deviceMeta(clientId))) return;
    const event = JSON.parse(payload.toString('utf8')) as { timestamp?: number; sessionIdentifier?: string; disconnectReason?: string; ipAddress?: string };
    // AWS sends one event per connection; its timestamp orders connect/disconnect like EMQX's connected_at.
    const at = Number(event.timestamp ?? Date.now());
    if (kind === 'connected') {
      await this.sessions.onConnected(clientId, at);
      await this.debug.push(clientId, { ts: Date.now(), kind: 'connect', summary: `AWS IoT connected from ${event.ipAddress ?? '?'}` });
    } else {
      // The disconnect carries its own time, which is later than the connect it ends.
      const connectedAt = Number((await this.sessionStart(clientId)) ?? at);
      await this.sessions.onDisconnected(clientId, connectedAt, event.disconnectReason ?? 'unknown');
      await this.debug.push(clientId, { ts: Date.now(), kind: 'disconnect', summary: `AWS IoT disconnected: ${event.disconnectReason ?? 'unknown'}` });
    }
  }

  private sessionStart(deviceId: string): Promise<string | null> {
    return this.redis.get(sessionKey(deviceId));
  }

  /** Device → `{customerId, profileId}`, cached 10 min; null for unknown/deleted devices. */
  async deviceMeta(deviceId: string): Promise<DeviceMeta | null> {
    if (!isUuid(deviceId)) return null;
    const cached = await this.redis.get(devMetaKey(deviceId));
    if (cached) return cached === 'none' ? null : (JSON.parse(cached) as DeviceMeta);
    const row = await this.db.query.device.findFirst({
      where: eq(device.id, deviceId),
      columns: { customerId: true, profileId: true },
    });
    await this.redis.set(devMetaKey(deviceId), row ? JSON.stringify(row) : 'none', 'EX', DEVMETA_TTL_S);
    return row ?? null;
  }
}
