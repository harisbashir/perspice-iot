import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type Redis from 'ioredis';
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { randomToken, sha256Hex } from '../common/crypto';
import { REDIS } from '../common/redis.module';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { session } from '../db/schema';

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccessClaims {
  sub: string;
  sid: string;
  scope: 'platform' | 'customer';
  cid: string | null;
}

const revokedKey = (sid: string) => `revoked:sid:${sid}`;

@Injectable()
export class SessionService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  async signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ sid: claims.sid, scope: claims.scope, cid: claims.cid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TTL_S)
      .sign(this.key);
  }

  /** Returns the claims, or null if the token is invalid, expired or its session was revoked. */
  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        currentDate: new Date(),
      });
      const claims = {
        sub: String(payload.sub),
        sid: String(payload.sid),
        scope: payload.scope as AccessClaims['scope'],
        cid: (payload.cid as string | null) ?? null,
      };
      if (await this.redis.exists(revokedKey(claims.sid))) return null;
      return claims;
    } catch {
      return null;
    }
  }

  async create(
    userId: string,
    meta: { userAgent?: string; ip?: string },
    familyId: string = randomUUID(),
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const refreshToken = randomToken('');
    const [row] = await this.db
      .insert(session)
      .values({
        userId,
        familyId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        userAgent: meta.userAgent?.slice(0, 512),
        ip: meta.ip,
      })
      .returning({ id: session.id });
    return { sessionId: row!.id, refreshToken };
  }

  /**
   * Exchanges a refresh token for a new one in the same family. Presenting a token that was
   * already rotated or revoked is treated as theft: the whole family is revoked.
   */
  async rotate(
    refreshToken: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<{ userId: string; sessionId: string; refreshToken: string } | null> {
    const row = await this.db.query.session.findFirst({ where: eq(session.tokenHash, sha256Hex(refreshToken)) });
    if (!row) return null;
    if (row.revokedAt || row.replacedById) {
      await this.revokeFamily(row.familyId);
      return null;
    }
    if (row.expiresAt.getTime() <= Date.now()) return null;

    const next = await this.create(row.userId, meta, row.familyId);
    const [claimed] = await this.db
      .update(session)
      .set({ revokedAt: new Date(), replacedById: next.sessionId })
      .where(and(eq(session.id, row.id), isNull(session.revokedAt)))
      .returning({ id: session.id });
    if (!claimed) {
      // A concurrent request rotated the same token first: treat as reuse.
      await this.revokeFamily(row.familyId);
      return null;
    }
    return { userId: row.userId, ...next };
  }

  /** Returns the session's user id, if the token matched a session. */
  async revokeByToken(refreshToken: string): Promise<string | null> {
    const row = await this.db.query.session.findFirst({ where: eq(session.tokenHash, sha256Hex(refreshToken)) });
    if (!row) return null;
    await this.revokeFamily(row.familyId);
    return row.userId;
  }

  async revoke(sessionId: string): Promise<void> {
    const row = await this.db.query.session.findFirst({ where: eq(session.id, sessionId) });
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    const rows = await this.db
      .update(session)
      .set({ revokedAt: new Date() })
      .where(and(eq(session.familyId, familyId), isNull(session.revokedAt)))
      .returning({ id: session.id });
    await this.markRevoked(rows.map((r) => r.id));
    // Sessions already rotated out still map to live access tokens until they expire.
    const all = await this.db.query.session.findMany({ where: eq(session.familyId, familyId), columns: { id: true } });
    await this.markRevoked(all.map((r) => r.id));
  }

  /** Revokes every session of the user, except the family of `keepSessionId` when given. */
  async revokeAllForUser(userId: string, keepSessionId?: string | null): Promise<void> {
    const keep = keepSessionId
      ? (await this.db.query.session.findFirst({ where: eq(session.id, keepSessionId), columns: { familyId: true } }))?.familyId
      : undefined;
    const notKept = keep ? ne(session.familyId, keep) : undefined;
    await this.db
      .update(session)
      .set({ revokedAt: new Date() })
      .where(and(eq(session.userId, userId), isNull(session.revokedAt), notKept));
    const all = await this.db.query.session.findMany({
      where: and(eq(session.userId, userId), notKept),
      columns: { id: true },
    });
    await this.markRevoked(all.map((r) => r.id));
  }

  /** Access tokens are stateless; a short-lived deny-list makes revocation immediate. */
  private async markRevoked(sessionIds: string[]): Promise<void> {
    if (!sessionIds.length) return;
    const multi = this.redis.multi();
    for (const id of sessionIds) multi.set(revokedKey(id), '1', 'EX', ACCESS_TTL_S + 60);
    await multi.exec();
  }
}
