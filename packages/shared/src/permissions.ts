export const PERMISSIONS = [
  'customer.read',
  'customer.manage',
  'user.read',
  'user.manage',
  'role.manage',
  'device.read',
  'device.write',
  'device.credentials',
  'device.command',
  'profile.read',
  'profile.write',
  'telemetry.read',
  'export.data',
  'branding.edit',
  'system.settings',
  'audit.read',
  'backup.manage',
  'notification.read',
  'dashboard.edit',
  'dashboard.customize',
  'alarm.read',
  'alarm.ack',
  'alarm.rule.write',
  'webhook.manage',
  'report.schedule',
  'geofence.manage',
  'firmware.manage',
  'device.claim',
  'tariff.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
