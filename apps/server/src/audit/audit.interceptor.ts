import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type Observable, mergeMap } from 'rxjs';
import { AuditService } from './audit.service';
import { AUDITED_KEY, type AuditedMeta } from './audited.decorator';
import { redact } from './redact';

const field = (value: unknown, key: string): string | null => {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' ? v : null;
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditedMeta | undefined>(AUDITED_KEY, ctx.getHandler());
    if (!meta || ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      mergeMap(async (result: unknown) => {
        const user = req.user;
        // Create endpoints may return `{ device, token }`; audit the entity, never the secret.
        const target =
          result && typeof result === 'object' && 'device' in result ? (result as { device: unknown }).device : result;
        await this.audit.record({
          actorType: user?.kind === 'apikey' ? 'apikey' : user ? 'user' : 'system',
          actorId: user?.kind === 'apikey' ? user.apiKeyId : (user?.id ?? null),
          customerId: field(target, 'customerId') ?? user?.customerId ?? null,
          action: meta.action,
          targetType: meta.targetType,
          targetId: this.targetId(meta, target, req.params as Record<string, string | undefined>),
          diff: req.body && Object.keys(req.body as object).length ? redact(req.body) : null,
          ip: req.ip,
        });
        return result;
      }),
    );
  }

  private targetId(meta: AuditedMeta, target: unknown, params: Record<string, string | undefined>): string | null {
    return meta.targetIdFrom === 'param'
      ? (params.id ?? field(target, 'id'))
      : (field(target, 'id') ?? params.id ?? null);
  }
}
