import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ErrorCode } from '@perspice/shared';
import type { CookieOptions, Request, Response } from 'express';
import type Redis from 'ioredis';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { rateLimit } from '../common/rate-limit';
import { REDIS } from '../common/redis.module';
import { CONFIG, type Config } from '../config/config';
import { AuthService, type LoginResult, type RequestMeta } from './auth.service';
import type { AuthUser } from './auth.types';
import { AllowWithoutTotp, CurrentUser, Public } from './decorators';
import { REFRESH_TTL_MS, SessionService } from './session.service';

export const REFRESH_COOKIE = 'pr_refresh';

const LoginBody = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
const EmailBody = z.object({ email: z.string().trim().email().max(254) });
const TokenPasswordBody = z.object({
  token: z.string().min(1).max(256),
  password: z.string().max(1024),
  name: z.string().trim().min(1).max(200).optional(),
});
const CodeBody = z.object({ code: z.string().regex(/^\d{6}$/) });
const ChangePasswordBody = z.object({ currentPassword: z.string().min(1).max(1024), newPassword: z.string().max(1024) });

@Controller('auth')
@AllowWithoutTotp()
export class AuthController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(@Body() raw: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.limit('login', req);
    const body = LoginBody.parse(raw);
    return this.respond(res, await this.auth.login(body.email, body.password, body.totp, this.meta(req)));
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.cookie(req);
    if (!token) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Session expired', 401);
    try {
      return this.respond(res, await this.auth.refresh(token, this.meta(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw err;
    }
  }

  /** Public so a client with an expired access token can still end its session. */
  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.cookie(req);
    const userId = token ? await this.sessions.revokeByToken(token) : null;
    if (userId) {
      const u = await this.auth.me(userId);
      await this.auth.auditAuth('auth.logout', { id: u.id, customerId: u.customerId }, { ip: req.ip });
    }
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @Post('forgot')
  @Public()
  @HttpCode(202)
  async forgot(@Body() raw: unknown, @Req() req: Request) {
    await this.limit('forgot', req);
    const { email } = EmailBody.parse(raw);
    await this.auth.forgot(email, req.tenantHost ?? { kind: 'unknown' });
    return {};
  }

  @Post('reset')
  @Public()
  @HttpCode(200)
  async reset(@Body() raw: unknown, @Req() req: Request) {
    const body = TokenPasswordBody.parse(raw);
    await this.auth.reset(body.token, body.password, { ip: req.ip });
    return {};
  }

  @Post('activate')
  @Public()
  @HttpCode(200)
  async activate(@Body() raw: unknown) {
    const body = TokenPasswordBody.parse(raw);
    await this.auth.activate(body.token, body.password, body.name);
    return {};
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() raw: unknown, @Req() req: Request) {
    const body = ChangePasswordBody.parse(raw);
    await this.auth.changePassword(user, body.currentPassword, body.newPassword, { ip: req.ip });
  }

  @Post('totp/setup')
  @HttpCode(200)
  totpSetup(@CurrentUser() user: AuthUser) {
    return this.auth.totpSetup(user);
  }

  @Post('totp/enable')
  @HttpCode(200)
  async totpEnable(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    await this.auth.totpEnable(user, CodeBody.parse(raw).code);
    return this.auth.me(user.id);
  }

  @Post('totp/disable')
  @HttpCode(200)
  async totpDisable(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    await this.auth.totpDisable(user, CodeBody.parse(raw).code);
    return this.auth.me(user.id);
  }

  private respond(res: Response, result: LoginResult) {
    res.cookie(REFRESH_COOKIE, result.refreshToken, { ...this.cookieOptions(), maxAge: REFRESH_TTL_MS });
    return { accessToken: result.accessToken, user: result.user };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.PUBLIC_URL.startsWith('https:'),
      sameSite: 'lax',
      path: '/api/auth',
    };
  }

  private cookie(req: Request): string | undefined {
    const value = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    return typeof value === 'string' && value ? value : undefined;
  }

  private meta(req: Request): RequestMeta {
    return { host: req.tenantHost ?? { kind: 'unknown' }, ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  private async limit(route: string, req: Request): Promise<void> {
    const { allowed, retryAfterS } = await rateLimit(
      this.redis,
      `${route}:${req.ip ?? 'unknown'}`,
      this.config.AUTH_RATE_LIMIT_PER_MIN,
      60,
    );
    if (!allowed) {
      throw new AppError(ErrorCode.RATE_LIMITED, 'Too many requests', 429, { retryAfterSeconds: retryAfterS });
    }
  }
}
