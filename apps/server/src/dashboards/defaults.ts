import type { DashboardDefinition, DeviceProfileDto, LayoutItem, WidgetConfig } from '@perspice/shared';
import { GRID_COLUMNS } from '@perspice/shared';

type ProfileShape = Pick<DeviceProfileDto, 'telemetrySchema' | 'commands'>;

/** Packs widgets left to right, top to bottom, on the 12-column grid. */
class Packer {
  private x = 0;
  private y = 0;
  private rowH = 0;
  readonly layout: LayoutItem[] = [];
  readonly widgets: WidgetConfig[] = [];

  add(widget: WidgetConfig, w: number, h: number): void {
    if (this.x + w > GRID_COLUMNS) this.newRow();
    this.layout.push({ i: widget.id, x: this.x, y: this.y, w, h });
    this.widgets.push(widget);
    this.x += w;
    this.rowH = Math.max(this.rowH, h);
  }

  newRow(): void {
    if (this.x === 0) return;
    this.x = 0;
    this.y += this.rowH;
    this.rowH = 0;
  }
}

const DAY_MS = 86_400_000;

/**
 * A sensible first dashboard for a profile: a card per value (LED for booleans), a chart of all
 * numeric keys, the latest-values table and a button per declared command.
 */
export function generateDeviceDefinition(profile: ProfileShape): DashboardDefinition {
  const p = new Packer();
  const keys = profile.telemetrySchema.slice(0, 24);
  for (const k of keys) {
    const ds = { kind: 'currentDevice' as const, keys: [k.key] };
    if (k.type === 'boolean') p.add({ id: `led-${k.key}`, type: 'led', title: k.label, datasource: ds, settings: {} }, 3, 3);
    else if (k.type !== 'json') p.add({ id: `card-${k.key}`, type: 'value-card', title: k.label, datasource: ds, settings: { showTrend: k.type === 'number' } }, 3, 3);
  }
  p.newRow();
  const numeric = keys.filter((k) => k.type === 'number').map((k) => k.key);
  if (numeric.length) {
    p.add({ id: 'history', type: 'line-chart', title: 'History', datasource: { kind: 'currentDevice', keys: numeric }, settings: {} }, 12, 8);
  }
  p.newRow();
  if (keys.length) {
    p.add(
      { id: 'latest', type: 'latest-table', title: 'Latest values', datasource: { kind: 'currentDevice', keys: keys.map((k) => k.key) }, settings: {} },
      6,
      8,
    );
  }
  for (const c of profile.commands.slice(0, 12)) {
    p.add({ id: `cmd-${c.name}`, type: 'command-button', title: c.label, datasource: { kind: 'none' }, settings: { command: c.name } }, 3, 2);
  }
  return {
    states: [{ id: 'main', name: 'Overview', layout: p.layout, widgets: p.widgets }],
    settings: { timewindow: { kind: 'relative', lastMs: DAY_MS }, refreshS: 0 },
  };
}

const KPIS = [
  ['total', 'Devices'],
  ['online', 'Online'],
  ['offline', 'Offline'],
  ['dead', 'Dead'],
  ['never', 'Never connected'],
  ['messages24h', 'Messages (24 h)'],
] as const;

/** The built-in fleet overview used on both portals (spec §7.5, without alarms and maps). */
export function overviewDefinition(): DashboardDefinition {
  const p = new Packer();
  const fleet = { kind: 'devicesOfProfile' as const, profileId: null, keys: [] };
  for (const [metric, label] of KPIS) p.add({ id: `kpi-${metric}`, type: 'kpi', title: label, datasource: fleet, settings: { metric } }, 2, 3);
  p.newRow();
  p.add(
    {
      id: 'devices',
      type: 'entity-table',
      title: 'Devices',
      datasource: { kind: 'entityList', profileId: null, columns: ['status', 'name', 'profile', 'customer', 'lastSeen'], pageSize: 25 },
      settings: { linkToDevice: true },
    },
    12,
    12,
  );
  return {
    states: [{ id: 'main', name: 'Overview', layout: p.layout, widgets: p.widgets }],
    settings: { timewindow: { kind: 'relative', lastMs: DAY_MS }, refreshS: 0 },
  };
}
