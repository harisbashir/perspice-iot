import { profileKeys } from '@perspice/shared';
import type { DashboardDefinition, DashboardState, DataSource, DeviceProfileDto, WidgetConfig } from '@perspice/shared';
import { DashboardDefinitionSchema } from '@perspice/shared';
import type { WidgetDefinition } from '@perspice/widgets';

const mapState = (def: DashboardDefinition, stateId: string, fn: (s: DashboardState) => DashboardState): DashboardDefinition => ({
  ...def,
  states: def.states.map((s) => (s.id === stateId ? fn(s) : s)),
});

const uniqueId = (taken: Set<string>, base: string) => {
  const clean = base.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 50);
  let n = 1;
  while (taken.has(`${clean}-${n}`)) n++;
  return `${clean}-${n}`;
};

/** A sensible starting data source for a new widget, using the profile's keys. */
export function defaultDatasource(w: WidgetDefinition, profile: DeviceProfileDto | null): DataSource {
  const keys = profileKeys(profile);
  const numeric = keys.filter((k) => k.type === 'number').map((k) => k.key);
  const wanted = Math.max(w.data.keys?.min ?? 0, Math.min(w.data.keys?.max ?? 1, 1));
  const pickKeys = (numeric.length ? numeric : keys.map((k) => k.key)).slice(0, wanted);
  const sources = w.data.sources;
  if (sources.includes('entityList')) {
    return { kind: 'entityList', profileId: profile?.id ?? null, columns: ['status', 'name', 'lastSeen', ...numeric.slice(0, 2)], pageSize: 25 };
  }
  if (sources[0] === 'alarms') return { kind: 'alarms', filter: { status: ['active', 'acknowledged'] }, pageSize: 10 };
  if (sources[0] === 'devicesOfProfile') return { kind: 'devicesOfProfile', profileId: profile?.id ?? null, keys: [] };
  if (sources[0] === 'none') return { kind: 'none' };
  if (sources.includes('currentDevice')) return { kind: 'currentDevice', keys: pickKeys };
  return { kind: 'none' };
}

/** Adds a widget below everything else in the state (always free space). */
export function addWidget(def: DashboardDefinition, stateId: string, w: WidgetDefinition, profile: DeviceProfileDto | null): { def: DashboardDefinition; id: string } {
  let id = '';
  const next = mapState(def, stateId, (s) => {
    id = uniqueId(new Set(s.widgets.map((x) => x.id)), w.type);
    const bottom = s.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    const config: WidgetConfig = { id, type: w.type, title: w.name, datasource: defaultDatasource(w, profile), settings: w.settingsSchema.parse({}) };
    return {
      ...s,
      widgets: [...s.widgets, config],
      layout: [...s.layout, { i: id, x: 0, y: bottom, w: w.defaultSize.w, h: w.defaultSize.h }],
    };
  });
  return { def: next, id };
}

export const updateWidget = (def: DashboardDefinition, stateId: string, widgetId: string, patch: Partial<WidgetConfig>) =>
  mapState(def, stateId, (s) => ({ ...s, widgets: s.widgets.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)) }));

export const removeWidget = (def: DashboardDefinition, stateId: string, widgetId: string) =>
  mapState(def, stateId, (s) => ({ ...s, widgets: s.widgets.filter((w) => w.id !== widgetId), layout: s.layout.filter((l) => l.i !== widgetId) }));

export const setLayout = (def: DashboardDefinition, stateId: string, layout: DashboardState['layout']) => mapState(def, stateId, (s) => ({ ...s, layout }));

export function addState(def: DashboardDefinition, name: string): { def: DashboardDefinition; id: string } {
  const id = uniqueId(new Set(def.states.map((s) => s.id)), 'view');
  return { def: { ...def, states: [...def.states, { id, name, layout: [], widgets: [] }] }, id };
}

export const renameState = (def: DashboardDefinition, stateId: string, name: string) => mapState(def, stateId, (s) => ({ ...s, name }));

export const removeState = (def: DashboardDefinition, stateId: string): DashboardDefinition =>
  def.states.length < 2 ? def : { ...def, states: def.states.filter((s) => s.id !== stateId) };

/** First validation message for the whole definition, or null when it can be saved. */
export function validationError(def: DashboardDefinition): string | null {
  const r = DashboardDefinitionSchema.safeParse(def);
  return r.success ? null : (r.error.issues[0]?.message ?? 'Invalid dashboard');
}
