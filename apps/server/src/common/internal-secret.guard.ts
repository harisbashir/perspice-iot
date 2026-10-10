import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { CONFIG, type Config } from '../config/config';
import { unauthenticated } from './app-error';

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  canActivate(ctx: ExecutionContext): boolean {
    const header = ctx.switchToHttp().getRequest<Request>().headers['x-internal-secret'];
    if (typeof header === 'string' && safeEqual(header, this.config.INTERNAL_SECRET)) return true;
    throw unauthenticated('Invalid internal secret');
  }
}
