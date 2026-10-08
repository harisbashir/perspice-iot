import { SetMetadata } from '@nestjs/common';

export const AUDITED_KEY = 'perspice:audited';

export interface AuditedMeta {
  action: string;
  targetType: string;
}

/** Records an audit entry after the handler succeeds (see AuditInterceptor). */
export const Audited = (action: string, targetType: string) =>
  SetMetadata(AUDITED_KEY, { action, targetType } satisfies AuditedMeta);
