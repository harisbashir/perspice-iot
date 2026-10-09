import { type DashboardDefinition, ENTITY_COLUMNS } from '@perspice/shared';

const BUILT_IN = new Set<string>(ENTITY_COLUMNS);

/** Telemetry keys referenced by a definition (datasource keys and entity-table columns). */
export function templateKeys(def: DashboardDefinition): string[] {
  const keys = new Set<string>();
  for (const state of def.states) {
    for (const w of state.widgets) {
      const ds = w.datasource;
      if ('keys' in ds) ds.keys.forEach((k) => keys.add(k));
      if (ds.kind === 'entityList') ds.columns.filter((c) => !BUILT_IN.has(c)).forEach((k) => keys.add(k));
    }
  }
  return [...keys].sort();
}

/**
 * Rewrites telemetry keys when a template is cloned onto a profile with different key names:
 * datasource `keys`, entity-table columns, and widget settings named `key` / `keys`.
 */
export function remapKeys(def: DashboardDefinition, mapping: Record<string, string>): DashboardDefinition {
  const map = (k: string) => mapping[k] ?? k;
  const out = structuredClone(def);
  for (const state of out.states) {
    for (const w of state.widgets) {
      const ds = w.datasource;
      if ('keys' in ds) ds.keys = ds.keys.map(map);
      if (ds.kind === 'entityList') ds.columns = ds.columns.map((c) => (BUILT_IN.has(c) ? c : map(c)));
      if (typeof w.settings.key === 'string') w.settings.key = map(w.settings.key);
      if (Array.isArray(w.settings.keys)) w.settings.keys = w.settings.keys.map((k) => (typeof k === 'string' ? map(k) : k));
    }
  }
  return out;
}
