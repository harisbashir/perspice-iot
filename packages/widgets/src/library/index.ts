import { type WidgetDefinition, getWidget, registerWidget } from '../sdk';
import { CHART_WIDGETS } from './charts';
import { commandButton } from './control/command-button';
import { setpointWidget } from './control/setpoint';
import { sliderWidget } from './control/slider';
import { toggleWidget } from './control/toggle';
import { imageOverlay } from './other/image-overlay';
import { markdownCard } from './other/markdown';
import { entityTable } from './tables/entity-table';
import { historyTable } from './tables/history-table';
import { latestTable } from './tables/latest-table';
import { batteryWidget } from './values/battery';
import { kpiWidget } from './values/kpi';
import { ledWidget } from './values/led';
import { multiValueWidget } from './values/multi-value';
import { progressWidget } from './values/progress';
import { tankWidget } from './values/tank';
import { valueCard } from './values/value-card';

export const BUILT_IN_WIDGETS = [
  ...CHART_WIDGETS,
  valueCard,
  multiValueWidget,
  ledWidget,
  progressWidget,
  batteryWidget,
  tankWidget,
  kpiWidget,
  latestTable,
  historyTable,
  entityTable,
  commandButton,
  toggleWidget,
  sliderWidget,
  setpointWidget,
  markdownCard,
  imageOverlay,
] as unknown as WidgetDefinition[];

/** Registers the v1 library (idempotent). */
export function registerBuiltInWidgets(): void {
  for (const w of BUILT_IN_WIDGETS) if (!getWidget(w.type)) registerWidget(w);
}
