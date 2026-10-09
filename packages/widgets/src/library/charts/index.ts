import type { WidgetDefinition } from '../../sdk';
import { barChart } from './bar';
import { heatmap } from './heatmap';
import { lineChart } from './line';
import { linearGauge } from './linear-gauge';
import { pieChart } from './pie';
import { radialGauge } from './radial-gauge';
import { sparkline } from './sparkline';

export const CHART_WIDGETS = [lineChart, barChart, pieChart, radialGauge, linearGauge, heatmap, sparkline] as unknown as WidgetDefinition[];
