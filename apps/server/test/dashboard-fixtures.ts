import type { DashboardDefinition } from '@perspice/shared';

export const sampleDefinition = (keys = ['fuel_level']): DashboardDefinition => ({
  states: [
    {
      id: 'main',
      name: 'Main',
      layout: [{ i: 'w1', x: 0, y: 0, w: 6, h: 4 }],
      widgets: [{ id: 'w1', type: 'line-chart', datasource: { kind: 'currentDevice', keys }, settings: {} }],
    },
  ],
  settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 },
});
