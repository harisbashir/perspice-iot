import type { TelemetryKeyDef } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExportMenu } from '@/exports/ExportMenu';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

const RANGES = [
  { id: '1h', label: '1 h', ms: 3_600_000 },
  { id: '24h', label: '24 h', ms: 86_400_000 },
  { id: '7d', label: '7 d', ms: 7 * 86_400_000 },
  { id: '30d', label: '30 d', ms: 30 * 86_400_000 },
] as const;

interface History {
  source: string;
  series: Record<string, [number, unknown][]>;
}

const toLocalInput = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function HistoryChart({ deviceId, keys }: { deviceId: string; keys: TelemetryKeyDef[] }) {
  const numeric = keys.filter((k) => k.type === 'number');
  const [selected, setSelected] = useState<string[]>(() => numeric.slice(0, 2).map((k) => k.key));
  const [range, setRange] = useState<(typeof RANGES)[number]['id'] | 'custom'>('24h');
  const [custom, setCustom] = useState(() => ({ from: Date.now() - 86_400_000, to: Date.now() }));
  const window_ = useMemo(() => {
    if (range === 'custom') return custom;
    const to = Date.now();
    return { from: to - RANGES.find((r) => r.id === range)!.ms, to };
  }, [range, custom]);

  const { data, isFetching } = useQuery({
    queryKey: ['telemetry', deviceId, selected, window_],
    queryFn: () => api<History>(`/devices/${deviceId}/telemetry`, { query: { keys: selected.join(','), from: window_.from, to: window_.to } }),
    enabled: selected.length > 0,
  });

  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!el.current || !data) return;
    const chart = echarts.getInstanceByDom(el.current) ?? echarts.init(el.current);
    chartRef.current = chart;
    const dark = document.documentElement.classList.contains('dark');
    chart.setOption(
      {
        textStyle: { color: dark ? '#cbd5e1' : '#334155' },
        tooltip: { trigger: 'axis' },
        legend: { top: 0, textStyle: { color: dark ? '#cbd5e1' : '#334155' } },
        grid: { left: 48, right: 16, top: 32, bottom: 56 },
        xAxis: { type: 'time' },
        yAxis: { type: 'value', scale: true },
        dataZoom: [{ type: 'inside' }, { type: 'slider', height: 20, bottom: 8 }],
        series: Object.entries(data.series).map(([key, points]) => {
          const def = keys.find((k) => k.key === key);
          return {
            name: def?.unit ? `${def.label} (${def.unit})` : (def?.label ?? key),
            type: 'line',
            showSymbol: false,
            data: points,
          };
        }),
      },
      true,
    );
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [data, keys]);
  // The ref is already null on unmount, so dispose through the instance we created.
  useEffect(() => () => chartRef.current?.dispose(), []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <Button key={r.id} size="sm" variant={range === r.id ? 'default' : 'outline'} onClick={() => setRange(r.id)}>
            {r.label}
          </Button>
        ))}
        <Button size="sm" variant={range === 'custom' ? 'default' : 'outline'} onClick={() => setRange('custom')}>
          Custom
        </Button>
        {range === 'custom' && (
          <>
            <Input aria-label="From" type="datetime-local" className="w-52" value={toLocalInput(custom.from)} onChange={(e) => setCustom((c) => ({ ...c, from: new Date(e.target.value).getTime() }))} />
            <Input aria-label="To" type="datetime-local" className="w-52" value={toLocalInput(custom.to)} onChange={(e) => setCustom((c) => ({ ...c, to: new Date(e.target.value).getTime() }))} />
          </>
        )}
        {data && <Badge variant="secondary">Source: {data.source === 'raw' ? 'raw data' : `${data.source} averages`}</Badge>}
        {isFetching && <span className="text-xs text-fg-muted">Loading…</span>}
        <ExportMenu
          className="ml-auto"
          request={(format) =>
            selected.length ? { kind: 'telemetry', format, params: { deviceId, keys: selected, from: window_.from, to: window_.to } } : null
          }
        />
      </div>
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="sr-only">Keys</legend>
        {numeric.map((k) => (
          <label key={k.key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={selected.includes(k.key)}
              onChange={(e) => setSelected((s) => (e.target.checked ? [...s, k.key] : s.filter((x) => x !== k.key)))}
            />
            {k.label}
          </label>
        ))}
      </fieldset>
      {selected.length === 0 ? (
        <p className="text-sm text-fg-muted">Choose at least one value to chart.</p>
      ) : (
        <div ref={el} className="h-80 w-full" role="img" aria-label="Telemetry history chart" />
      )}
    </div>
  );
}
