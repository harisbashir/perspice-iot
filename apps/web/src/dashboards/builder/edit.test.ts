import type { DashboardDefinition, DeviceProfileDto } from '@perspice/shared';
import { DashboardDefinitionSchema } from '@perspice/shared';
import { getWidget, registerBuiltInWidgets } from '@perspice/widgets';
import { describe, expect, it } from 'vitest';
import { addState, addWidget, removeState, removeWidget, setLayout } from './edit';

registerBuiltInWidgets();

const profile = {
  id: '7d1c6b4e-6a8a-4bd1-9a52-2c6f2a1a8a11',
  telemetrySchema: [
    { key: 'state', label: 'State', type: 'string' },
    { key: 'fuel_level', label: 'Fuel', type: 'number' },
  ],
  commands: [],
} as unknown as DeviceProfileDto;

const empty = (): DashboardDefinition => ({
  states: [{ id: 'main', name: 'Main', layout: [{ i: 'a', x: 0, y: 0, w: 12, h: 4 }], widgets: [{ id: 'a', type: 'markdown', datasource: { kind: 'none' }, settings: {} }] }],
  settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 },
});

describe('dashboard editing', () => {
  it('adds a widget in free space below existing ones, with defaults from the profile', () => {
    const { def, id } = addWidget(empty(), 'main', getWidget('value-card')!, profile);
    const item = def.states[0]!.layout.find((l) => l.i === id)!;
    expect(item).toMatchObject({ x: 0, y: 4, w: 3, h: 3 });
    const widget = def.states[0]!.widgets.find((w) => w.id === id)!;
    expect(widget.datasource).toEqual({ kind: 'currentDevice', keys: ['fuel_level'] });
    expect(widget.settings).toMatchObject({ showTrend: true });
    expect(DashboardDefinitionSchema.safeParse(def).success).toBe(true);
  });

  it('gives each new widget a unique id and an entity list for tables', () => {
    let def = empty();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = addWidget(def, 'main', getWidget('entity-table')!, profile);
      def = r.def;
      ids.push(r.id);
    }
    expect(new Set(ids).size).toBe(3);
    expect(def.states[0]!.widgets.at(-1)!.datasource).toMatchObject({ kind: 'entityList', profileId: profile.id, columns: ['status', 'name', 'lastSeen', 'fuel_level'] });
    expect(DashboardDefinitionSchema.safeParse(def).success).toBe(true);
  });

  it('removes widgets with their layout and keeps at least one state', () => {
    const removed = removeWidget(empty(), 'main', 'a');
    expect(removed.states[0]!.widgets).toEqual([]);
    expect(removed.states[0]!.layout).toEqual([]);
    expect(removeState(empty(), 'main').states).toHaveLength(1);
    const { def, id } = addState(empty(), 'Power');
    expect(def.states.map((s) => s.name)).toEqual(['Main', 'Power']);
    expect(removeState(def, id).states).toHaveLength(1);
  });

  it('applies layout changes', () => {
    const def = setLayout(empty(), 'main', [{ i: 'a', x: 2, y: 1, w: 4, h: 2 }]);
    expect(def.states[0]!.layout).toEqual([{ i: 'a', x: 2, y: 1, w: 4, h: 2 }]);
  });
});
