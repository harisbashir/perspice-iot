import type { Permission } from '@perspice/shared';

export interface AuthUser {
  kind: 'user' | 'apikey';
  /** The user id (for API keys: the creating user). */
  id: string;
  apiKeyId: string | null;
  sessionId: string | null;
  email: string;
  name: string;
  scopeType: 'platform' | 'customer';
  customerId: string | null;
  groupId: string | null;
  roleId: string;
  roleKey: string | null;
  permissions: Permission[];
  totpEnabled: boolean;
}

export type TenantHost =
  | { kind: 'platform' }
  | { kind: 'customer'; customerId: string; slug: string }
  | { kind: 'unknown' };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantHost?: TenantHost;
      user?: AuthUser;
    }
  }
}
