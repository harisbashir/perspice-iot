import { useEffect, useRef, useState } from 'react';
import { THEME_DARK, THEME_LIGHT, registerThemes } from './theme';

type ECharts = typeof import('echarts');
let loader: Promise<ECharts> | undefined;
const loadEcharts = () => (loader ??= import('echarts'));

const isDark = () => document.documentElement.classList.contains('dark');
/** The PDF renderer's print page sets `data-print` on <html>: no animation, charts final at once. */
const isPrint = () => document.documentElement.dataset.print === 'true';

/** Whether the page is in dark mode, following changes to the appearance setting. */
function useDarkMode(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/**
 * Renders an ECharts option, loading ECharts on first use and resizing with its container. Charts
 * use the app's themes (./theme.ts) and are redrawn when the appearance changes.
 * `data-chart` is "pending" until the option is drawn (the print page waits for "ready").
 */
export function EChart({ option, label }: { option: Record<string, unknown>; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const dark = useDarkMode();

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    if (el.current) el.current.dataset.chart = 'pending';
    void loadEcharts().then((echarts) => {
      if (disposed || !el.current) return;
      registerThemes(echarts);
      const theme = dark ? THEME_DARK : THEME_LIGHT;
      let chart = echarts.getInstanceByDom(el.current);
      // A chart keeps the theme it was created with; recreate it when the appearance changes.
      if (chart && el.current.dataset.theme !== theme) {
        chart.dispose();
        chart = undefined;
      }
      chart ??= echarts.init(el.current, theme);
      el.current.dataset.theme = theme;
      chart.setOption({ backgroundColor: 'transparent', ...(isPrint() ? { animation: false } : {}), ...option }, true);
      el.current.dataset.chart = 'ready';
      const current = chart;
      observer = new ResizeObserver(() => current.resize());
      observer.observe(el.current);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [option, dark]);

  useEffect(
    () => () => {
      void loadEcharts().then((echarts) => el.current && echarts.getInstanceByDom(el.current)?.dispose());
    },
    [],
  );

  return <div ref={el} role="img" aria-label={label} data-chart="pending" className="h-full w-full" />;
}
