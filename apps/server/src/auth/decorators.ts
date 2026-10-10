import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth.types';

export const PUBLIC_KEY = 'perspice:public';
export const ALLOW_WITHOUT_TOTP_KEY = 'perspice:allowWithoutTotp';

/** Skips authentication for a handler or controller. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Lets a super admin who has not enrolled TOTP yet reach this handler. */
export const AllowWithoutTotp = () => SetMetadata(ALLOW_WITHOUT_TOTP_KEY, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) throw new Error('CurrentUser used on a public route');
  return user;
});
