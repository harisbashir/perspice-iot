import type { BrandingDto, Permission } from '@perspice/shared';

export interface UserDto {
  id: string;
  email: string;
  name: string;
  scopeType: 'platform' | 'customer';
  customerId: string | null;
  groupId: string | null;
  roleId: string;
  status: 'invited' | 'active' | 'disabled';
  totpEnabled: boolean;
  lastLogin: number | null;
  createdAt: number;
}

export interface RoleDto {
  id: string;
  key: string | null;
  name: string;
  scope: 'platform' | 'customer';
  customerId: string | null;
  permissions: Permission[];
  builtIn: boolean;
}

export interface CustomerDto {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  /** IANA zone for alarm schedules and reports (default UTC). */
  timezone?: string;
  createdAt: string;
}

export interface GroupDto {
  id: string;
  customerId: string;
  parentId: string | null;
  name: string;
}

export interface AuditEntryDto {
  id: string;
  actorType: 'user' | 'apikey' | 'system' | 'device';
  actorId: string | null;
  customerId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  diff: unknown;
  ip: string | null;
  ts: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface BrandingEdit {
  overrides: Partial<BrandingDto>;
  effective: BrandingDto;
}

export interface EmailSettingsDto {
  driver: 'smtp' | 'ses' | null;
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string; from: string; hasPassword: boolean } | null;
  ses: { region: string; accessKeyId: string; secretAccessKey: string; from: string; hasSecret: boolean } | null;
}

export interface SecuritySettingsDto {
  enforceTotpForSuperAdmin: boolean;
  docsPublic: boolean;
}
