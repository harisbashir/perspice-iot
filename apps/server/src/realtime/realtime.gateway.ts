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

type AuthedSocket = Socket & { data: { user: AuthUser } };

const CHANNEL = /^ws:(telemetry|status|command|notify):(.+)$/;

/**
 * Live updates (spec §7.4). Each api instance subscribes to the `ws:*` Redis channels and emits
 * to its own local sockets, so every event reaches every instance's subscribers exactly once.
 */
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
  ) {}

  afterInit(server: Namespace): void {
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
    await socket.join(u.scopeType === 'platform' ? 'status:platform' : `status:${u.customerId}`);
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
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }
    const local = this.server.local;
    switch (kind) {
      case 'telemetry':
        local.to(`device:${target}`).emit('telemetry', payload);
        break;
      case 'command':
        local.to(`device:${target}`).emit('command', payload);
        break;
      case 'status':
        local.to(`status:${target}`).emit('status', payload);
        break;
      case 'notify':
        local.to(`user:${target}`).emit('notification', payload);
        break;
      default:
        this.logger.debug(`Unhandled channel ${channel}`);
    }
  }
}
