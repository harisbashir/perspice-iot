import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type MeResponse, type Permission } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { AppError, conflict, unauthenticated, validation } from '../common/app-error';
import { sha256Hex } from '../common/crypto';
import { REDIS } from '../common/redis.module';
import { AuditService } from '../audit/audit.service';
import { BrandingService } from '../branding/branding.service';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { apiKey, customer, role, user } from '../db/schema';
import { EmailService } from '../email/email.service';
import type { AuthUser, TenantHost } from './auth.types';
import { LockoutService } from './lockout.service';
import { assertPasswordPolicy, hashPassword, verifyDummy, verifyPassword } from './password';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

const PERM_CACHE_TTL_S = 60;
export const permCacheKey = (roleId: string) => `perm:${roleId}`;

export const invalidCredentials = () =>
  new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password', 401);

type UserRow = typeof user.$inferSelect;

export interface RequestMeta {
  host: TenantHost;
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: MeResponse;
}

/** Whether a user may authenticate on the host they are using (Review Focus 5). */
export function userMatchesHost(u: Pick<UserRow, 'scopeType' | 'customerId'>, host: TenantHost): boolean {
  if (host.kind === 'platform') return u.scopeType === 'platform';
  if (host.kind === 'customer') return u.scopeType === 'customer' && u.customerId === host.customerId;
  return false;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly sessions: SessionService,
    private readonly lockout: LockoutService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly email: EmailService,
    private readonly branding: BrandingService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, totpCode: string | undefined, meta: RequestMeta): Promise<LoginResult> {
    const u = await this.findByEmail(email);
    if (!u || !u.passwordHash || u.status !== 'active' || !userMatchesHost(u, meta.host)) {
      await verifyDummy(password);
      await this.auditAuth('auth.login_failed', u ?? null, meta, { email: email.trim().toLowerCase() });
      throw invalidCredentials();
    }

    await this.assertNotLocked(u.id);
    if (!(await verifyPassword(u.passwordHash, password))) {
      await this.failLogin(u, meta, 'password');
    }
    if (u.totpEnabled) {
      if (!totpCode) throw new AppError(ErrorCode.TOTP_REQUIRED, 'Two-factor code required', 401);
      if (!this.totp.verify(u.totpSecret, totpCode)) await this.failLogin(u, meta, 'totp');
    }

    await this.lockout.reset(u.id);
    await this.db.update(user).set({ lastLogin: new Date() }).where(eq(user.id, u.id));
    const { sessionId, refreshToken } = await this.sessions.create(u.id, meta);
    await this.auditAuth('auth.login', u, meta);
    return {
      accessToken: await this.sessions.signAccess({
        sub: u.id,
        sid: sessionId,
        scope: u.scopeType,
        cid: u.customerId,
      }),
      refreshToken,
      user: await this.me(u.id),
    };
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<LoginResult> {
    const rotated = await this.sessions.rotate(refreshToken, meta);
    if (!rotated) throw unauthenticated('Session expired');
    const u = await this.db.query.user.findFirst({ where: eq(user.id, rotated.userId) });
    if (!u || u.status !== 'active') {
      await this.sessions.revoke(rotated.sessionId);
      throw unauthenticated('Session expired');
    }
    return {
      accessToken: await this.sessions.signAccess({
        sub: u.id,
        sid: rotated.sessionId,
        scope: u.scopeType,
        cid: u.customerId,
      }),
      refreshToken: rotated.refreshToken,
      user: await this.me(u.id),
    };
  }

  /** Always resolves the same way whether or not the email exists (spec §6.3). */
  async forgot(email: string, host: TenantHost): Promise<void> {
    const u = await this.findByEmail(email);
    if (!u || u.status !== 'active' || !userMatchesHost(u, host)) return;
    const token = await this.tokens.issue(u.id, 'reset');
    const slug = host.kind === 'customer' ? host.slug : null;
    await this.email.send(
      'password_reset',
      u.email,
      { name: u.name, link: `${this.publicUrlFor(slug)}/reset?token=${token}` },
      { customerId: u.customerId },
    );
  }

  async reset(token: string, password: string, meta: { ip?: string } = {}): Promise<void> {
    assertPasswordPolicy(password);
    const userId = await this.tokens.consume(token, 'reset');
    const [u] = await this.db
      .update(user)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(user.id, userId))
      .returning();
    await this.sessions.revokeAllForUser(userId);
    await this.lockout.reset(userId);
    await this.auditAuth('auth.password_reset', u!, meta);
    await this.email.send('password_changed', u!.email, { name: u!.name }, { customerId: u!.customerId });
  }

  async activate(token: string, password: string, name?: string): Promise<void> {
    assertPasswordPolicy(password);
    const userId = await this.tokens.consume(token, 'invite');
    await this.db
      .update(user)
      .set({ passwordHash: await hashPassword(password), status: 'active', ...(name ? { name } : {}) })
      .where(eq(user.id, userId));
  }

  /** Changes the caller's password and signs out every other session. */
  async changePassword(u: AuthUser, current: string, next: string, meta: { ip?: string }): Promise<void> {
    const row = await this.db.query.user.findFirst({ where: eq(user.id, u.id) });
    if (!row?.passwordHash || !(await verifyPassword(row.passwordHash, current))) {
      throw validation([{ path: ['currentPassword'], message: 'Current password is incorrect' }], 'Current password is incorrect');
    }
    assertPasswordPolicy(next);
    await this.db.update(user).set({ passwordHash: await hashPassword(next) }).where(eq(user.id, u.id));
    await this.sessions.revokeAllForUser(u.id, u.sessionId);
    await this.auditAuth('auth.password_change', row, meta);
    await this.email.send('password_changed', row.email, { name: row.name }, { customerId: row.customerId });
  }

  async totpSetup(u: AuthUser): Promise<{ otpauthUrl: string; secret: string }> {
    if (u.totpEnabled) throw conflict('Two-factor authentication is already enabled');
    const { productName } = await this.branding.resolve(u.customerId);
    const { secret, otpauthUrl, encrypted } = this.totp.generate(productName, u.email);
    await this.db.update(user).set({ totpSecret: encrypted }).where(eq(user.id, u.id));
    return { otpauthUrl, secret };
  }

  async totpEnable(u: AuthUser, code: string): Promise<void> {
    const row = await this.db.query.user.findFirst({ where: eq(user.id, u.id) });
    if (row?.totpEnabled) throw conflict('Two-factor authentication is already enabled');
    if (!this.totp.verify(row?.totpSecret ?? null, code)) throw this.invalidCode();
    await this.db.update(user).set({ totpEnabled: true }).where(eq(user.id, u.id));
  }

  async totpDisable(u: AuthUser, code: string): Promise<void> {
    const row = await this.db.query.user.findFirst({ where: eq(user.id, u.id) });
    if (!row?.totpEnabled || !this.totp.verify(row.totpSecret, code)) throw this.invalidCode();
    await this.db.update(user).set({ totpEnabled: false, totpSecret: null }).where(eq(user.id, u.id));
  }

  async me(userId: string): Promise<MeResponse> {
    const u = await this.db.query.user.findFirst({ where: eq(user.id, userId) });
    if (!u) throw unauthenticated();
    const r = await this.roleInfo(u.roleId);
    const c = u.customerId
      ? await this.db.query.customer.findFirst({ where: eq(customer.id, u.customerId), columns: { slug: true } })
      : undefined;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      scopeType: u.scopeType,
      customerId: u.customerId,
      customerSlug: c?.slug ?? null,
      groupId: u.groupId,
      roleId: u.roleId,
      roleKey: r.key,
      permissions: r.permissions,
      totpEnabled: u.totpEnabled,
    };
  }

  /** Builds the request principal for a JWT subject; null if the user cannot act. */
  async authUserForSession(userId: string, sessionId: string): Promise<AuthUser | null> {
    const u = await this.db.query.user.findFirst({ where: eq(user.id, userId) });
    if (!u || u.status !== 'active') return null;
    const r = await this.roleInfo(u.roleId);
    return this.toAuthUser(u, r, { kind: 'user', apiKeyId: null, sessionId });
  }

  /** API keys act with their own permissions, capped at the creator's current permissions. */
  async authUserForApiKey(rawKey: string): Promise<AuthUser | null> {
    const key = await this.db.query.apiKey.findFirst({ where: eq(apiKey.keyHash, sha256Hex(rawKey)) });
    if (!key || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) return null;
    const creator = await this.db.query.user.findFirst({ where: eq(user.id, key.createdBy) });
    if (!creator || creator.status !== 'active') return null;
    const r = await this.roleInfo(creator.roleId);
    const held = new Set(r.permissions);
    if (!key.lastUsed || Date.now() - key.lastUsed.getTime() > 60_000) {
      await this.db.update(apiKey).set({ lastUsed: new Date() }).where(eq(apiKey.id, key.id));
    }
    return {
      ...this.toAuthUser(creator, r, { kind: 'apikey', apiKeyId: key.id, sessionId: null }),
      scopeType: key.scopeType,
      customerId: key.customerId,
      groupId: key.groupId,
      permissions: key.permissions.filter((p) => held.has(p)),
    };
  }

  async roleInfo(roleId: string): Promise<{ key: string | null; permissions: Permission[] }> {
    const cached = await this.redis.get(permCacheKey(roleId));
    if (cached) return JSON.parse(cached) as { key: string | null; permissions: Permission[] };
    const r = await this.db.query.role.findFirst({ where: eq(role.id, roleId) });
    const info = { key: r?.key ?? null, permissions: r?.permissions ?? [] };
    await this.redis.set(permCacheKey(roleId), JSON.stringify(info), 'EX', PERM_CACHE_TTL_S);
    return info;
  }

  /** Base URL for links sent to a user: the customer subdomain for customer users. */
  publicUrlFor(customerSlug: string | null): string {
    const url = new URL(this.config.PUBLIC_URL);
    if (customerSlug) url.hostname = `${customerSlug}.${this.config.BASE_DOMAIN}`;
    return url.origin;
  }

  private toAuthUser(
    u: UserRow,
    r: { key: string | null; permissions: Permission[] },
    extra: Pick<AuthUser, 'kind' | 'apiKeyId' | 'sessionId'>,
  ): AuthUser {
    return {
      ...extra,
      id: u.id,
      email: u.email,
      name: u.name,
      scopeType: u.scopeType,
      customerId: u.customerId,
      groupId: u.groupId,
      roleId: u.roleId,
      roleKey: r.key,
      permissions: r.permissions,
      totpEnabled: u.totpEnabled,
    };
  }

  private findByEmail(email: string) {
    return this.db.query.user.findFirst({ where: eq(user.email, email.trim().toLowerCase()) });
  }

  private async assertNotLocked(userId: string): Promise<void> {
    const until = await this.lockout.lockedUntil(userId);
    if (until) throw this.locked(until);
  }

  private async failLogin(u: UserRow, meta: RequestMeta, reason: 'password' | 'totp'): Promise<never> {
    const until = await this.lockout.registerFailure(u.id);
    await this.auditAuth('auth.login_failed', u, meta, { reason, locked: until !== null });
    if (until) throw this.locked(until);
    throw invalidCredentials();
  }

  async auditAuth(
    action: string,
    u: Pick<UserRow, 'id' | 'customerId'> | null,
    meta: { ip?: string },
    diff?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      actorType: 'user',
      actorId: u?.id ?? null,
      customerId: u?.customerId ?? null,
      action,
      targetType: 'user',
      targetId: u?.id ?? null,
      diff,
      ip: meta.ip,
    });
  }

  private locked(until: Date) {
    return new AppError(ErrorCode.ACCOUNT_LOCKED, 'Account temporarily locked', 423, {
      retryAfterSeconds: Math.ceil((until.getTime() - Date.now()) / 1000),
    });
  }

  private invalidCode() {
    return validation([{ path: ['code'], message: 'Invalid code' }], 'Invalid two-factor code');
  }
}
