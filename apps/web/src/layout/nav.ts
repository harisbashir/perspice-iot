import type { Permission } from '@perspice/shared';
import { Activity, BellRing, Boxes, Building2, CalendarClock, Cpu, FileClock, HardDriveDownload, KeyRound, LayoutDashboard, MapPinned, Network, PanelsTopLeft, Server, Settings, Shapes, Users } from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Hidden unless the user holds this permission. */
  perm?: Permission;
  platformOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/devices', label: 'Devices', icon: Cpu, perm: 'device.read' },
  { to: '/assets', label: 'Assets', icon: Network, perm: 'asset.read' },
  { to: '/alarms', label: 'Alarms', icon: BellRing, perm: 'alarm.read' },
  { to: '/geofences', label: 'Geofences', icon: MapPinned, perm: 'device.read' },
  { to: '/profiles', label: 'Device profiles', icon: Shapes, perm: 'profile.write', platformOnly: true },
  { to: '/asset-types', label: 'Asset types', icon: Boxes, perm: 'asset.type.manage', platformOnly: true },
  { to: '/firmware', label: 'Firmware', icon: HardDriveDownload, perm: 'firmware.manage', platformOnly: true },
  { to: '/dashboards', label: 'Dashboards', icon: PanelsTopLeft, perm: 'dashboard.edit', platformOnly: true },
  { to: '/customers', label: 'Customers', icon: Building2, perm: 'customer.read', platformOnly: true },
  { to: '/reports', label: 'Scheduled reports', icon: CalendarClock, perm: 'report.schedule' },
  { to: '/users', label: 'Users', icon: Users, perm: 'user.read' },
  { to: '/roles', label: 'Roles', icon: KeyRound, perm: 'role.manage' },
  { to: '/audit', label: 'Audit log', icon: FileClock, perm: 'audit.read' },
  { to: '/system', label: 'System', icon: Server, perm: 'system.settings', platformOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const ACTIVITY_ICON = Activity;
