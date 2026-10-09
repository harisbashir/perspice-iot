import type {
  DataMode,
  DataSource,
  DeviceProfileDto,
  DeviceSummary,
  Timewindow,
  WidgetConfig,
  WidgetDataResult,
} from '@perspice/shared';
import type { ComponentType } from 'react';
import type { z } from 'zod';

export type WidgetCategory = 'chart' | 'value' | 'table' | 'control' | 'other';

/** What the dashboard gives each widget. */
export interface WidgetProps<S = Record<string, unknown>> {
  config: WidgetConfig;
  /** `config.settings` parsed with the widget's schema (defaults applied). */
  settings: S;
  /** This widget's result from the data API (undefined while loading). */
  result: WidgetDataResult | undefined;
  timewindow: Timewindow;
  /** The device a device dashboard was opened for. */
  device: DeviceSummary | null;
  profile: DeviceProfileDto | null;
  can: { command: boolean; export: boolean; ack: boolean };
  viewer: { scopeType: 'platform' | 'customer' };
  actions: WidgetActions;
}

export interface WidgetActions {
  sendCommand(name: string, params: Record<string, unknown>): Promise<void>;
  writeShared(values: Record<string, unknown>): Promise<void>;
  openDevice(deviceId: string): void;
  /** Acknowledges an alarm (alarm widgets; only offered when `can.ack`). */
  ackAlarm(alarmId: string): Promise<void>;
  openAlarm(alarmId: string): void;
  /** Asks the dashboard to change this widget's request (e.g. a table's page or sort). */
  setQuery(patch: { page?: number; sort?: { by: string; dir: 'asc' | 'desc' }; customerId?: string }): void;
}

/**
 * The widget plugin contract (spec §7.3). `data.mode` is the request the dashboard makes for the
 * widget; `null` for widgets without data (markdown) or that act only (command button).
 */
export interface WidgetDefinition<S extends Record<string, unknown> = Record<string, unknown>> {
  type: string;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  category: WidgetCategory;
  settingsSchema: z.ZodObject<z.ZodRawShape, z.UnknownKeysParam, z.ZodTypeAny, S>;
  data: { mode: DataMode | null; sources: DataSource['kind'][]; keys?: { min: number; max: number } };
  defaultSize: { w: number; h: number };
  Component: ComponentType<WidgetProps<S>>;
}

const registry = new Map<string, WidgetDefinition>();

export function registerWidget<S extends Record<string, unknown>>(def: WidgetDefinition<S>): void {
  if (registry.has(def.type)) throw new Error(`Widget type "${def.type}" is already registered`);
  registry.set(def.type, def as unknown as WidgetDefinition);
}

export const getWidget = (type: string): WidgetDefinition | undefined => registry.get(type);

export const listWidgets = (category?: WidgetCategory): WidgetDefinition[] =>
  [...registry.values()].filter((w) => !category || w.category === category);

/** Test helper. */
export const clearRegistry = (): void => registry.clear();

/** Parses stored settings with the widget's schema; falls back to defaults if they are invalid. */
export function settingsFor<S extends Record<string, unknown>>(def: WidgetDefinition<S>, raw: unknown): S {
  const parsed = def.settingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : def.settingsSchema.parse({});
}
