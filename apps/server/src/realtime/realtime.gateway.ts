import { Inject, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { MAX_DASHBOARD_DEVICES } from '@perspice/shared';
import { and, inArray } from 'drizzle-orm';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type Redis from 'ioredis';
import type { Namespace, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { SessionService } from '../auth/session.service';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { isUuid, scoped } from '../db/scoped-repo';
import { device } from '../db/schema';
import { DevicesService } from '../devices/devices.service';
import { ScopeService } from '../rbac/scope';
import { Heartbeat } from '../system/heartbeat';
import { MetricsService } from '../system/metrics.service';

type AuthedSocket = Socket & { data: { user: AuthUser } };

const CHANNEL = /^ws:(telemetry|location|status|command|notify|alarm):(.+)$/;

/** Redis channel kind → socket.io room prefix and event name. */
const ROUTES: Record<string, { room: string; event: string }> = {
  telemetry: { room: 'device', event: 'telemetry' },
  location: { room: 'device', event: 'location' },
  command: { room: 'device', event: 'command' },
  status: { room: 'status', event: 'status' },
  alarm: { room: 'alarm', event: 'alarm' },
  notify: { room: 'user', event: 'notification' },
};

/**
 * Live updates (spec §7.4). Each api instance subscribes to the `ws:*` Redis channels and emits
 * to its own local sockets, so every event reaches every instance's subscribers exactly once.
 */
const canFollowValues = (u: { permissions: readonly string[] }) => u.permissions.includes('device.read') && u.permissions.includes('telemetry.read');

@WebSocketGateway({ namespace: '/rt', path: '/api/socket.io', serveClient: false })
export class RealtimeGateway implements OnGatewayInit, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() private server!: Namespace;
  private sub?: Redis;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly devices: DevicesService,
    private readonly scopes: ScopeService,
    @Inject(DB) private readonly db: DB,
    private readonly metrics: MetricsService,
    private readonly heartbeat: Heartbeat,
  ) {}

  afterInit(server: Namespace): void {
    this.metrics.gauge('perspice_websocket_clients', 'Connected browser sessions on this instance', [], (g) => g.set(server.sockets.size));
    this.heartbeat.field('websocketClients', () => server.sockets.size);
    server.use((socket, next) => {
      void this.authenticate(socket).then(
        (user) => {
          if (!user) return next(new Error('UNAUTHENTICATED'));
          socket.data.user = user;
          void socket.join(`user:${user.id}`);
          next();
        },
        () => next(new Error('UNAUTHENTICATED')),
      );
    });
    this.sub = this.redis.duplicate();
    this.sub.on('pmessage', (_pattern, channel, message) => this.forward(channel, message));
    void this.sub.psubscribe('ws:*');
  }

  async onApplicationShutdown(): Promise<void> {
    this.sub?.disconnect();
  }

  @SubscribeMessage('subscribe:device')
  async subscribeDevice(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { deviceId?: string }) {
    // Device rooms carry live values and positions: the same permissions as reading them.
    if (!canFollowValues(socket.data.user)) return { ok: false, code: 'FORBIDDEN' };
    try {
      const d = await this.devices.find(socket.data.user, String(body?.deviceId ?? ''));
      await socket.join(`device:${d.id}`);
      return { ok: true };
    } catch {
      return { ok: false, code: 'NOT_FOUND' };
    }
  }

  /** Dashboards follow many devices at once; one scoped query decides which may be joined. */
  @SubscribeMessage('subscribe:devices')
  async subscribeDevices(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { deviceIds?: unknown }) {
    if (!canFollowValues(socket.data.user)) return { ok: false, code: 'FORBIDDEN' };
    const requested = Array.isArray(body?.deviceIds) ? body.deviceIds.map(String) : [];
    if (requested.length > MAX_DASHBOARD_DEVICES) return { ok: false, code: 'VALIDATION' };
    const candidates = [...new Set(requested.filter(isUuid))];
    const scope = await this.scopes.forUser(socket.data.user);
    const allowed = candidates.length
      ? new Set(
          (await this.db.select({ id: device.id }).from(device).where(and(scoped(device, scope, inArray(device.id, candidates))))).map(
            (r) => r.id,
          ),
        )
      : new Set<string>();
    const joined = requested.filter((id) => allowed.has(id));
    await socket.join(joined.map((id) => `device:${id}`));
    return { ok: true, joined, rejected: requested.filter((id) => !allowed.has(id)) };
  }

  @SubscribeMessage('unsubscribe:devices')
  async unsubscribeDevices(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { deviceIds?: unknown }) {
    const ids = Array.isArray(body?.deviceIds) ? body.deviceIds.map(String) : [];
    await Promise.all(ids.map((id) => socket.leave(`device:${id}`)));
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe:device')
  async unsubscribeDevice(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { deviceId?: string }) {
    await socket.leave(`device:${String(body?.deviceId ?? '')}`);
    return { ok: true };
  }

  /** Platform users get every customer's status changes; customer users only their own. */
  @SubscribeMessage('subscribe:status')
  async subscribeStatus(@ConnectedSocket() socket: AuthedSocket) {
    const u = socket.data.user;
    if (!u.permissions.includes('device.read')) return { ok: false, code: 'FORBIDDEN' };
    await socket.join(u.scopeType === 'platform' ? 'status:platform' : `status:${u.customerId}`);
    return { ok: true };
  }

  /** Alarm changes for the viewer's tenant (platform users: all customers). */
  @SubscribeMessage('subscribe:alarms')
  async subscribeAlarms(@ConnectedSocket() socket: AuthedSocket) {
    const u = socket.data.user;
    if (!u.permissions.includes('alarm.read')) return { ok: false, code: 'FORBIDDEN' };
    await socket.join(u.scopeType === 'platform' ? 'alarm:platform' : `alarm:${u.customerId}`);
    return { ok: true };
  }

  private async authenticate(socket: Socket): Promise<AuthUser | null> {
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    if (typeof token !== 'string') return null;
    if (token.startsWith('pk_')) return this.auth.authUserForApiKey(token);
    const claims = await this.sessions.verifyAccess(token);
    return claims ? this.auth.authUserForSession(claims.sub, claims.sid) : null;
  }

  private forward(channel: string, message: string): void {
    const match = CHANNEL.exec(channel);
    if (!match) return;
    const [, kind, target] = match as unknown as [string, string, string];
    const route = ROUTES[kind];
    if (!route) {
      this.logger.debug(`Unhandled channel ${channel}`);
      return;
    }
    // Every telemetry message arrives here, but few devices are watched at any moment: skip the
    // parse and socket.io's encoding when no local socket is in the room.
    const room = `${route.room}:${target}`;
    if (!this.server.adapter.rooms.get(room)?.size) return;
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }
    this.server.local.to(room).emit(route.event, payload);
  }
}
