import { useEffect, useRef } from 'react';

type ECharts = typeof import('echarts');
let loader: Promise<ECharts> | undefined;
const loadEcharts = () => (loader ??= import('echarts'));

const isDark = () => document.documentElement.classList.contains('dark');

/** Renders an ECharts option, loading ECharts on first use and resizing with its container. */
export function EChart({ option, label }: { option: Record<string, unknown>; label: string }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void loadEcharts().then((echarts) => {
      if (disposed || !el.current) return;
      const chart = echarts.getInstanceByDom(el.current) ?? echarts.init(el.current, isDark() ? 'dark' : undefined);
      chart.setOption({ backgroundColor: 'transparent', ...option }, true);
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

  return <div ref={el} role="img" aria-label={label} className="h-full w-full" />;
}
