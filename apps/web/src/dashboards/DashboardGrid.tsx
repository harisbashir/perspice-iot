import type { DashboardState, DeviceDto, DeviceProfileDto, LayoutItem, Timewindow, WidgetConfig } from '@perspice/shared';
import { type WidgetActions, getWidget, registerBuiltInWidgets, settingsFor } from '@perspice/widgets';
import { GripVertical } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react';
import GridLayout, { type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { useNavigate } from 'react-router';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { GRID_QUERY, useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { WidgetFrame } from './WidgetFrame';
import { sampleDevice } from './sample-data';
import { useDashboardData } from './useDashboardData';
import { loadGeofences, loadMapTiles, loadRoute, loadTrips } from './map-services';

registerBuiltInWidgets();

export const ROW_HEIGHT = 40;

/**
 * The element's width, kept current with a ResizeObserver. (react-grid-layout's WidthProvider only
 * re-measures on window resize, so a grid laid out before the page settled stayed too wide.)
 */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    if (!el) return;
    setWidth(el.offsetWidth || 1200);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width];
}
const MARGIN = 12;

/**
 * The phone layout (below md): the grid's widgets in reading order, two narrow ones (≤ 3 columns,
 * like value cards and KPI tiles) side by side, everything else full width. A narrow widget left on
 * its own takes the full width. Heights follow the grid's rows, capped so a tall table or map
 * doesn't take more than a screen.
 */
export function stackedLayout(layout: LayoutItem[]): { i: string; full: boolean; height: number }[] {
  const order = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const narrow = order.map((l) => l.w <= 3);
  return order.map((l, k) => {
    let run = 0; // position of this widget in its run of narrow widgets
    for (let j = k - 1; j >= 0 && narrow[j]; j--) run++;
    const lastOfRun = !narrow[k + 1];
    const full = !narrow[k] || (run % 2 === 0 && lastOfRun);
    // Short tiles (KPIs, value cards) get a compact fixed height; a phone shows more of them at once.
    const height = l.h <= 3 ? 112 : Math.min(560, l.h * ROW_HEIGHT + (l.h - 1) * MARGIN);
    return { i: l.i, full, height };
  });
}

export interface EditMode {
  selectedId: string | null;
  onSelect: (widgetId: string) => void;
  onLayoutChange: (layout: LayoutItem[]) => void;
}

export interface DashboardGridProps {
  state: DashboardState;
  timewindow: Timewindow;
  refreshS: number;
  device?: DeviceDto | null;
  profile?: DeviceProfileDto | null;
  edit?: EditMode;
  widgetActions?: (w: WidgetConfig) => ReactNode;
  /** Asset dashboards: the asset `currentAsset` sources read. */
  assetId?: string;
  /** Template previews without a device or asset: their widgets show made-up data. */
  sample?: boolean;
}

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Request failed');

/** Renders one dashboard state with live data; in edit mode widgets can be moved, resized and selected. */
export function DashboardGrid({ state, timewindow, refreshS, device = null, profile = null, assetId, edit, widgetActions, sample = false }: DashboardGridProps) {
  const { user, hasPerm } = useAuth();
  const navigate = useNavigate();
  const sampleKeys = useMemo(() => (sample ? (profile?.telemetrySchema ?? []) : null), [sample, profile]);
  const { resultFor, setQuery, live } = useDashboardData(state, device?.id, timewindow, refreshS, assetId, sampleKeys);
  const wide = useMediaQuery(GRID_QUERY);
  const [gridRef, width] = useWidth();

  const actionsFor = useMemo(
    () =>
      (w: WidgetConfig): WidgetActions => {
        const targetId = w.datasource.kind === 'device' ? w.datasource.deviceId : device?.id;
        return {
          async sendCommand(name, params) {
            if (!targetId) throw new Error('No device');
            try {
              await api(`/devices/${targetId}/commands`, { body: { name, params } });
            } catch (e) {
              throw new Error(errorText(e));
            }
          },
          async writeShared(values) {
            if (!targetId) throw new Error('No device');
            try {
              // Shared attributes are replaced as a whole, so merge with the current ones.
              const current = await api<DeviceDto>(`/devices/${targetId}`);
              await api(`/devices/${targetId}/attributes/shared`, { method: 'PUT', body: { ...current.attributes.shared, ...values } });
            } catch (e) {
              throw new Error(errorText(e));
            }
          },
          openDevice: (id) => navigate(`/devices/${id}`),
          openAlarm: (id) => navigate(`/alarms/${id}`),
          async ackAlarm(id) {
            try {
              await api(`/alarms/${id}/ack`, { body: {} });
            } catch (e) {
              throw new Error(errorText(e));
            }
          },
          setQuery: (patch) => setQuery(w.id, patch),
          mapTiles: loadMapTiles,
          geofences: loadGeofences,
          route: loadRoute,
          trips: loadTrips,
        };
      },
    [device?.id, navigate, setQuery],
  );

  const summary = sample
    ? sampleDevice()
    : device
    ? { id: device.id, name: device.name, status: device.status, lastSeen: device.lastSeen, profileId: device.profileId, customerId: device.customerId }
    : null;

  const renderWidget = (w: WidgetConfig, style?: CSSProperties, className?: string) => {
    const def = getWidget(w.type);
    const selected = edit?.selectedId === w.id;
    return (
      <div key={w.id} data-testid={`widget-${w.id}`} data-live={live} style={style} className={cn('relative', selected && 'rounded-xl ring-2 ring-primary-500', className)}>
        <WidgetFrame title={w.title} actions={edit ? undefined : widgetActions?.(w)}>
          {def ? (
            <def.Component
              config={w}
              settings={settingsFor(def, w.settings)}
              result={resultFor(w.id)}
              timewindow={timewindow}
              device={summary}
              profile={profile}
              can={{ command: hasPerm('device.command') && !edit, export: hasPerm('export.data'), ack: hasPerm('alarm.ack') && !edit }}
              viewer={{ scopeType: user?.scopeType ?? 'customer' }}
              actions={actionsFor(w)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-fg-muted">Unknown widget “{w.type}”</div>
          )}
        </WidgetFrame>
        {edit && (
          <>
            {/* While editing, a click selects the widget instead of operating it. */}
            <button
              type="button"
              aria-label={`Select ${w.title || def?.name || w.type}`}
              aria-pressed={selected}
              className="absolute inset-0 rounded-lg"
              onClick={() => edit.onSelect(w.id)}
            />
            <span
              aria-hidden
              title="Drag to move"
              className="widget-drag-handle absolute right-1 top-1 z-10 cursor-move rounded bg-surface/80 p-1 text-fg-muted shadow-sm"
            >
              <GripVertical className="h-4 w-4" />
            </span>
          </>
        )}
      </div>
    );
  };

  if (!wide && !edit) {
    const byId = new Map(state.widgets.map((w) => [w.id, w]));
    return (
      <div className="grid grid-cols-2 gap-3" data-layout="stacked">
        {stackedLayout(state.layout).map(({ i, full, height }) => {
          const w = byId.get(i);
          return w ? renderWidget(w, { height }, full ? 'col-span-2' : undefined) : null;
        })}
      </div>
    );
  }

  return (
    <div ref={gridRef} className="-mx-2">
      <GridLayout
        className={cn(edit && 'min-h-64 rounded-xl bg-fill/60')}
        width={width}
        cols={12}
        rowHeight={ROW_HEIGHT}
        layout={state.layout}
        isDraggable={!!edit}
        isResizable={!!edit}
        compactType="vertical"
        draggableHandle=".widget-drag-handle"
        margin={[MARGIN, MARGIN]}
        containerPadding={[8, edit ? 8 : 0]}
        onLayoutChange={(layout: Layout[]) => edit?.onLayoutChange(layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })))}
      >
        {state.widgets.map((w) => renderWidget(w))}
      </GridLayout>
    </div>
  );
}
