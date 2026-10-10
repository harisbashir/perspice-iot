import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AwsIotBundle, type DeviceDto, type DeviceLocationDto, ErrorCode, type LatestValue } from '@perspice/shared';
import { type SQL, and, arrayContains, asc, count, eq, gt, ilike, or } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { AuthUser } from '../auth/auth.types';
import { AppError, forbidden, notFound, validation } from '../common/app-error';
import { REDIS } from '../common/redis.module';
import { CustomersService } from '../customers/customers.service';
import { DB } from '../db/db.module';
import { findOneOr404, scoped } from '../db/scoped-repo';
import { assetDevice, device, deviceProfile, telemetry } from '../db/schema';
import { ensureDeviceDashboard } from '../dashboards/assignment';
import { EventBus } from '../events/event-bus';
import { ScopeService } from '../rbac/scope';
import { CredentialsService } from './credentials.service';
import { DebugLogService } from './debug-log.service';
import { ProfilesService } from './profiles.service';
import { AwsIotProvisioning } from '../aws/iot-provisioning';
import { locationKey } from '../location/location.service';

type DeviceRow = typeof device.$inferSelect;
type ProfileRow = typeof deviceProfile.$inferSelect;

export const LATEST_KEY = (deviceId: string) => `latest:${deviceId}`;
export const PRESENCE_LAST_SEEN = 'presence:last_seen';
/** Cached `{customerId, profileId}` used on the ingest hot path (Task 12). */
export const devMetaKey = (deviceId: string) => `devmeta:${deviceId}`;
const MAX_ATTRIBUTES_BYTES = 16 * 1024;

export interface EffectiveTimeouts {
  offlineS: number;
  deadS: number;
  sleepy: boolean;
}

export function effectiveTimeouts(
  d: Pick<DeviceRow, 'offlineTimeoutS' | 'deadTimeoutS'>,
  p: Pick<ProfileRow, 'offlineTimeoutS' | 'deadTimeoutS' | 'sleepy'>,
): EffectiveTimeouts {
  return { offlineS: d.offlineTimeoutS ?? p.offlineTimeoutS, deadS: d.deadTimeoutS ?? p.deadTimeoutS, sleepy: p.sleepy };
}

export interface CreateDeviceInput {
  name: string;
  profileId: string;
  customerId?: string | null;
  groupId?: string | null;
  tags?: string[];
  offlineTimeoutS?: number | null;
  deadTimeoutS?: number | null;
}

export interface UpdateDeviceInput extends Partial<CreateDeviceInput> {
  disabled?: boolean;
}

export interface ListDevicesQuery {
  search?: string;
  profileId?: string;
  status?: DeviceDto['status'];
  customerId?: string;
  tag?: string;
  cursor?: string;
  limit: number;
}

/** Fields a customer user may change on their own devices. */
const CUSTOMER_EDITABLE = new Set(['name', 'tags', 'groupId']);

const encodeCursor = (d: DeviceRow) => Buffer.from(JSON.stringify([d.name, d.id])).toString('base64url');
function decodeCursor(c: string): [string, string] {
  try {
    return JSON.parse(Buffer.from(c, 'base64url').toString()) as [string, string];
  } catch {
    throw validation([{ path: ['cursor'], message: 'Invalid cursor' }]);
  }
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly scopes: ScopeService,
    private readonly profiles: ProfilesService,
    private readonly customers: CustomersService,
    private readonly credentials: CredentialsService,
    private readonly debug: DebugLogService,
    private readonly events: EventBus,
    private readonly aws: AwsIotProvisioning,
  ) {}

  async list(actor: AuthUser, q: ListDevicesQuery): Promise<{ items: DeviceDto[]; nextCursor: string | null }> {
    const scope = await this.scopes.forUser(actor);
    const conds: (SQL | undefined)[] = [
      q.search ? ilike(device.name, `%${q.search}%`) : undefined,
      q.profileId ? eq(device.profileId, q.profileId) : undefined,
      q.status ? eq(device.status, q.status) : undefined,
      q.customerId ? eq(device.customerId, q.customerId) : undefined,
      q.tag ? arrayContains(device.tags, [q.tag]) : undefined,
    ];
    if (q.cursor) {
      const [name, id] = decodeCursor(q.cursor);
      conds.push(or(gt(device.name, name), and(eq(device.name, name), gt(device.id, id))));
    }
    const rows = await this.db
      .select()
      .from(device)
      .where(scoped(device, scope, ...conds))
      .orderBy(asc(device.name), asc(device.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return {
      items: await this.toDtos(page),
      nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  /** Device counts by status in the caller's scope (overview KPI tiles). */
  async stats(actor: AuthUser): Promise<Record<DeviceDto['status'] | 'total', number>> {
    const scope = await this.scopes.forUser(actor);
    const rows = await this.db
      .select({ status: device.status, n: count() })
      .from(device)
      .where(scoped(device, scope))
      .groupBy(device.status);
    const out = { total: 0, online: 0, offline: 0, dead: 0, never: 0 };
    for (const r of rows) {
      out[r.status] = r.n;
      out.total += r.n;
    }
    return out;
  }

  async find(actor: AuthUser, id: string): Promise<DeviceRow> {
    return findOneOr404(this.db, device, id, await this.scopes.forUser(actor));
  }

  async get(actor: AuthUser, id: string): Promise<DeviceDto> {
    const [dto] = await this.toDtos([await this.find(actor, id)]);
    return dto!;
  }

  async create(actor: AuthUser, input: CreateDeviceInput): Promise<{ device: DeviceDto; token: string; awsIot?: AwsIotBundle }> {
    const scope = await this.scopes.forUser(actor);
    const profile = await this.profiles.get(actor, input.profileId);
    let customerId = input.customerId ?? null;
    if (scope.kind === 'customer') {
      if (customerId && customerId !== scope.customerId) throw notFound();
      customerId = scope.customerId;
    } else if (customerId) {
      await this.customers.get(customerId);
    }
    const groupId = await this.resolveGroup(customerId, input.groupId ?? null);
    this.assertTimeouts(input, profile);

    const { token, hash } = this.credentials.newToken();
    const [row] = await this.db
      .insert(device)
      .values({
        name: input.name,
        profileId: profile.id,
        customerId,
        groupId,
        tags: input.tags ?? [],
        offlineTimeoutS: input.offlineTimeoutS ?? null,
        deadTimeoutS: input.deadTimeoutS ?? null,
        credentialsHash: hash,
      })
      .returning();
    await ensureDeviceDashboard(this.db, row!.profileId, row!.customerId);
    let awsIot: AwsIotBundle | undefined;
    if (profile.transport === 'aws-iot') {
      // The thing and certificate are created now; the key is only in this response (Review Focus 4).
      try {
        const { certificateArn, bundle } = await this.aws.provision(row!.id);
        await this.db.update(device).set({ awsCertificateArn: certificateArn }).where(eq(device.id, row!.id));
        awsIot = bundle;
      } catch (err) {
        await this.db.delete(device).where(eq(device.id, row!.id));
        throw new AppError(ErrorCode.INTERNAL, `AWS IoT Core refused the device: ${(err as Error).message}`, 502);
      }
    }
    const [dto] = await this.toDtos([row!]);
    return { device: dto!, token, ...(awsIot ? { awsIot } : {}) };
  }

  async update(actor: AuthUser, id: string, patch: UpdateDeviceInput): Promise<DeviceDto> {
    const existing = await this.find(actor, id);
    if (actor.scopeType === 'customer') {
      const blocked = Object.keys(patch).filter((k) => !CUSTOMER_EDITABLE.has(k));
      if (blocked.length) throw forbidden(`Customers cannot change: ${blocked.join(', ')}`);
    }

    const set: Partial<typeof device.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.tags !== undefined) set.tags = patch.tags;
    if (patch.disabled !== undefined) set.disabled = patch.disabled;
    if (patch.offlineTimeoutS !== undefined) set.offlineTimeoutS = patch.offlineTimeoutS;
    if (patch.deadTimeoutS !== undefined) set.deadTimeoutS = patch.deadTimeoutS;

    let profile = await this.profiles.get(actor, existing.profileId);
    if (patch.profileId !== undefined && patch.profileId !== existing.profileId) {
      profile = await this.profiles.get(actor, patch.profileId);
      set.profileId = profile.id;
    }
    this.assertTimeouts({ ...existing, ...set }, profile);

    const customerId = patch.customerId !== undefined ? patch.customerId : existing.customerId;
    if (patch.customerId !== undefined && patch.customerId !== existing.customerId) {
      if (patch.customerId) await this.customers.get(patch.customerId);
      set.customerId = patch.customerId;
      set.groupId = null;
      // An asset belongs to one customer: a device that changes customer leaves its asset.
      await this.db.delete(assetDevice).where(eq(assetDevice.deviceId, id));
    }
    if (patch.groupId !== undefined) set.groupId = await this.resolveGroup(customerId ?? null, patch.groupId);

    const [row] = await this.db.update(device).set(set).where(eq(device.id, id)).returning();
    if (set.customerId !== undefined || set.profileId !== undefined) await ensureDeviceDashboard(this.db, row!.profileId, row!.customerId);
    await this.redis.del(devMetaKey(id), `timeouts:${id}`);
    if (set.disabled !== undefined || set.customerId !== undefined) {
      await this.credentials.invalidate(id);
      if (set.disabled) await this.emit('device.credentials_changed', row!);
    }
    const [dto] = await this.toDtos([row!]);
    return dto!;
  }

  /** Gives an unassigned device to a customer (claiming; the caller has checked the code). */
  async assignClaimed(id: string, customerId: string, groupId: string | null, name?: string): Promise<DeviceDto> {
    const set: Partial<typeof device.$inferInsert> = { customerId, groupId: await this.resolveGroup(customerId, groupId) };
    if (name) set.name = name;
    const [row] = await this.db.update(device).set(set).where(eq(device.id, id)).returning();
    if (!row) throw notFound();
    await ensureDeviceDashboard(this.db, row.profileId, row.customerId);
    await this.redis.del(devMetaKey(id), `timeouts:${id}`);
    await this.credentials.invalidate(id);
    const [dto] = await this.toDtos([row]);
    return dto!;
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    const existing = await this.find(actor, id);
    await this.db.delete(device).where(eq(device.id, id));
    await this.credentials.invalidate(id, existing.credentialsHash);
    await this.redis
      .multi()
      .del(devMetaKey(id), LATEST_KEY(id))
      .zrem(PRESENCE_LAST_SEEN, id)
      .exec();
    await this.debug.clear(id);
    if (existing.awsCertificateArn) await this.aws.deprovision(id, existing.awsCertificateArn);
    await this.emit('device.deleted', existing);
    // History can be large; remove it in the background rather than holding the request.
    void this.db
      .delete(telemetry)
      .where(eq(telemetry.deviceId, id))
      .catch((err: Error) => this.logger.warn(`Telemetry cleanup for ${id} failed: ${err.message}`));
  }

  async regenerateCredentials(actor: AuthUser, id: string): Promise<{ token: string; awsIot?: AwsIotBundle }> {
    const existing = await this.find(actor, id);
    const { token, hash } = this.credentials.newToken();
    let awsIot: AwsIotBundle | undefined;
    if (existing.awsCertificateArn) {
      const rotated = await this.aws.rotate(id, existing.awsCertificateArn);
      await this.db.update(device).set({ awsCertificateArn: rotated.certificateArn }).where(eq(device.id, id));
      awsIot = rotated.bundle;
    }
    await this.db.update(device).set({ credentialsHash: hash }).where(eq(device.id, id));
    await this.credentials.invalidate(id, existing.credentialsHash);
    await this.emit('device.credentials_changed', existing);
    return { token, ...(awsIot ? { awsIot } : {}) };
  }

  async setAttributes(actor: AuthUser, id: string, kind: 'server' | 'shared', values: Record<string, unknown>) {
    const existing = await this.find(actor, id);
    if (Buffer.byteLength(JSON.stringify(values)) > MAX_ATTRIBUTES_BYTES) {
      throw validation([{ path: [], message: 'Attributes must be at most 16 KB' }]);
    }
    const attributes = { ...existing.attributes, [kind]: values };
    const [row] = await this.db.update(device).set({ attributes }).where(eq(device.id, id)).returning();
    if (kind === 'shared') {
      await this.events.publish({
        type: 'device.config_changed',
        deviceId: id,
        customerId: existing.customerId,
        shared: values,
        ts: Date.now(),
      });
    }
    const [dto] = await this.toDtos([row!]);
    return dto!;
  }

  async debugLog(actor: AuthUser, id: string) {
    await this.find(actor, id);
    return this.debug.list(id);
  }

  /** Effective presence timeouts for a device (device override, else profile). */
  async timeoutsFor(deviceId: string): Promise<EffectiveTimeouts | null> {
    const [row] = await this.db
      .select({
        dOff: device.offlineTimeoutS,
        dDead: device.deadTimeoutS,
        pOff: deviceProfile.offlineTimeoutS,
        pDead: deviceProfile.deadTimeoutS,
        sleepy: deviceProfile.sleepy,
      })
      .from(device)
      .innerJoin(deviceProfile, eq(device.profileId, deviceProfile.id))
      .where(eq(device.id, deviceId));
    if (!row) return null;
    return effectiveTimeouts(
      { offlineTimeoutS: row.dOff, deadTimeoutS: row.dDead },
      { offlineTimeoutS: row.pOff, deadTimeoutS: row.pDead, sleepy: row.sleepy },
    );
  }

  async toDtos(rows: DeviceRow[]): Promise<DeviceDto[]> {
    if (!rows.length) return [];
    const pipe = this.redis.pipeline();
    for (const r of rows) pipe.hgetall(LATEST_KEY(r.id));
    pipe.zmscore(PRESENCE_LAST_SEEN, ...rows.map((r) => r.id));
    pipe.mget(...rows.map((r) => locationKey(r.id)));
    const results = (await pipe.exec()) ?? [];
    const scores = (results[rows.length]?.[1] ?? []) as (string | null)[];
    const locations = (results[rows.length + 1]?.[1] ?? []) as (string | null)[];
    return rows.map((r, i) => {
      const hash = (results[i]?.[1] ?? {}) as Record<string, string>;
      const latest: Record<string, LatestValue> = {};
      for (const [k, v] of Object.entries(hash)) latest[k] = JSON.parse(v) as LatestValue;
      const score = scores[i];
      return {
        id: r.id,
        name: r.name,
        profileId: r.profileId,
        customerId: r.customerId,
        groupId: r.groupId,
        tags: r.tags,
        status: r.status,
        lastSeen: score ? Number(score) : (r.lastSeen?.getTime() ?? null),
        firmwareVersion: r.firmwareVersion,
        offlineTimeoutS: r.offlineTimeoutS,
        deadTimeoutS: r.deadTimeoutS,
        attributes: r.attributes,
        latest,
        location: locations[i] ? (JSON.parse(locations[i]!) as DeviceLocationDto) : r.location,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  private assertTimeouts(
    d: { offlineTimeoutS?: number | null; deadTimeoutS?: number | null },
    p: Pick<ProfileRow, 'offlineTimeoutS' | 'deadTimeoutS'>,
  ): void {
    const offline = d.offlineTimeoutS ?? p.offlineTimeoutS;
    const dead = d.deadTimeoutS ?? p.deadTimeoutS;
    if (dead <= offline) throw validation([{ path: ['deadTimeoutS'], message: 'Must be greater than offlineTimeoutS' }]);
  }

  private async resolveGroup(customerId: string | null, groupId: string | null): Promise<string | null> {
    if (!groupId) return null;
    if (!customerId) throw validation([{ path: ['groupId'], message: 'Unassigned devices cannot have a group' }]);
    await this.customers.getGroup(customerId, groupId);
    return groupId;
  }

  private emit(type: 'device.deleted' | 'device.credentials_changed', d: DeviceRow) {
    return this.events.publish({ type, deviceId: d.id, customerId: d.customerId, ts: Date.now() });
  }
}

