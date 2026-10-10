import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CommandAck, CommandDef } from '@perspice/shared';
import { Ajv, type ValidateFunction } from 'ajv';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { AuthUser } from '../auth/auth.types';
import { notFound, validation } from '../common/app-error';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { command, device, deviceProfile } from '../db/schema';
import { DebugLogService } from '../devices/debug-log.service';
import { DevicesService } from '../devices/devices.service';
import type { AckHandler } from '../ingest/ports';
import { CommandsPublisher } from './commands.publisher';

type CommandRow = typeof command.$inferSelect;

export interface CommandDto {
  id: string;
  deviceId: string;
  name: string;
  params: Record<string, unknown>;
  status: CommandRow['status'];
  result: unknown;
  persistUntilOnline: boolean;
  ttlS: number;
  createdAt: number;
  sentAt: number | null;
  completedAt: number | null;
  expiresAt: number | null;
}

export const toCommandDto = (c: CommandRow): CommandDto => ({
  id: c.id,
  deviceId: c.deviceId,
  name: c.name,
  params: c.params,
  status: c.status,
  result: c.result ?? null,
  persistUntilOnline: c.persistUntilOnline,
  ttlS: c.ttlS,
  createdAt: c.createdAt.getTime(),
  sentAt: c.sentAt?.getTime() ?? null,
  completedAt: c.completedAt?.getTime() ?? null,
  expiresAt: c.expiresAt?.getTime() ?? null,
});

export interface SendCommandInput {
  name: string;
  params?: Record<string, unknown>;
  persistUntilOnline?: boolean;
  ttlS?: number;
}

export const cmdQueueKey = (deviceId: string) => `cmdq:${deviceId}`;

@Injectable()
export class CommandsService implements AckHandler {
  private readonly logger = new Logger(CommandsService.name);
  private readonly ajv = new Ajv({ allErrors: true, strict: false });
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly devices: DevicesService,
    private readonly publisher: CommandsPublisher,
    private readonly debug: DebugLogService,
  ) {}

  async send(actor: AuthUser, deviceId: string, input: SendCommandInput): Promise<CommandDto> {
    const d = await this.devices.find(actor, deviceId);
    const profile = (await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, d.profileId) }))!;
    const def = profile.commands.find((c) => c.name === input.name);
    if (!def) throw validation([{ path: ['name'], message: `Command "${input.name}" is not declared on the profile` }]);
    const params = input.params ?? {};
    this.validateParams(profile.id, def, params);

    const ttlS = input.ttlS ?? 30;
    const now = new Date();
    const [row] = await this.db
      .insert(command)
      .values({
        deviceId: d.id,
        customerId: d.customerId,
        name: def.name,
        params,
        requestedBy: actor.id,
        persistUntilOnline: input.persistUntilOnline ?? false,
        ttlS,
        expiresAt: new Date(now.getTime() + ttlS * 1000),
      })
      .returning();
    let cmd = row!;

    if (profile.transport === 'http') {
      await this.redis.rpush(cmdQueueKey(d.id), cmd.id);
    } else if (d.status === 'online' || !cmd.persistUntilOnline) {
      cmd = (await this.dispatch(cmd)) ?? cmd;
    }
    await this.notify(cmd);
    return toCommandDto(cmd);
  }

  async list(actor: AuthUser, deviceId: string, limit: number): Promise<CommandDto[]> {
    await this.devices.find(actor, deviceId);
    const rows = await this.db
      .select()
      .from(command)
      .where(eq(command.deviceId, deviceId))
      .orderBy(desc(command.createdAt))
      .limit(limit);
    return rows.map(toCommandDto);
  }

  async get(actor: AuthUser, id: string): Promise<CommandDto> {
    if (!isUuid(id)) throw notFound();
    const row = await this.db.query.command.findFirst({ where: eq(command.id, id) });
    if (!row) throw notFound();
    await this.devices.find(actor, row.deviceId); // scope check through the device
    return toCommandDto(row);
  }

  /** Only the target device's ack counts; acks after completion or timeout are ignored. */
  async handleAck(deviceId: string, ack: CommandAck): Promise<void> {
    if (!isUuid(ack.cid)) return;
    const [row] = await this.db
      .update(command)
      .set({ status: ack.status, result: ack.result ?? null, completedAt: new Date() })
      .where(and(eq(command.id, ack.cid), eq(command.deviceId, deviceId), inArray(command.status, ['queued', 'sent'])))
      .returning();
    if (!row) {
      await this.debug.push(deviceId, {
        ts: Date.now(),
        kind: 'command',
        summary: `Ignored ack for ${ack.cid} (unknown, completed or timed out)`,
      });
      return;
    }
    await this.debug.push(deviceId, { ts: Date.now(), kind: 'command', summary: `${row.name} → ${ack.status}` });
    await this.notify(row);
  }

  /** Sends commands held for a device that just came online (MQTT transport). */
  async sendQueued(deviceId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(command)
      .where(
        and(
          eq(command.deviceId, deviceId),
          eq(command.status, 'queued'),
          sql`${command.expiresAt} > now()`,
          sql`EXISTS (SELECT 1 FROM ${device} d JOIN ${deviceProfile} p ON p.id = d.profile_id
                      WHERE d.id = ${command.deviceId} AND p.transport = 'mqtt')`,
        ),
      )
      .orderBy(command.createdAt);
    for (const row of rows) {
      const sent = await this.dispatch(row);
      if (sent) await this.notify(sent);
    }
  }

  /** HTTP long-poll: next queued command for the device, marked sent. */
  async nextForHttp(deviceId: string, waitS: number): Promise<CommandDto | null> {
    const deadline = Date.now() + waitS * 1000;
    const conn = waitS > 0 ? this.redis.duplicate() : this.redis;
    try {
      for (;;) {
        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        const cid =
          waitS > 0 && remaining > 0
            ? ((await conn.blpop(cmdQueueKey(deviceId), remaining))?.[1] ?? null)
            : await this.redis.lpop(cmdQueueKey(deviceId));
        if (!cid) return null;
        const [row] = await this.db
          .update(command)
          .set({ status: 'sent', sentAt: new Date() })
          .where(and(eq(command.id, cid), eq(command.deviceId, deviceId), eq(command.status, 'queued')))
          .returning();
        if (row) {
          await this.notify(row);
          return toCommandDto(row);
        }
        if (Date.now() >= deadline) return null; // expired or cancelled; keep polling until the deadline
      }
    } finally {
      if (conn !== this.redis) conn.disconnect();
    }
  }

  /** Marks overdue commands as timed out. `now` is injectable for tests. */
  async expire(now: Date): Promise<number> {
    const rows = await this.db
      .update(command)
      .set({ status: 'timeout', completedAt: now })
      .where(
        sql`(${command.status} = 'sent' AND ${command.sentAt} + ${command.ttlS} * interval '1 second' <= ${now})
            OR (${command.status} = 'queued' AND ${command.expiresAt} <= ${now})`,
      )
      .returning();
    for (const row of rows) await this.notify(row);
    return rows.length;
  }

  private async dispatch(row: CommandRow): Promise<CommandRow | null> {
    try {
      await this.publisher.publishCommand(row.deviceId, { cid: row.id, name: row.name, params: row.params });
    } catch (err) {
      this.logger.warn(`Publishing command ${row.id} failed: ${(err as Error).message}`);
      return null;
    }
    const [sent] = await this.db
      .update(command)
      .set({ status: 'sent', sentAt: new Date() })
      .where(and(eq(command.id, row.id), eq(command.status, 'queued')))
      .returning();
    return sent ?? null;
  }

  private validateParams(profileId: string, def: CommandDef, params: Record<string, unknown>): void {
    if (!def.paramsSchema) return;
    const key = `${profileId}:${def.name}:${JSON.stringify(def.paramsSchema)}`;
    let validate = this.validators.get(key);
    if (!validate) {
      try {
        validate = this.ajv.compile(def.paramsSchema);
      } catch {
        throw validation([{ path: ['params'], message: 'The profile declares an invalid parameter schema' }]);
      }
      this.validators.set(key, validate);
    }
    if (!validate(params)) {
      throw validation(
        (validate.errors ?? []).map((e) => ({ path: ['params', ...e.instancePath.split('/').filter(Boolean)], message: e.message })),
        'Invalid command parameters',
      );
    }
  }

  private async notify(row: CommandRow): Promise<void> {
    await this.redis.publish(`ws:command:${row.deviceId}`, JSON.stringify({ deviceId: row.deviceId, command: toCommandDto(row) }));
  }
}

