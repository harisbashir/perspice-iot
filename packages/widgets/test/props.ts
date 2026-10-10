import type { DataSource, DeviceProfileDto, WidgetConfig, WidgetDataResult } from '@perspice/shared';
import { vi } from 'vitest';
import type { WidgetDefinition, WidgetProps } from '../src/sdk';

export const profile: DeviceProfileDto = {
  id: 'p1',
  name: 'Telecom RMS',
  description: null,
  telemetrySchema: [
    { key: 'fuel_level', label: 'Fuel level', unit: '%', type: 'number', decimals: 1 },
    { key: 'gen_running', label: 'Generator', type: 'boolean' },
    { key: 'batt_v', label: 'Battery', unit: 'V', type: 'number', decimals: 2 },
  ],
  commands: [
    { name: 'gen_start', label: 'Start generator', confirm: true },
    { name: 'reboot', label: 'Reboot', confirm: false },
    {
      name: 'set_interval',
      label: 'Set interval',
      confirm: false,
      paramsSchema: { type: 'object', properties: { seconds: { type: 'integer' } } },
    },
  ],
  offlineTimeoutS: 300,
  deadTimeoutS: 86400,
  sleepy: false,
  transport: 'mqtt',
  retentionDays: 365,
  statusNotify: { enabled: false, roleKeys: [], channels: [] },
  locationMode: 'none',
  locationKeys: { lat: 'lat', lng: 'lng', alt: 'alt', speed: 'speed', heading: 'heading', accuracy: 'acc' },
  trips: { enabled: false, minSpeedKmh: 5, minMoveM: 50, stopAfterS: 300 },
  defaultDashboardTemplateId: null,
  createdAt: '',
  updatedAt: '',
};

export const device = { id: 'd1', name: 'Tower 17', status: 'online' as const, lastSeen: Date.now(), profileId: 'p1', customerId: 'c1' };

export const latest = (values: Record<string, unknown>): WidgetDataResult => ({
  ok: true,
  data: { device, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { ts: Date.now(), v }])) },
});

export function propsFor<S extends Record<string, unknown>>(
  def: WidgetDefinition<S>,
  opts: { datasource?: DataSource; settings?: Record<string, unknown>; result?: WidgetDataResult; can?: { command?: boolean; ack?: boolean }; scopeType?: 'platform' | 'customer' } = {},
): WidgetProps<S> {
  const config: WidgetConfig = {
    id: 'w1',
    type: def.type,
    title: 'Widget',
    datasource: opts.datasource ?? { kind: 'currentDevice', keys: ['fuel_level'] },
    settings: opts.settings ?? {},
  };
  return {
    config,
    settings: def.settingsSchema.parse(opts.settings ?? {}),
    result: opts.result,
    timewindow: { kind: 'relative', lastMs: 86_400_000 },
    device,
    profile,
    can: { command: opts.can?.command ?? true, export: true, ack: opts.can?.ack ?? true },
    viewer: { scopeType: opts.scopeType ?? 'platform' },
    actions: {
      sendCommand: vi.fn().mockResolvedValue(undefined),
      writeShared: vi.fn().mockResolvedValue(undefined),
      openDevice: vi.fn(),
      ackAlarm: vi.fn().mockResolvedValue(undefined),
      openAlarm: vi.fn(),
      setQuery: vi.fn(),
    },
  };
}
