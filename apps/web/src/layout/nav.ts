import type { Permission } from '@perspice/shared';
import { Activity, BellRing, CircleHelp, Boxes, Building2, CalendarClock, Cpu, FileClock, HardDriveDownload, KeyRound, LayoutDashboard, type LucideIcon, MapPinned, Network, PanelsTopLeft, Server, Settings, Shapes, Users } from 'lucide-react';

/** Sidebar sections; on phones the same groups make up the More sheet. */
export type NavGroup = 'monitor' | 'configure' | 'admin' | 'app';

export const NAV_GROUPS: { id: NavGroup; label: string | null }[] = [
  { id: 'monitor', label: null },
  { id: 'configure', label: 'Configure' },
  { id: 'admin', label: 'Administration' },
  { id: 'app', label: null },
];

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Hidden unless the user holds this permission. */
  perm?: Permission;
  platformOnly?: boolean;
  /** One of the phone tab bar's tabs (the rest are under More). */
  tab?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, group: 'monitor', tab: true },
  { to: '/devices', label: 'Devices', icon: Cpu, perm: 'device.read', group: 'monitor', tab: true },
  { to: '/alarms', label: 'Alarms', icon: BellRing, perm: 'alarm.read', group: 'monitor', tab: true },
  { to: '/assets', label: 'Assets', icon: Network, perm: 'asset.read', group: 'monitor' },
  { to: '/geofences', label: 'Geofences', icon: MapPinned, perm: 'device.read', group: 'monitor' },
  { to: '/reports', label: 'Scheduled reports', icon: CalendarClock, perm: 'report.schedule', group: 'monitor' },
  { to: '/profiles', label: 'Device profiles', icon: Shapes, perm: 'profile.write', platformOnly: true, group: 'configure' },
  { to: '/asset-types', label: 'Asset types', icon: Boxes, perm: 'asset.type.manage', platformOnly: true, group: 'configure' },
  { to: '/dashboards', label: 'Dashboards', icon: PanelsTopLeft, perm: 'dashboard.edit', platformOnly: true, group: 'configure' },
  { to: '/firmware', label: 'Firmware', icon: HardDriveDownload, perm: 'firmware.manage', platformOnly: true, group: 'configure' },
  { to: '/customers', label: 'Customers', icon: Building2, perm: 'customer.read', platformOnly: true, group: 'admin' },
  { to: '/users', label: 'Users', icon: Users, perm: 'user.read', group: 'admin' },
  { to: '/roles', label: 'Roles', icon: KeyRound, perm: 'role.manage', group: 'admin' },
  { to: '/audit', label: 'Audit log', icon: FileClock, perm: 'audit.read', group: 'admin' },
  { to: '/system', label: 'System', icon: Server, perm: 'system.settings', platformOnly: true, group: 'admin' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'app' },
  { to: '/help', label: 'Help', icon: CircleHelp, group: 'app' },
];

export const ACTIVITY_ICON = Activity;

/** Whether `pathname` is inside the section `to` ("/" only matches itself). */
export const isActivePath = (to: string, pathname: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));
