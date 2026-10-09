import { useEffect, useRef } from 'react';

type ECharts = typeof import('echarts');
let loader: Promise<ECharts> | undefined;
const loadEcharts = () => (loader ??= import('echarts'));

const isDark = () => document.documentElement.classList.contains('dark');
/** The PDF renderer's print page sets `data-print` on <html>: no animation, charts final at once. */
const isPrint = () => document.documentElement.dataset.print === 'true';

/**
 * Renders an ECharts option, loading ECharts on first use and resizing with its container.
 * `data-chart` is "pending" until the option is drawn (the print page waits for "ready").
 */
export function EChart({ option, label }: { option: Record<string, unknown>; label: string }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    if (el.current) el.current.dataset.chart = 'pending';
    void loadEcharts().then((echarts) => {
      if (disposed || !el.current) return;
      const chart = echarts.getInstanceByDom(el.current) ?? echarts.init(el.current, isDark() ? 'dark' : undefined);
      chart.setOption({ backgroundColor: 'transparent', ...(isPrint() ? { animation: false } : {}), ...option }, true);
      el.current.dataset.chart = 'ready';
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(el.current);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [option]);

  useEffect(
    () => () => {
      void loadEcharts().then((echarts) => el.current && echarts.getInstanceByDom(el.current)?.dispose());
    },
    [],
  );

  return <div ref={el} role="img" aria-label={label} data-chart="pending" className="h-full w-full" />;
}
