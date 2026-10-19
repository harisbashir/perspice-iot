import type { WidgetDefinition } from '../../sdk';
import { arcGauge } from './arc-gauge';
import { barGauge } from './bar-gauge';
import { barList } from './bar-list';
import { ringGauge } from './ring-gauge';
import { signalBars } from './signal-bars';

/** SVG/HTML gauges added with the 2026 redesign; they need no ECharts. */
export const GAUGE_WIDGETS = [arcGauge, ringGauge, barGauge, barList, signalBars] as unknown as WidgetDefinition[];
