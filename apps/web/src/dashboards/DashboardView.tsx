import type { DashboardDefinition, DeviceDto, DeviceProfileDto, Timewindow, WidgetConfig } from '@perspice/shared';
import { type WidgetActions, getWidget, registerBuiltInWidgets, settingsFor } from '@perspice/widgets';
import { type ReactNode, useMemo, useState } from 'react';
import GridLayout, { WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { useNavigate } from 'react-router';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { TimewindowPicker } from './TimewindowPicker';
import { WidgetFrame } from './WidgetFrame';
import { useDashboardData } from './useDashboardData';

registerBuiltInWidgets();

const Grid = WidthProvider(GridLayout);
export const ROW_HEIGHT = 40;

export interface DashboardViewProps {
  definition: DashboardDefinition;
  /** Set for device dashboards; resolves `currentDevice` sources and receives commands. */
  device?: DeviceDto | null;
  profile?: DeviceProfileDto | null;
  /** Extra controls in the toolbar (customise, export…). */
  toolbar?: ReactNode;
  /** Extra controls per widget frame (export menu). */
  widgetActions?: (w: WidgetConfig, timewindow: Timewindow) => ReactNode;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Request failed';
}

export function DashboardView({ definition, device = null, profile = null, toolbar, widgetActions }: DashboardViewProps) {
  const { user, hasPerm } = useAuth();
  const navigate = useNavigate();
  const [stateId, setStateId] = useState(definition.states[0]!.id);
  const state = definition.states.find((s) => s.id === stateId) ?? definition.states[0]!;
  const [timewindow, setTimewindow] = useState<Timewindow>(definition.settings.timewindow);
  const { resultFor, setQuery } = useDashboardData(state, device?.id, timewindow, definition.settings.refreshS);

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
          setQuery: (patch) => setQuery(w.id, patch),
        };
      },
    [device?.id, navigate, setQuery],
  );

  const summary = device
    ? { id: device.id, name: device.name, status: device.status, lastSeen: device.lastSeen, profileId: device.profileId, customerId: device.customerId }
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {definition.states.length > 1 ? (
          <div role="tablist" aria-label="Dashboard views" className="flex gap-1">
            {definition.states.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === state.id}
                className={`rounded-md px-3 py-1 text-sm ${s.id === state.id ? 'bg-primary-100 font-medium text-primary-800 dark:bg-primary-900 dark:text-primary-100' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                onClick={() => setStateId(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <TimewindowPicker value={timewindow} onChange={setTimewindow} />
          {toolbar}
        </div>
      </div>
      <Grid
        key={state.id}
        className="-mx-2"
        cols={12}
        rowHeight={ROW_HEIGHT}
        layout={state.layout}
        isDraggable={false}
        isResizable={false}
        margin={[12, 12]}
        containerPadding={[8, 0]}
      >
        {state.widgets.map((w) => {
          const def = getWidget(w.type);
          return (
            <div key={w.id} data-testid={`widget-${w.id}`}>
              <WidgetFrame title={w.title} actions={widgetActions?.(w, timewindow)}>
                {def ? (
                  <def.Component
                    config={w}
                    settings={settingsFor(def, w.settings)}
                    result={resultFor(w.id)}
                    timewindow={timewindow}
                    device={summary}
                    profile={profile}
                    can={{ command: hasPerm('device.command'), export: hasPerm('export.data') }}
                    viewer={{ scopeType: user?.scopeType ?? 'customer' }}
                    actions={actionsFor(w)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-500">Unknown widget “{w.type}”</div>
                )}
              </WidgetFrame>
            </div>
          );
        })}
      </Grid>
    </div>
  );
}
