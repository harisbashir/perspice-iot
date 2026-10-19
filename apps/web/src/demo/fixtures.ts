import {
  type AlarmDto,
  type AlarmSummary,
  type BrandingDto,
  type DashboardDefinition,
  type DashboardViewDto,
  type DeviceDto,
  type DeviceProfileDto,
  type LatestValueDto,
  type MeResponse,
  type TelemetryKeyDef,
  PERMISSIONS,
  generateDeviceDefinition,
  overviewDefinition,
} from '@perspice/shared';
import { FALLBACK_BRANDING } from '@/branding/BrandingProvider';

/**
 * Demo-mode data: a small telecom fleet that every page can show without a server. The
 * dashboards come from the server's own generators, so they match a freshly seeded install.
 */

const HOUR = 3_600_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

export const branding: BrandingDto = FALLBACK_BRANDING;

export const me: MeResponse = {
  id: 'u-demo',
  email: 'demo@perspice.example',
  name: 'Demo Admin',
  scopeType: 'platform',
  customerId: null,
  customerSlug: null,
  groupId: null,
  roleId: 'r-admin',
  roleKey: 'platform_admin',
  permissions: [...PERMISSIONS],
  totpEnabled: true,
};

export const customers = [
  { id: '6f1c2a10-0000-4000-8000-000000000001', name: 'Northwind Telecom' },
  { id: '6f1c2a10-0000-4000-8000-000000000002', name: 'Harbour Foods' },
];

const RMS_ID = '0b9e7f80-0000-4000-8000-000000000001';
const COLD_ID = '0b9e7f80-0000-4000-8000-000000000002';

const rmsKeys: TelemetryKeyDef[] = [
  { key: 'mains_v', label: 'Mains voltage', unit: 'V', type: 'number', decimals: 0 },
  { key: 'gen_running', label: 'Generator running', type: 'boolean' },
  { key: 'fuel_level', label: 'Fuel level', unit: '%', type: 'number', decimals: 1 },
  { key: 'batt_v', label: 'Battery voltage', unit: 'V', type: 'number', decimals: 2 },
  { key: 'door_open', label: 'Door open', type: 'boolean' },
  { key: 'rssi', label: 'Signal', unit: 'dBm', type: 'number', decimals: 0 },
  { key: 'cabinet_temp', label: 'Cabinet temperature', unit: '°C', type: 'number', decimals: 1 },
  { key: 'batt_soc', label: 'Battery charge', unit: '%', type: 'number', decimals: 0 },
];
const coldKeys: TelemetryKeyDef[] = [
  { key: 'temp', label: 'Temperature', unit: '°C', type: 'number', decimals: 1 },
  { key: 'humidity', label: 'Humidity', unit: '%', type: 'number', decimals: 0 },
  { key: 'compressor', label: 'Compressor on', type: 'boolean' },
  { key: 'door_open', label: 'Door open', type: 'boolean' },
];

const profileBase = {
  description: null,
  offlineTimeoutS: 300,
  deadTimeoutS: 86_400,
  sleepy: false,
  transport: 'mqtt' as const,
  retentionDays: 365,
  statusNotify: { enabled: true, roleKeys: ['platform_admin' as const], channels: ['inapp' as const] },
  locationMode: 'fixed' as const,
  locationKeys: { lat: 'lat', lng: 'lng', alt: 'alt', speed: 'speed', heading: 'heading', accuracy: 'acc' },
  trips: { enabled: false, minSpeedKmh: 5, minMoveM: 50, stopAfterS: 300 },
  calculated: [],
  createdAt: iso(now - 90 * 24 * HOUR),
  updatedAt: iso(now - 2 * 24 * HOUR),
};

export const profiles: DeviceProfileDto[] = [
  {
    ...profileBase,
    id: RMS_ID,
    name: 'Telecom RMS',
    description: 'Remote monitoring for telecom sites: mains, generator, fuel, battery and door.',
    telemetrySchema: rmsKeys,
    commands: [
      { name: 'gen_start', label: 'Start generator', confirm: true },
      { name: 'gen_stop', label: 'Stop generator', confirm: true },
    ],
    defaultDashboardTemplateId: 'tpl-rms',
  },
  {
    ...profileBase,
    id: COLD_ID,
    name: 'Cold room',
    description: 'Walk-in cold rooms: temperature, humidity, compressor and door.',
    telemetrySchema: coldKeys,
    commands: [{ name: 'defrost', label: 'Start defrost', confirm: true }],
    defaultDashboardTemplateId: 'tpl-cold',
  },
];

export const keysOf = (profileId: string) => profiles.find((p) => p.id === profileId)?.telemetrySchema ?? [];

/** A stable number in [0, 1) per string, so a device keeps its character between reloads. */
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/** Plausible values per key over time: mains sags, fuel drains, a cold room cycles. */
export function valueAt(key: string, deviceId: string, t: number): unknown {
  const r = seed(key + deviceId);
  const wave = (periodH: number, phase = 0) => Math.sin((t / (periodH * HOUR)) * 2 * Math.PI + r * 6 + phase);
  switch (key) {
    case 'mains_v':
      return Math.round(228 + 9 * wave(6) + 3 * wave(0.4));
    case 'gen_running':
      return wave(9) > 0.75;
    case 'fuel_level':
      return Number((18 + r * 70 + 6 * wave(30)).toFixed(1));
    case 'batt_v':
      return Number((51.8 + 1.4 * wave(5) + r).toFixed(2));
    case 'door_open':
      return wave(2.3, 1) > 0.93;
    case 'rssi':
      return Math.round(-62 - r * 30 + 4 * wave(1.5));
    case 'batt_soc':
      return Math.round(Math.min(100, 62 + 30 * wave(5) + r * 10));
    case 'cabinet_temp':
      return Number((27 + 6 * wave(24) + r * 4).toFixed(1));
    case 'temp':
      return Number((2.5 + 1.2 * wave(1.1) + r).toFixed(1));
    case 'humidity':
      return Math.round(71 + 8 * wave(3));
    case 'compressor':
      return wave(1.1) > 0;
    default:
      return Number((50 + 30 * wave(4)).toFixed(1));
  }
}

export const latestOf = (d: Pick<DeviceDto, 'id' | 'profileId'>, keys: string[], t = Date.now()): Record<string, LatestValueDto> =>
  Object.fromEntries(keys.map((k) => [k, { ts: t, v: valueAt(k, d.id, t) }]));

const SITES: [string, string, number, number, DeviceDto['status'], number][] = [
  // name, profile, lat, lng, status, minutes since last seen
  ['Ridgeback tower', RMS_ID, 51.52, -0.11, 'online', 0.3],
  ['Millbrook exchange', RMS_ID, 51.49, -0.18, 'online', 0.6],
  ['Quarry Hill mast', RMS_ID, 51.57, -0.03, 'offline', 46],
  ['Saltmarsh relay', RMS_ID, 51.46, 0.02, 'online', 1.1],
  ['Kestrel Point', RMS_ID, 51.55, -0.22, 'dead', 60 * 30],
  ['Old Mill rooftop', RMS_ID, 51.5, -0.07, 'online', 0.2],
  ['Dockside cold room 1', COLD_ID, 51.505, -0.02, 'online', 0.5],
  ['Dockside cold room 2', COLD_ID, 51.506, -0.021, 'online', 0.4],
  ['Market hall chiller', COLD_ID, 51.51, -0.09, 'never', 0],
];

export const devices: DeviceDto[] = SITES.map(([name, profileId, lat, lng, status, mins], i) => {
  const id = `5d2a0c00-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
  const lastSeen = status === 'never' ? null : now - mins * 60_000;
  return {
    id,
    name,
    profileId,
    customerId: profileId === RMS_ID ? customers[0]!.id : customers[1]!.id,
    groupId: null,
    tags: profileId === RMS_ID ? ['rms', i % 2 ? 'rural' : 'urban'] : ['cold-chain'],
    status,
    lastSeen,
    firmwareVersion: status === 'never' ? null : i % 3 ? '1.4.2' : '1.5.0',
    serial: `PS-${(0x3a10 + i * 37).toString(16).toUpperCase()}`,
    provisionedAt: status === 'never' ? null : iso(now - (40 - i) * 24 * HOUR),
    offlineTimeoutS: null,
    deadTimeoutS: null,
    attributes: { client: { fw: '1.4.2', net: i % 2 ? 'wifi' : 'ethernet' }, server: {}, shared: { interval: 30 } },
    latest: lastSeen ? latestOf({ id, profileId }, keysOf(profileId).map((k) => k.key), lastSeen) : {},
    location: { lat, lng, ts: now - 5 * 24 * HOUR, source: 'fixed' },
    createdAt: iso(now - (60 - i) * 24 * HOUR),
    updatedAt: iso(now - HOUR),
  };
});

export const deviceById = (id: string) => devices.find((d) => d.id === id);
export const customerName = (id: string | null) => customers.find((c) => c.id === id)?.name ?? null;

const alarm = (i: number, deviceIdx: number, severity: AlarmDto['severity'], status: AlarmDto['status'], ruleName: string, message: string, minsAgo: number, value: AlarmDto['value']): AlarmDto => {
  const d = devices[deviceIdx]!;
  return {
    id: `a1a1a1a1-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ruleId: null,
    ruleName,
    type: 'threshold',
    severity,
    status,
    device: { id: d.id, name: d.name, profileId: d.profileId },
    customer: d.customerId ? { id: d.customerId, name: customerName(d.customerId)! } : null,
    startedAt: now - minsAgo * 60_000,
    acknowledgedAt: status === 'acknowledged' ? now - (minsAgo - 5) * 60_000 : null,
    acknowledgedBy: status === 'acknowledged' ? { id: me.id, name: me.name } : null,
    clearedAt: status === 'cleared' ? now - (minsAgo - 20) * 60_000 : null,
    clearReason: status === 'cleared' ? 'condition' : null,
    value,
    message,
  };
};

export const alarms: AlarmDto[] = [
  alarm(1, 2, 'critical', 'active', 'Site offline', 'Quarry Hill mast stopped reporting', 46, null),
  alarm(2, 3, 'major', 'active', 'Low fuel', 'Fuel level below 25 %', 18, { key: 'fuel_level', v: 22.4 }),
  alarm(3, 0, 'minor', 'acknowledged', 'Door open', 'Cabinet door open for more than 5 minutes', 95, { key: 'door_open', v: true }),
  alarm(4, 6, 'warning', 'active', 'Temperature high', 'Cold room above 5 °C', 7, { key: 'temp', v: 5.4 }),
  alarm(5, 1, 'major', 'cleared', 'Mains failure', 'Mains voltage below 180 V', 300, { key: 'mains_v', v: 0 }),
];

export function alarmSummary(): AlarmSummary {
  const open = alarms.filter((a) => a.status !== 'cleared');
  const count = (s: AlarmDto['severity']) => open.filter((a) => a.severity === s).length;
  return { critical: count('critical'), major: count('major'), minor: count('minor'), warning: count('warning'), total: open.length, unacknowledged: open.filter((a) => a.status === 'active').length };
}

const view = (id: string, name: string, definition: DashboardDefinition): DashboardViewDto => ({
  instanceId: `inst-${id}`,
  templateId: id,
  templateName: name,
  templateVersion: 1,
  overridden: false,
  baseVersion: null,
  outdated: false,
  definition,
});

const DAY_MS = 86_400_000;
const at = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

/** The seeded overview plus a "Sites" view ranking every RMS site by fuel and cabinet temperature. */
function overviewWithSites(): DashboardDefinition {
  const base = overviewDefinition();
  const rms = { kind: 'devicesOfProfile' as const, profileId: RMS_ID, filter: {}, keys: ['fuel_level'] };
  return {
    ...base,
    states: [
      ...base.states,
      {
        id: 'sites',
        name: 'Sites',
        layout: [
          { i: 'fuel-rank', ...at(0, 0, 6, 8) },
          { i: 'temp-rank', ...at(6, 0, 6, 8) },
        ],
        widgets: [
          { id: 'fuel-rank', type: 'bar-list', title: 'Lowest fuel first', datasource: rms, settings: { sort: 'asc', max: 100, warnAt: 30, critAt: 15, lowIsBad: true } },
          { id: 'temp-rank', type: 'bar-list', title: 'Warmest cabinets', datasource: { ...rms, keys: ['cabinet_temp'] }, settings: { warnAt: 35, critAt: 45 } },
        ],
      },
    ],
  };
}

export const overview = view('tpl-overview', 'Overview', overviewWithSites());

/**
 * The Telecom RMS site dashboard: a "Site" view built from the gauges, then the dashboard the
 * server generates for the profile.
 */
function rmsDefinition(p: DeviceProfileDto): DashboardDefinition {
  const generated = generateDeviceDefinition(p);
  const ds = (...keys: string[]) => ({ kind: 'currentDevice' as const, keys });
  const items: [string, ReturnType<typeof at>, Omit<DashboardDefinition['states'][number]['widgets'][number], 'id'>][] = [
    ['mains', at(0, 0, 3, 5), { type: 'arc-gauge', title: 'Mains', datasource: ds('mains_v'), settings: { min: 0, max: 300, warnAt: 200, critAt: 180, lowIsBad: true } }],
    ['rings', at(3, 0, 4, 5), { type: 'ring-gauge', title: 'Energy reserve', datasource: ds('fuel_level', 'batt_soc'), settings: { min: 0, max: 100 } }],
    ['cabinet', at(7, 0, 3, 5), { type: 'arc-gauge', title: 'Cabinet', datasource: ds('cabinet_temp'), settings: { min: 0, max: 60, decimals: 1, warnAt: 35, critAt: 45 } }],
    ['signal', at(10, 0, 2, 3), { type: 'signal-bars', title: 'Signal', datasource: ds('rssi'), settings: { scale: 'dbm' } }],
    ['door', at(10, 3, 2, 2), { type: 'led', title: 'Door', datasource: ds('door_open'), settings: { onLabel: 'Open', offLabel: 'Closed', onColor: '#FF9500' } }],
    ['fuel', at(0, 5, 4, 3), { type: 'bar-gauge', title: 'Fuel', datasource: ds('fuel_level'), settings: { min: 0, max: 100, decimals: 1, segments: 16, warnAt: 30, critAt: 15, lowIsBad: true } }],
    ['battery', at(4, 5, 3, 3), { type: 'battery', title: 'Battery', datasource: ds('batt_soc'), settings: {} }],
    ['gen', at(7, 5, 3, 3), { type: 'led', title: 'Generator', datasource: ds('gen_running'), settings: { onLabel: 'Running', offLabel: 'Stopped' } }],
    ['start', at(10, 5, 2, 3), { type: 'command-button', title: 'Generator', datasource: { kind: 'none' }, settings: { command: 'gen_start' } }],
    ['history', at(0, 8, 8, 8), { type: 'line-chart', title: 'Mains and battery', datasource: ds('mains_v', 'batt_v'), settings: { rightAxisKey: 'batt_v' } }],
    ['trend', at(8, 8, 4, 4), { type: 'sparkline', title: 'Fuel, 24 h', datasource: ds('fuel_level'), settings: {} }],
    ['temp', at(8, 12, 4, 4), { type: 'linear-gauge', title: 'Battery voltage', datasource: ds('batt_v'), settings: { min: 44, max: 58, decimals: 2, unit: 'V', warnAt: 48, critAt: 46, lowIsBad: true } }],
  ];
  return {
    states: [
      { id: 'site', name: 'Site', layout: items.map(([i, l]) => ({ i, ...l })), widgets: items.map(([id, , w]) => ({ id, ...w })) },
      { ...generated.states[0]!, id: 'all', name: 'All values' },
    ],
    settings: { timewindow: { kind: 'relative', lastMs: DAY_MS }, refreshS: 0 },
  };
}

export function deviceDashboard(profileId: string): DashboardViewDto {
  const p = profiles.find((x) => x.id === profileId)!;
  return view(p.defaultDashboardTemplateId!, `${p.name} dashboard`, p.id === RMS_ID ? rmsDefinition(p) : generateDeviceDefinition(p));
}
