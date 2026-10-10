import { SetMetadata } from '@nestjs/common';

export const AUDITED_KEY = 'perspice:audited';

export interface AuditedMeta {
  action: string;
  targetType: string;
  /** Where the target id comes from: the response's `id` (default) or the `:id` route param. */
  targetIdFrom: 'result' | 'param';
}

/** Records an audit entry after the handler succeeds (see AuditInterceptor). */
export const Audited = (action: string, targetType: string, opts: { targetIdFrom?: 'result' | 'param' } = {}) =>
  SetMetadata(AUDITED_KEY, { action, targetType, targetIdFrom: opts.targetIdFrom ?? 'result' } satisfies AuditedMeta);
