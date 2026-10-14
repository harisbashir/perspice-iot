import type { Permission } from '@perspice/shared';

export type HelpSection = 'start' | 'use' | 'admin';

export interface HelpArticle {
  slug: string;
  title: string;
  summary: string;
  section: HelpSection;
  /** `platform`: only for platform users (staff running the platform), never shown to customers. */
  audience: 'everyone' | 'platform';
  /** Hidden from users without it (the page it explains is hidden from them too). */
  perm?: Permission;
  /** App paths this article explains, for the Help button: `/devices` also covers `/devices/…`. */
  paths: string[];
}

export const HELP_SECTIONS: { id: HelpSection; title: string }[] = [
  { id: 'start', title: 'Getting started' },
  { id: 'use', title: 'Using the platform' },
  { id: 'admin', title: 'Running the platform' },
];

export const HELP_ARTICLES: HelpArticle[] = [
  { slug: 'how-it-works', title: 'How the platform works', summary: 'Devices, profiles, dashboards, alarms and assets: the ideas everything else builds on.', section: 'start', audience: 'everyone', paths: [] },
  { slug: 'first-steps', title: 'Setting up from scratch', summary: 'The order to set things up in on a new installation, from the first profile to the first customer.', section: 'start', audience: 'platform', paths: [] },
  { slug: 'overview', title: 'The overview', summary: 'The home page: device counts, recent activity and the device table.', section: 'use', audience: 'everyone', paths: ['/'] },
  { slug: 'devices', title: 'Devices', summary: 'Finding devices, what each tab of a device shows, commands, and adding devices.', section: 'use', audience: 'everyone', perm: 'device.read', paths: ['/devices'] },
  { slug: 'dashboards', title: 'Dashboards', summary: 'Reading dashboards, changing the time window, and customising your organisation’s copy.', section: 'use', audience: 'everyone', paths: [] },
  { slug: 'assets', title: 'Assets: sites, buildings and equipment', summary: 'Organising devices into a tree that matches your estate, with roll-ups at every level.', section: 'use', audience: 'everyone', perm: 'asset.read', paths: ['/assets'] },
  { slug: 'alarms', title: 'Alarms and alarm rules', summary: 'How alarms are raised and cleared, acknowledging them, and writing rules.', section: 'use', audience: 'everyone', perm: 'alarm.read', paths: ['/alarms', '/alarm-rules'] },
  { slug: 'notifications', title: 'Notifications', summary: 'Email, push and in-app notifications, quiet hours, and the delivery log.', section: 'use', audience: 'everyone', paths: ['/settings/notifications', '/settings/deliveries'] },
  { slug: 'locations', title: 'Locations, trips and geofences', summary: 'Devices on maps, trips of moving devices, and alarms for areas.', section: 'use', audience: 'everyone', perm: 'device.read', paths: ['/geofences'] },
  { slug: 'energy', title: 'Energy, tariffs and maintenance', summary: 'Consumption and cost, time-of-use tariffs, run hours and service reminders.', section: 'use', audience: 'everyone', paths: ['/settings/tariff'] },
  { slug: 'reports-exports', title: 'Reports and exports', summary: 'Downloading data, PDF reports of dashboards, and reports emailed on a schedule.', section: 'use', audience: 'everyone', paths: ['/reports', '/exports'] },
  { slug: 'users-roles', title: 'Users, roles and permissions', summary: 'Inviting people, what each role may do, and custom roles.', section: 'use', audience: 'everyone', perm: 'user.read', paths: ['/users', '/roles'] },
  { slug: 'account', title: 'Your account', summary: 'Your profile, password, two-factor authentication and sessions.', section: 'use', audience: 'everyone', paths: ['/settings/profile', '/settings'] },
  { slug: 'branding-webhooks', title: 'Branding and webhooks', summary: 'Your logo and colours, and sending events to other systems.', section: 'use', audience: 'everyone', paths: ['/settings/branding', '/settings/webhooks'] },
  { slug: 'audit', title: 'Audit log', summary: 'Who changed what, and when.', section: 'use', audience: 'everyone', perm: 'audit.read', paths: ['/audit'] },
  { slug: 'device-profiles', title: 'Device profiles', summary: 'Telemetry keys, commands, presence, locations and calculated keys: how a kind of device is described.', section: 'admin', audience: 'platform', perm: 'profile.write', paths: ['/profiles'] },
  { slug: 'dashboard-templates', title: 'Designing dashboards', summary: 'Templates, the builder, widgets and data sources, and how customers get their copies.', section: 'admin', audience: 'platform', perm: 'dashboard.edit', paths: ['/dashboards'] },
  { slug: 'asset-types', title: 'Asset types', summary: 'What asset types are for, their attributes and dashboards, and a worked example.', section: 'admin', audience: 'platform', perm: 'asset.type.manage', paths: ['/asset-types'] },
  { slug: 'customers', title: 'Customers and groups', summary: 'Tenants, their subdomains and branding, groups, and suspending a customer.', section: 'admin', audience: 'platform', perm: 'customer.read', paths: ['/customers'] },
  { slug: 'connecting-devices', title: 'Connecting devices', summary: 'The device protocol over MQTT and HTTP, credentials, presence, and the firmware library.', section: 'admin', audience: 'platform', paths: [] },
  { slug: 'firmware', title: 'Firmware updates (OTA)', summary: 'Uploading images and rolling them out safely in batches.', section: 'admin', audience: 'platform', perm: 'firmware.manage', paths: ['/firmware', '/ota-jobs'] },
  { slug: 'system', title: 'System, backups and updates', summary: 'Health, backups and restores, email, security settings, maps, and updating the server.', section: 'admin', audience: 'platform', perm: 'system.settings', paths: ['/system', '/settings/email', '/settings/security', '/settings/maps'] },
  { slug: 'api', title: 'API and integrations', summary: 'The REST API, API keys and the live documentation.', section: 'admin', audience: 'platform', paths: [] },
];

/** Articles a user may read: platform articles for platform users, and only those for pages they can open. */
export function visibleArticles(scopeType: 'platform' | 'customer', hasPerm: (p: Permission) => boolean): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => (a.audience === 'everyone' || scopeType === 'platform') && (!a.perm || hasPerm(a.perm)));
}

/** The article explaining `pathname` (the longest matching path wins), if any. */
export function articleForPath(pathname: string, articles: HelpArticle[]): HelpArticle | undefined {
  let best: { a: HelpArticle; len: number } | undefined;
  for (const a of articles) {
    for (const p of a.paths) {
      const match = p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`);
      if (match && (!best || p.length > best.len)) best = { a, len: p.length };
    }
  }
  return best?.a;
}
