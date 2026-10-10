import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ErrorCode, MAX_PAYLOAD_BYTES } from '@perspice/shared';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { AppError, unauthenticated } from '../common/app-error';
import { rateLimit } from '../common/rate-limit';
import { REDIS } from '../common/redis.module';
import { CredentialsService } from '../devices/credentials.service';

export const DEVICE_RATE_LIMIT_PER_MIN = 60;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      deviceId?: string;
    }
  }
}

/** Authenticates `X-Device-Token`, enforces the 64 KB body cap and 60 req/min per device. */
@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly credentials: CredentialsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    if (Number(req.headers['content-length'] ?? 0) > MAX_PAYLOAD_BYTES) {
      throw new AppError(ErrorCode.VALIDATION, 'Payload too large', 413, { maxBytes: MAX_PAYLOAD_BYTES });
    }
    const token = req.headers['x-device-token'];
    const found = typeof token === 'string' ? await this.credentials.findByToken(token) : null;
    if (!found) throw unauthenticated('Invalid device token');

    const { allowed, retryAfterS } = await rateLimit(this.redis, `device:${found.id}`, DEVICE_RATE_LIMIT_PER_MIN, 60);
    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfterS));
      throw new AppError(ErrorCode.RATE_LIMITED, 'Too many requests', 429, { retryAfterSeconds: retryAfterS });
    }
    req.deviceId = found.id;
    return true;
  }
}
