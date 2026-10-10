import { describe, expect, it } from 'vitest';
import { DashboardDefinitionSchema, type DashboardDefinition } from '../src/index.js';

const valid = (): DashboardDefinition => ({
  states: [
    {
      id: 'main',
      name: 'Main',
      layout: [
        { i: 'w1', x: 0, y: 0, w: 4, h: 3 },
        { i: 'w2', x: 4, y: 0, w: 8, h: 6 },
      ],
      widgets: [
        { id: 'w1', type: 'value-card', title: 'Fuel', datasource: { kind: 'currentDevice', keys: ['fuel_level'] }, settings: {} },
        { id: 'w2', type: 'line-chart', datasource: { kind: 'currentDevice', keys: ['fuel_level', 'batt_v'] }, settings: { area: true } },
      ],
    },
  ],
  settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 },
});

describe('DashboardDefinitionSchema', () => {
  it('accepts a valid definition', () => {
    expect(DashboardDefinitionSchema.safeParse(valid()).success).toBe(true);
  });

  it('accepts every datasource kind', () => {
    const d = valid();
    d.states[0]!.widgets[0]!.datasource = { kind: 'device', deviceId: '7d1c6b4e-6a8a-4bd1-9a52-2c6f2a1a8a11', keys: ['t'] };
    d.states[0]!.widgets[1]!.datasource = {
      kind: 'entityList',
      profileId: null,
      filter: { status: ['online'], tags: ['north'] },
      columns: ['status', 'name', 'fuel_level'],
      pageSize: 25,
    };
    expect(DashboardDefinitionSchema.safeParse(d).success).toBe(true);
  });

  it('rejects duplicate widget ids', () => {
    const d = valid();
    d.states[0]!.widgets[1]!.id = 'w1';
    expect(DashboardDefinitionSchema.safeParse(d).success).toBe(false);
  });

  it('rejects layout items without a widget and widgets without a layout item', () => {
    const d = valid();
    d.states[0]!.layout[1]!.i = 'ghost';
    expect(DashboardDefinitionSchema.safeParse(d).success).toBe(false);
  });

  it('rejects more than 20 states and no states', () => {
    const d = valid();
    d.states = Array.from({ length: 21 }, (_, n) => ({ ...valid().states[0]!, id: `s${n}` }));
    expect(DashboardDefinitionSchema.safeParse(d).success).toBe(false);
    expect(DashboardDefinitionSchema.safeParse({ ...valid(), states: [] }).success).toBe(false);
  });

  it('rejects layout outside the 12-column grid and bad keys', () => {
    const d = valid();
    d.states[0]!.layout[0]!.x = 10;
    expect(DashboardDefinitionSchema.safeParse(d).success).toBe(false);
    const k = valid();
    k.states[0]!.widgets[0]!.datasource = { kind: 'currentDevice', keys: ['a/b'] };
    expect(DashboardDefinitionSchema.safeParse(k).success).toBe(false);
  });

  it('keeps unknown widget types and settings (forward compatibility)', () => {
    const d = valid();
    d.states[0]!.widgets[0]!.type = 'future-widget';
    d.states[0]!.widgets[0]!.settings = { anything: [1, 2] };
    const parsed = DashboardDefinitionSchema.parse(d);
    expect(parsed.states[0]!.widgets[0]!.type).toBe('future-widget');
  });
});
