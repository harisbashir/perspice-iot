/**
 * ECharts themes matching the app's tokens (apps/web/src/index.css). Canvas charts can't read CSS
 * variables, so the values are repeated here; keep them in step.
 */
/** Series colours: Apple's system blue, green, orange, pink, purple, teal, yellow, brown. */
export const SERIES_LIGHT = ['#007AFF', '#34C759', '#FF9500', '#FF2D55', '#AF52DE', '#30B0C7', '#FFCC00', '#A2845E'];
export const SERIES_DARK = ['#0A84FF', '#30D158', '#FF9F0A', '#FF375F', '#BF5AF2', '#40C8E0', '#FFD60A', '#AC8E68'];

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

function theme(dark: boolean) {
  const muted = dark ? '#98989D' : '#68686D';
  const line = dark ? '#38383A' : '#E3E3E8';
  const axis = { axisLine: { lineStyle: { color: line } }, axisTick: { show: false }, axisLabel: { color: muted, fontSize: 11 }, splitLine: { lineStyle: { color: line } } };
  return {
    color: dark ? SERIES_DARK : SERIES_LIGHT,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: FONT, color: dark ? '#F5F5F7' : '#1D1D1F' },
    categoryAxis: axis,
    valueAxis: { ...axis, axisLine: { show: false } },
    timeAxis: axis,
    legend: { textStyle: { color: muted, fontSize: 12 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 14 },
    tooltip: {
      backgroundColor: dark ? 'rgba(44,44,46,0.96)' : 'rgba(255,255,255,0.96)',
      borderWidth: 0,
      textStyle: { color: dark ? '#F5F5F7' : '#1D1D1F', fontSize: 12 },
      extraCssText: 'border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);',
    },
    line: { symbol: 'none', smooth: 0.25, lineStyle: { width: 2 } },
    bar: { itemStyle: { borderRadius: [4, 4, 0, 0] } },
    gauge: { axisLine: { lineStyle: { color: [[1, line]] } }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: muted } }, axisTick: { lineStyle: { color: muted } }, detail: { color: dark ? '#F5F5F7' : '#1D1D1F' } },
    dataZoom: { borderColor: line, fillerColor: dark ? 'rgba(10,132,255,0.15)' : 'rgba(0,122,255,0.1)' },
  };
}

export const THEME_LIGHT = 'perspice-light';
export const THEME_DARK = 'perspice-dark';

let registered = false;
export function registerThemes(echarts: { registerTheme(name: string, theme: object): void }): void {
  if (registered) return;
  echarts.registerTheme(THEME_LIGHT, theme(false));
  echarts.registerTheme(THEME_DARK, theme(true));
  registered = true;
}
