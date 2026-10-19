import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  KEY_PATTERN,
  type ProvisionResponse,
  type ProvisioningKeyDto,
  type ProvisioningKeyInput,
  ProvisionRequestSchema,
  formatClaimCode,
} from '@perspice/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { AppError, conflict, forbidden, notFound, validation } from '../common/app-error';
import { randomToken, sha256Hex } from '../common/crypto';
import { REDIS } from '../common/redis.module';
import { CONFIG, type Config } from '../config/config';
import { CustomersService } from '../customers/customers.service';
import { ensureDeviceDashboard } from '../dashboards/assignment';
import { DB } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { isUuid } from '../db/scoped-repo';
import { device, deviceClaim, deviceProfile, provisioningKey } from '../db/schema';
import { CredentialsService } from '../devices/credentials.service';
import { DevicesService } from '../devices/devices.service';
import { hashClaimCode, newClaimCode } from './claim.service';

type KeyRow = typeof provisioningKey.$inferSelect;

/** Failed attempts allowed per address and minute; successful ones aren't limited (a factory behind one address). */
const FAILURES_PER_MIN = 30;
const MAX_ATTRIBUTES_BYTES = 16 * 1024;

const toDto = (k: KeyRow): ProvisioningKeyDto => ({
  id: k.id,
  profileId: k.profileId,
  name: k.name,
  mode: k.mode,
  customerId: k.customerId,
  groupId: k.groupId,
  tags: k.tags,
  issueClaimCodes: k.issueClaimCodes,
  allowReprovision: k.allowReprovision,
  maxDevices: k.maxDevices,
  provisionedCount: k.provisionedCount,
  expiresAt: k.expiresAt?.getTime() ?? null,
  revokedAt: k.revokedAt?.getTime() ?? null,
  lastUsedAt: k.lastUsedAt?.getTime() ?? null,
  createdAt: k.createdAt.getTime(),
});

/** Every refusal of the key itself looks the same, so a guess learns nothing. */
const badKey = () => new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid provisioning key', 401);

/**
 * Fleet provisioning: one secret per profile, built into the firmware, lets each unit fetch its
 * own device id and token on first boot (identified by its serial), so no per-device credentials
 * are flashed or typed in. The credentials live in the device's storage and survive OTA updates.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CONFIG) private readonly config: Config,
    private readonly devices: DevicesService,
    private readonly credentials: CredentialsService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
  ) {}

  // ── Keys (platform users) ──────────────────────────────────────────────────────────────

  async listKeys(actor: AuthUser, profileId: string): Promise<ProvisioningKeyDto[]> {
    await this.profile(actor, profileId);
    const rows = await this.db.select().from(provisioningKey).where(eq(provisioningKey.profileId, profileId)).orderBy(desc(provisioningKey.createdAt));
    return rows.map(toDto);
  }

  async createKey(actor: AuthUser, profileId: string, input: ProvisioningKeyInput): Promise<ProvisioningKeyDto & { secret: string }> {
    const profile = await this.profile(actor, profileId);
    if (profile.transport === 'aws-iot') {
      throw validation([{ path: ['profileId'], message: 'AWS IoT Core devices use certificates; use AWS IoT fleet provisioning' }]);
    }
    if (input.expiresAt !== null && input.expiresAt <= Date.now()) throw validation([{ path: ['expiresAt'], message: 'Must be in the future' }]);
    if (input.groupId && !input.customerId) throw validation([{ path: ['groupId'], message: 'A group needs a customer' }]);
    if (input.customerId) await this.customers.get(input.customerId);
    if (input.groupId) await this.customers.getGroup(input.customerId!, input.groupId);
    if (input.issueClaimCodes && input.customerId) {
      throw validation([{ path: ['issueClaimCodes'], message: 'Claim codes are for unassigned devices; leave the customer empty' }]);
    }
    const secret = randomToken('pps_');
    const [row] = await this.db
      .insert(provisioningKey)
      .values({
        profileId,
        name: input.name,
        secretHash: sha256Hex(secret),
        mode: input.mode,
        customerId: input.customerId,
        groupId: input.groupId,
        tags: [...new Set(input.tags)],
        issueClaimCodes: input.issueClaimCodes,
        allowReprovision: input.allowReprovision,
        maxDevices: input.maxDevices,
        expiresAt: input.expiresAt !== null ? new Date(input.expiresAt) : null,
        createdBy: actor.kind === 'user' ? actor.id : null,
      })
      .returning();
    return { ...toDto(row!), secret };
  }

  /** Revoking keeps the key's record (and its devices); it just stops working. */
  async revokeKey(actor: AuthUser, id: string): Promise<void> {
    if (actor.scopeType !== 'platform') throw forbidden();
    if (!isUuid(id)) throw notFound();
    const [row] = await this.db
      .update(provisioningKey)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(provisioningKey.id, id), isNull(provisioningKey.revokedAt)))
      .returning({ id: provisioningKey.id });
    if (!row && !(await this.db.query.provisioningKey.findFirst({ where: eq(provisioningKey.id, id), columns: { id: true } }))) throw notFound();
  }

  private async profile(actor: AuthUser, profileId: string) {
    if (actor.scopeType !== 'platform') throw forbidden('Provisioning keys are managed by the platform');
    if (!isUuid(profileId)) throw notFound();
    const p = await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, profileId) });
    if (!p) throw notFound();
    return p;
  }

  // ── The device side ────────────────────────────────────────────────────────────────────

  async provision(body: unknown, ip: string): Promise<ProvisionResponse> {
    const failKey = `provfail:${ip}`;
    if (Number(await this.redis.get(failKey)) >= FAILURES_PER_MIN) {
      throw new AppError(ErrorCode.RATE_LIMITED, 'Too many failed attempts; try again in a minute', 429);
    }
    try {
      return await this.provisionOnce(body, ip);
    } catch (err) {
      if (err instanceof AppError && err.status >= 400 && err.status < 500) {
        await this.redis.multi().incr(failKey).expire(failKey, 60, 'NX').exec();
      }
      throw err;
    }
  }

  private async provisionOnce(body: unknown, ip: string): Promise<ProvisionResponse> {
    const input = ProvisionRequestSchema.parse(body);
    const key = await this.db.query.provisioningKey.findFirst({ where: eq(provisioningKey.secretHash, sha256Hex(input.key)) });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) throw badKey();
    const profile = await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, key.profileId) });
    if (!profile) throw badKey();
    const attrs = this.attributes(input.attributes);

    const existing = await this.db.query.device.findFirst({ where: and(eq(device.profileId, key.profileId), eq(device.serial, input.serial)) });
    let deviceId: string;
    let token: string;
    let customerId: string | null;
    let created = false;
    if (existing) {
      // Registered beforehand and never provisioned: hand it its own token. Already provisioned:
      // only when the key allows it, as whoever holds the key could otherwise take the identity over.
      if (existing.provisionedAt && !key.allowReprovision) throw conflict('This device already has its credentials');
      token = await this.devices.replaceToken(existing, { provisionedAt: new Date(), ...this.attributeSet(attrs) });
      deviceId = existing.id;
      customerId = existing.customerId;
    } else {
      if (key.mode === 'preregistered') throw forbidden('This serial is not registered');
      const [counted] = await this.db
        .update(provisioningKey)
        .set({ provisionedCount: sql`${provisioningKey.provisionedCount} + 1` })
        .where(and(eq(provisioningKey.id, key.id), sql`(${provisioningKey.maxDevices} IS NULL OR ${provisioningKey.provisionedCount} < ${provisioningKey.maxDevices})`))
        .returning({ id: provisioningKey.id });
      if (!counted) throw forbidden('This provisioning key has reached its device limit');
      const fresh = this.credentials.newToken();
      try {
        const [row] = await this.db
          .insert(device)
          .values({
            name: input.name ?? `${profile.name} ${input.serial}`,
            profileId: profile.id,
            customerId: key.customerId,
            groupId: key.groupId,
            tags: key.tags,
            serial: input.serial,
            provisionedAt: new Date(),
            credentialsHash: fresh.hash,
            firmwareVersion: typeof attrs.fw === 'string' ? attrs.fw.slice(0, 64) : null,
            attributes: { client: attrs, server: {}, shared: {} },
          })
          .returning();
        deviceId = row!.id;
      } catch (err) {
        // A twin request created it a moment ago.
        await this.db.update(provisioningKey).set({ provisionedCount: sql`${provisioningKey.provisionedCount} - 1` }).where(eq(provisioningKey.id, key.id));
        if (isUniqueViolation(err)) throw conflict('This device already has its credentials');
        throw err;
      }
      token = fresh.token;
      customerId = key.customerId;
      created = true;
      await ensureDeviceDashboard(this.db, profile.id, key.customerId);
    }

    let claimCode: string | null = null;
    if (created && key.issueClaimCodes && !customerId) {
      const code = newClaimCode();
      await this.db.insert(deviceClaim).values({ deviceId, codeHash: hashClaimCode(code) });
      claimCode = formatClaimCode(code);
    }
    await this.db.update(provisioningKey).set({ lastUsedAt: new Date() }).where(eq(provisioningKey.id, key.id));
    await this.audit.record({
      actorType: 'device',
      actorId: deviceId,
      customerId,
      action: 'device.provision',
      targetType: 'device',
      targetId: deviceId,
      diff: { serial: input.serial, provisioningKey: key.name, created },
      ip,
    });
    return { deviceId, token, mqtt: { host: `mqtt.${this.config.BASE_DOMAIN}`, port: 8883, tls: true }, claimCode };
  }

  private attributes(raw: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!raw) return {};
    if (!Object.keys(raw).every((k) => KEY_PATTERN.test(k))) throw validation([{ path: ['attributes'], message: 'Invalid attribute name' }]);
    if (JSON.stringify(raw).length > MAX_ATTRIBUTES_BYTES) throw validation([{ path: ['attributes'], message: 'Attributes are too large' }]);
    return raw;
  }

  private attributeSet(attrs: Record<string, unknown>): Partial<typeof device.$inferInsert> {
    if (!Object.keys(attrs).length) return {};
    const fw = typeof attrs.fw === 'string' ? attrs.fw.slice(0, 64) : undefined;
    return {
      attributes: sql`jsonb_set(${device.attributes}, '{client}', coalesce(${device.attributes}->'client', '{}'::jsonb) || ${JSON.stringify(attrs)}::jsonb)` as never,
      ...(fw ? { firmwareVersion: fw } : {}),
    };
  }
}
