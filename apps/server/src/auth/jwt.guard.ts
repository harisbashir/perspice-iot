import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@perspice/shared';
import type { Request } from 'express';
import { AppError, unauthenticated } from '../common/app-error';
import { SettingsService } from '../settings/settings.service';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { ALLOW_WITHOUT_TOTP_KEY, PUBLIC_KEY } from './decorators';
import { SessionService } from './session.service';

const SETTING_CACHE_MS = 30_000;

/** Global guard: authenticates a Bearer access token or `pk_` API key unless the route is @Public(). */
@Injectable()
export class JwtGuard implements CanActivate {
  private enforceTotp: { value: boolean; at: number } | undefined;

  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const user = await this.authenticate(req.headers.authorization);
    if (!user) throw unauthenticated();

    if (
      user.kind === 'user' &&
      user.roleKey === 'super_admin' &&
      !user.totpEnabled &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_TOTP_KEY, targets) &&
      (await this.totpEnforced())
    ) {
      throw new AppError(ErrorCode.TOTP_REQUIRED, 'Enrol two-factor authentication to continue', 403, {
        setup: true,
      });
    }

    req.user = user;
    return true;
  }

  private async authenticate(header: string | undefined): Promise<AuthUser | null> {
    const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
    if (!match) return null;
    const token = match[1]!;
    if (token.startsWith('pk_')) return this.auth.authUserForApiKey(token);
    const claims = await this.sessions.verifyAccess(token);
    return claims ? this.auth.authUserForSession(claims.sub, claims.sid) : null;
  }

  private async totpEnforced(): Promise<boolean> {
    if (!this.enforceTotp || Date.now() - this.enforceTotp.at > SETTING_CACHE_MS) {
      const value = (await this.settings.get('auth.enforceTotpForSuperAdmin')) ?? true;
      this.enforceTotp = { value, at: Date.now() };
    }
    return this.enforceTotp.value;
  }
}
