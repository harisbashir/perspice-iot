import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { randomToken, sha256Hex } from '../common/crypto';
import { safeEqual } from '../common/internal-secret.guard';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { device } from '../db/schema';

const CACHE_TTL_S = 60;
export const devTokKey = (deviceId: string) => `devtok:${deviceId}`;
export const devTokIdxKey = (hash: string) => `devtokidx:${hash}`;

interface CachedCredential {
  hash: string;
  disabled: boolean;
}

@Injectable()
export class CredentialsService {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** A new device token: `pdt_` + 43 base64url chars. Only the SHA-256 is stored. */
  newToken(): { token: string; hash: string } {
    const token = randomToken('pdt_');
    return { token, hash: sha256Hex(token) };
  }

  /** True when `token` belongs to `deviceId` and the device is enabled. */
  async verifyToken(deviceId: string, token: string): Promise<boolean> {
    if (!token.startsWith('pdt_')) return false;
    const cred = await this.credential(deviceId);
    return !!cred && !cred.disabled && safeEqual(cred.hash, sha256Hex(token));
  }

  /** Resolves a device from its token alone (HTTP transport). Disabled devices resolve to null. */
  async findByToken(token: string): Promise<{ id: string } | null> {
    if (!token.startsWith('pdt_')) return null;
    const hash = sha256Hex(token);
    let id = await this.redis.get(devTokIdxKey(hash));
    if (!id) {
      const row = await this.db.query.device.findFirst({ where: eq(device.credentialsHash, hash), columns: { id: true } });
      if (!row) return null;
      id = row.id;
      await this.redis.set(devTokIdxKey(hash), id, 'EX', CACHE_TTL_S);
    }
    return (await this.verifyToken(id, token)) ? { id } : null;
  }

  /** Drops cached credentials after a token change, disable or delete. */
  async invalidate(deviceId: string, oldHash?: string): Promise<void> {
    await this.redis.del(devTokKey(deviceId), ...(oldHash ? [devTokIdxKey(oldHash)] : []));
  }

  private async credential(deviceId: string): Promise<CachedCredential | null> {
    if (!isUuid(deviceId)) return null;
    const cached = await this.redis.get(devTokKey(deviceId));
    if (cached) return cached === 'none' ? null : (JSON.parse(cached) as CachedCredential);
    const row = await this.db.query.device.findFirst({
      where: eq(device.id, deviceId),
      columns: { credentialsHash: true, disabled: true },
    });
    const cred = row ? { hash: row.credentialsHash, disabled: row.disabled } : null;
    await this.redis.set(devTokKey(deviceId), cred ? JSON.stringify(cred) : 'none', 'EX', CACHE_TTL_S);
    return cred;
  }
}
