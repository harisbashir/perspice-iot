import type { DashboardDefinition } from '@perspice/shared';
import { describe, expect, it } from 'vitest';
import { remapKeys, templateKeys } from '../../src/dashboards/key-mapping';

const def: DashboardDefinition = {
  states: [
    {
      id: 'main',
      name: 'Main',
      layout: [
        { i: 'a', x: 0, y: 0, w: 4, h: 3 },
        { i: 'b', x: 4, y: 0, w: 4, h: 3 },
        { i: 'c', x: 8, y: 0, w: 4, h: 3 },
      ],
      widgets: [
        { id: 'a', type: 'line-chart', datasource: { kind: 'currentDevice', keys: ['fuel_level', 'batt_v'] }, settings: {} },
        {
          id: 'b',
          type: 'entity-table',
          datasource: { kind: 'entityList', profileId: null, columns: ['status', 'name', 'fuel_level'], pageSize: 25 },
          settings: {},
        },
        { id: 'c', type: 'image-overlay', datasource: { kind: 'currentDevice', keys: ['fuel_level'] }, settings: { key: 'fuel_level', note: 'fuel_level stays' } },
      ],
    },
  ],
  settings: { timewindow: { kind: 'relative', lastMs: 3_600_000 }, refreshS: 0 },
};

describe('key mapping', () => {
  it('lists the telemetry keys a template uses (not built-in columns)', () => {
    expect(templateKeys(def)).toEqual(['batt_v', 'fuel_level']);
  });

  it('rewrites keys in datasources and key settings, leaving everything else', () => {
    const out = remapKeys(def, { fuel_level: 'tank_pct', batt_v: 'battery' });
    const [a, b, c] = out.states[0]!.widgets;
    expect(a!.datasource).toEqual({ kind: 'currentDevice', keys: ['tank_pct', 'battery'] });
    expect(b!.datasource).toMatchObject({ columns: ['status', 'name', 'tank_pct'] });
    expect(c!.settings).toEqual({ key: 'tank_pct', note: 'fuel_level stays' });
    // The input is not mutated.
    expect(def.states[0]!.widgets[0]!.datasource).toEqual({ kind: 'currentDevice', keys: ['fuel_level', 'batt_v'] });
  });
});
