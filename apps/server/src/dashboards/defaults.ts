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

const ALARM_KPIS = [
  ['critical', 'Critical alarms'],
  ['major', 'Major alarms'],
  ['minor', 'Minor alarms'],
  ['unacknowledged', 'Unacknowledged'],
] as const;

const OPEN_ALARMS = { kind: 'alarms' as const, filter: { status: ['active' as const, 'acknowledged' as const] }, pageSize: 10 };

/** Active-alarm tiles and the recent-alarms table (added to the overview in v0.3.0). */
function addAlarmBlock(p: Packer): void {
  for (const [metric, label] of ALARM_KPIS) p.add({ id: `alarm-kpi-${metric}`, type: 'alarm-kpi', title: label, datasource: OPEN_ALARMS, settings: { metric } }, 3, 3);
  p.newRow();
  p.add({ id: 'alarms-recent', type: 'alarm-table', title: 'Open alarms', datasource: OPEN_ALARMS, settings: { showDevice: true } }, 12, 6);
  p.newRow();
}

/** The built-in fleet overview used on both portals (spec §7.5, without maps). */
export function overviewDefinition(): DashboardDefinition {
  const p = new Packer();
  const fleet = { kind: 'devicesOfProfile' as const, profileId: null, keys: [] };
  for (const [metric, label] of KPIS) p.add({ id: `kpi-${metric}`, type: 'kpi', title: label, datasource: fleet, settings: { metric } }, 2, 3);
  p.newRow();
  addAlarmBlock(p);
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

/**
 * Upgrades an overview created before alarms existed: the alarm tiles and table are added below
 * its first view's widgets, keeping any changes made to it. Null when it already has them.
 */
export function withAlarmWidgets(def: DashboardDefinition): DashboardDefinition | null {
  const [first, ...rest] = def.states;
  if (!first || first.widgets.some((w) => w.id === 'alarms-recent')) return null;
  const p = new Packer();
  addAlarmBlock(p);
  const bottom = first.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  return {
    ...def,
    states: [
      {
        ...first,
        layout: [...first.layout, ...p.layout.map((l) => ({ ...l, y: l.y + bottom }))],
        widgets: [...first.widgets, ...p.widgets],
      },
      ...rest,
    ],
  };
}
