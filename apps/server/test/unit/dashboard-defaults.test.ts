import { DashboardDefinitionSchema, type DeviceProfileDto } from '@perspice/shared';
import { describe, expect, it } from 'vitest';
import { generateDeviceDefinition, overviewDefinition, withAlarmWidgets, withMapWidget } from '../../src/dashboards/defaults';

const profile: Pick<DeviceProfileDto, 'telemetrySchema' | 'commands'> = {
  telemetrySchema: [
    { key: 'fuel_level', label: 'Fuel', unit: '%', type: 'number', decimals: 1 },
    { key: 'mains_v', label: 'Mains', unit: 'V', type: 'number' },
    { key: 'gen_running', label: 'Generator', type: 'boolean' },
    { key: 'state', label: 'State', type: 'string' },
  ],
  commands: [
    { name: 'gen_start', label: 'Start generator', confirm: true },
    { name: 'gen_stop', label: 'Stop generator', confirm: true },
  ],
};

describe('default dashboards', () => {
  it('generates a valid device dashboard covering every key and command', () => {
    const def = generateDeviceDefinition(profile);
    expect(DashboardDefinitionSchema.safeParse(def).success).toBe(true);
    const widgets = def.states[0]!.widgets;
    const types = widgets.map((w) => w.type);
    expect(types.filter((t) => t === 'value-card')).toHaveLength(3); // two numbers + one string
    expect(types).toContain('led');
    expect(widgets.find((w) => w.type === 'line-chart')?.datasource).toEqual({ kind: 'currentDevice', keys: ['fuel_level', 'mains_v'] });
    expect(widgets.filter((w) => w.type === 'command-button').map((w) => w.settings.command)).toEqual(['gen_start', 'gen_stop']);
    expect(widgets.find((w) => w.type === 'latest-table')).toBeDefined();
  });

  it('places widgets without overlaps inside the grid', () => {
    const { layout } = generateDeviceDefinition(profile).states[0]!;
    for (const a of layout) {
      for (const b of layout) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.i} overlaps ${b.i}`).toBe(false);
      }
    }
  });

  it('handles a profile with no keys or commands', () => {
    const def = generateDeviceDefinition({ telemetrySchema: [], commands: [] });
    expect(DashboardDefinitionSchema.safeParse(def).success).toBe(true);
  });

  it('builds the overview with KPI tiles and a device table', () => {
    const def = overviewDefinition();
    expect(DashboardDefinitionSchema.safeParse(def).success).toBe(true);
    const widgets = def.states[0]!.widgets;
    expect(widgets.filter((w) => w.type === 'kpi').map((w) => w.settings.metric)).toEqual([
      'total',
      'online',
      'offline',
      'dead',
      'never',
      'messages24h',
    ]);
    expect(widgets.find((w) => w.type === 'entity-table')?.datasource).toMatchObject({ kind: 'entityList', columns: ['status', 'name', 'profile', 'customer', 'lastSeen'] });
  });
});

describe('overview alarm upgrade', () => {
  it('appends the alarm block below an older overview once, keeping its widgets', () => {
    const current = overviewDefinition();
    expect(withAlarmWidgets(current)).toBeNull();
    const old = {
      ...current,
      states: [{ ...current.states[0]!, widgets: current.states[0]!.widgets.filter((w) => !w.id.startsWith('alarm')), layout: [{ i: 'devices', x: 0, y: 0, w: 12, h: 12 }] }],
    };
    old.states[0]!.widgets = old.states[0]!.widgets.filter((w) => w.id === 'devices');
    const up = withAlarmWidgets(old)!;
    const ids = up.states[0]!.widgets.map((w) => w.id);
    expect(ids[0]).toBe('devices');
    expect(ids).toContain('alarms-recent');
    expect(Math.min(...up.states[0]!.layout.filter((l) => l.i !== 'devices').map((l) => l.y))).toBe(12);
    expect(withAlarmWidgets(up)).toBeNull();
  });
});

describe('overview map upgrade', () => {
  it('the overview has a map of all devices', () => {
    const map = overviewDefinition().states[0]!.widgets.find((w) => w.id === 'devices-map');
    expect(map).toMatchObject({ type: 'map', datasource: { kind: 'devicesOfProfile', profileId: null } });
  });

  it('appends the map below an older overview once, keeping its widgets', () => {
    const old = {
      ...overviewDefinition(),
      states: [{ id: 'main', name: 'Overview', widgets: overviewDefinition().states[0]!.widgets.filter((w) => w.id === 'devices'), layout: [{ i: 'devices', x: 0, y: 0, w: 12, h: 12 }] }],
    };
    const up = withMapWidget(old)!;
    expect(up.states[0]!.widgets.map((w) => w.id)).toEqual(['devices', 'devices-map']);
    expect(up.states[0]!.layout.find((l) => l.i === 'devices-map')).toMatchObject({ x: 0, y: 12, w: 12 });
    expect(withMapWidget(up)).toBeNull();
  });
});
