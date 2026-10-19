import type { CalculatedKey } from './expr.js';
import type { DeviceLocationDto, LocationKeys, TripSettings } from './location.js';
import type { Permission } from './permissions.js';
import type { BuiltInRoleKey, RoleScope } from './roles.js';

export type DeviceStatus = 'never' | 'online' | 'offline' | 'dead';

/** Minimal JSON Schema representation used for command parameters. */
export type JSONSchema = Record<string, unknown>;

export interface TelemetryKeyDef {
  key: string;
  label: string;
  unit?: string;
  type: 'number' | 'string' | 'boolean' | 'json';
  decimals?: number;
}

export interface CommandDef {
  name: string;
  label: string;
  paramsSchema?: JSONSchema;
  confirm: boolean;
}

export interface BrandingDto {
  productName: string;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  loginBackgroundUrl: string | null;
  supportEmail: string | null;
  customCss: string | null;
}

export interface MeResponse {
  id: string;
  email: string;
  name: string;
  scopeType: RoleScope;
  customerId: string | null;
  customerSlug: string | null;
  groupId: string | null;
  roleId: string;
  roleKey: string | null;
  permissions: Permission[];
  totpEnabled: boolean;
}

export interface StatusNotifyConfig {
  enabled: boolean;
  roleKeys: BuiltInRoleKey[];
  channels: ('email' | 'inapp')[];
}

export interface DeviceProfileDto {
  id: string;
  name: string;
  description: string | null;
  telemetrySchema: TelemetryKeyDef[];
  commands: CommandDef[];
  offlineTimeoutS: number;
  deadTimeoutS: number;
  sleepy: boolean;
  transport: 'mqtt' | 'http' | 'aws-iot';
  retentionDays: number;
  statusNotify: StatusNotifyConfig;
  locationMode: 'none' | 'fixed' | 'reported';
  locationKeys: LocationKeys;
  trips: TripSettings;
  /** Derived keys computed as data arrives. */
  calculated: CalculatedKey[];
  defaultDashboardTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LatestValue {
  ts: number;
  v: unknown;
}

export interface DeviceDto {
  id: string;
  name: string;
  profileId: string;
  customerId: string | null;
  groupId: string | null;
  tags: string[];
  status: DeviceStatus;
  lastSeen: number | null;
  firmwareVersion: string | null;
  /** The device's own identifier (MAC, serial number), unique within its profile. */
  serial: string | null;
  /** When it last fetched its credentials with a provisioning key. */
  provisionedAt: string | null;
  offlineTimeoutS: number | null;
  deadTimeoutS: number | null;
  attributes: {
    client: Record<string, unknown>;
    server: Record<string, unknown>;
    shared: Record<string, unknown>;
  };
  latest?: Record<string, LatestValue>;
  /** Current location (fixed, or the newest reported fix), when the device has one. */
  location: DeviceLocationDto | null;
  createdAt: string;
  updatedAt: string;
}
