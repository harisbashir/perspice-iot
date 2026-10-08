import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@perspice/shared';
import type { Request } from 'express';
import { forbidden, unauthenticated } from '../common/app-error';
import { PERMISSIONS_KEY } from './require.decorator';

/** Enforces @Require(...). Registered after JwtGuard so `req.user` is populated. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user) throw unauthenticated();
    const held = new Set(user.permissions);
    if (!required.every((p) => held.has(p))) throw forbidden('Missing permission');
    return true;
  }
}
