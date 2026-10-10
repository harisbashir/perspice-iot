import type { DashboardState, DeviceDto, DeviceProfileDto, LayoutItem, Timewindow, WidgetConfig } from '@perspice/shared';
import { type WidgetActions, getWidget, registerBuiltInWidgets, settingsFor } from '@perspice/widgets';
import { GripVertical } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import GridLayout, { type Layout, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { useNavigate } from 'react-router';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { WidgetFrame } from './WidgetFrame';
import { useDashboardData } from './useDashboardData';
import { loadGeofences, loadMapTiles, loadRoute, loadTrips } from './map-services';

registerBuiltInWidgets();

const Grid = WidthProvider(GridLayout);
export const ROW_HEIGHT = 40;

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
}

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Request failed');

/** Renders one dashboard state with live data; in edit mode widgets can be moved, resized and selected. */
export function DashboardGrid({ state, timewindow, refreshS, device = null, profile = null, edit, widgetActions }: DashboardGridProps) {
  const { user, hasPerm } = useAuth();
  const navigate = useNavigate();
  const { resultFor, setQuery } = useDashboardData(state, device?.id, timewindow, refreshS);

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

  const summary = device
    ? { id: device.id, name: device.name, status: device.status, lastSeen: device.lastSeen, profileId: device.profileId, customerId: device.customerId }
    : null;

  return (
    <Grid
      className={cn('-mx-2', edit && 'min-h-64 rounded-lg bg-slate-50 dark:bg-slate-900/50')}
      cols={12}
      rowHeight={ROW_HEIGHT}
      layout={state.layout}
      isDraggable={!!edit}
      isResizable={!!edit}
      compactType="vertical"
      draggableHandle=".widget-drag-handle"
      margin={[12, 12]}
      containerPadding={[8, edit ? 8 : 0]}
      onLayoutChange={(layout: Layout[]) => edit?.onLayoutChange(layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })))}
    >
      {state.widgets.map((w) => {
        const def = getWidget(w.type);
        const selected = edit?.selectedId === w.id;
        return (
          <div key={w.id} data-testid={`widget-${w.id}`} className={cn('relative', selected && 'rounded-lg ring-2 ring-primary-500')}>
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
                <div className="flex h-full items-center justify-center text-xs text-slate-500">Unknown widget “{w.type}”</div>
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
                  className="widget-drag-handle absolute right-1 top-1 z-10 cursor-move rounded bg-white/80 p-1 text-slate-500 shadow-sm dark:bg-slate-800/80"
                >
                  <GripVertical className="h-4 w-4" />
                </span>
              </>
            )}
          </div>
        );
      })}
    </Grid>
  );
}
