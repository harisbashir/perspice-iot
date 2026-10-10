import { Inject, Injectable } from '@nestjs/common';
import { CLAIM_ALPHABET, CLAIM_CODE_LENGTH, ClaimRequestSchema, type DeviceDto, ErrorCode, formatClaimCode } from '@perspice/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { createHash, randomInt } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types';
import { AppError, forbidden, notFound, validation } from '../common/app-error';
import { rateLimit } from '../common/rate-limit';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { device, deviceClaim } from '../db/schema';
import { DevicesService } from '../devices/devices.service';

const CLAIMS_PER_MIN = 10;
const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

/** A random claim code from the unambiguous alphabet (about 60 bits). */
export function newClaimCode(): string {
  let s = '';
  for (let i = 0; i < CLAIM_CODE_LENGTH; i++) s += CLAIM_ALPHABET[randomInt(CLAIM_ALPHABET.length)];
  return s;
}

/**
 * Claim codes (spec §11): an unassigned device gets a code (shown once, stored hashed) that a
 * customer admin enters to add the device to their customer. Single-use and rate-limited; every
 * failure looks the same.
 */
@Injectable()
export class ClaimService {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly devices: DevicesService,
  ) {}

  /** A new code for an unassigned device (replacing any earlier one). Returns it formatted. */
  async issue(deviceId: string): Promise<string> {
    const row = await this.db.query.device.findFirst({ where: eq(device.id, deviceId), columns: { customerId: true } });
    if (!row) throw notFound();
    if (row.customerId) throw validation([{ path: ['customerId'], message: 'Only unassigned devices can have a claim code' }]);
    const code = newClaimCode();
    await this.db
      .insert(deviceClaim)
      .values({ deviceId, codeHash: hashCode(code) })
      .onConflictDoUpdate({ target: deviceClaim.deviceId, set: { codeHash: hashCode(code), claimedAt: null, claimedBy: null, updatedAt: new Date() } });
    return formatClaimCode(code);
  }

  async claim(actor: AuthUser, body: unknown): Promise<DeviceDto> {
    const input = ClaimRequestSchema.parse(body);
    if (actor.scopeType !== 'customer' || !actor.customerId) throw forbidden('Devices are claimed by customer users');
    const { allowed, retryAfterS } = await rateLimit(this.redis, `claim:${actor.id}`, CLAIMS_PER_MIN, 60);
    if (!allowed) throw new AppError(ErrorCode.RATE_LIMITED, `Too many attempts; try again in ${retryAfterS} s`, 429);
    // Single use, and only while the device is unassigned (a concurrent claim loses here).
    const [won] = await this.db
      .update(deviceClaim)
      .set({ claimedAt: new Date(), claimedBy: actor.id, updatedAt: new Date() })
      .where(
        and(
          eq(deviceClaim.codeHash, hashCode(input.code)),
          isNull(deviceClaim.claimedAt),
          inArray(deviceClaim.deviceId, this.db.select({ id: device.id }).from(device).where(sql`${device.customerId} IS NULL`)),
        ),
      )
      .returning({ deviceId: deviceClaim.deviceId });
    if (!won) throw notFound('No unclaimed device has this code');
    return this.devices.assignClaimed(won.deviceId, actor.customerId, input.groupId ?? null, input.name);
  }
}
