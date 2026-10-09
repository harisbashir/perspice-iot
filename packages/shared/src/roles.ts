import { PERMISSIONS, type Permission } from './permissions.js';

export type RoleScope = 'platform' | 'customer';

export const BUILT_IN_ROLE_KEYS = [
  'super_admin',
  'platform_admin',
  'support',
  'customer_admin',
  'customer_operator',
  'customer_viewer',
] as const;

export type BuiltInRoleKey = (typeof BUILT_IN_ROLE_KEYS)[number];

export interface BuiltInRole {
  scope: RoleScope;
  permissions: Permission[];
}

export const BUILT_IN_ROLES: Record<BuiltInRoleKey, BuiltInRole> = {
  super_admin: {
    scope: 'platform',
    permissions: [...PERMISSIONS],
  },
  platform_admin: {
    scope: 'platform',
    permissions: PERMISSIONS.filter((p) => p !== 'system.settings' && p !== 'backup.manage'),
  },
  support: {
    scope: 'platform',
    permissions: PERMISSIONS.filter((p) => p.endsWith('.read')),
  },
  customer_admin: {
    scope: 'customer',
    permissions: [
      'user.read',
      'user.manage',
      'device.read',
      'device.write',
      'device.command',
      'profile.read',
      'telemetry.read',
      'export.data',
      'branding.edit',
      'notification.read',
      'audit.read',
      'dashboard.customize',
      'alarm.read',
      'alarm.ack',
      'alarm.rule.write',
      'webhook.manage',
      'report.schedule',
    ],
  },
  customer_operator: {
    scope: 'customer',
    permissions: ['device.read', 'device.command', 'profile.read', 'telemetry.read', 'export.data', 'notification.read', 'alarm.read', 'alarm.ack', 'report.schedule'],
  },
  customer_viewer: {
    scope: 'customer',
    permissions: ['device.read', 'profile.read', 'telemetry.read', 'notification.read', 'alarm.read'],
  },
};

/** True when every permission in `target` is held by `granter`. */
export function canGrant(granter: readonly Permission[], target: readonly Permission[]): boolean {
  const held = new Set(granter);
  return target.every((p) => held.has(p));
}
