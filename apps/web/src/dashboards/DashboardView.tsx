import type { DashboardDefinition, DeviceDto, DeviceProfileDto, Timewindow, WidgetConfig } from '@perspice/shared';
import { type ReactNode, useState } from 'react';
import { widgetExportAction } from '@/exports/widgetExport';
import { DashboardGrid } from './DashboardGrid';
import { TimewindowPicker } from './TimewindowPicker';

export interface DashboardViewProps {
  definition: DashboardDefinition;
  /** Set for device dashboards; resolves `currentDevice` sources and receives commands. */
  device?: DeviceDto | null;
  profile?: DeviceProfileDto | null;
  /** Extra controls in the toolbar (customise, export…). */
  toolbar?: ReactNode;
  /** Controls per widget frame; defaults to the export menu. */
  widgetActions?: (w: WidgetConfig, timewindow: Timewindow) => ReactNode;
}

export function StateTabs({ definition, active, onChange }: { definition: DashboardDefinition; active: string; onChange: (id: string) => void }) {
  if (definition.states.length < 2) return <span />;
  return (
    <div role="tablist" aria-label="Dashboard views" className="flex flex-wrap gap-1">
      {definition.states.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={s.id === active}
          className={`rounded-md px-3 py-1 text-sm ${s.id === active ? 'bg-primary-100 font-medium text-primary-800 dark:bg-primary-900 dark:text-primary-100' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
          onClick={() => onChange(s.id)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}

export function DashboardView({
  definition,
  device = null,
  profile = null,
  toolbar,
  widgetActions = (w, tw) => widgetExportAction(w, tw, device),
}: DashboardViewProps) {
  const [stateId, setStateId] = useState(definition.states[0]!.id);
  const state = definition.states.find((s) => s.id === stateId) ?? definition.states[0]!;
  const [timewindow, setTimewindow] = useState<Timewindow>(definition.settings.timewindow);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StateTabs definition={definition} active={state.id} onChange={setStateId} />
        <div className="flex flex-wrap items-center gap-2">
          <TimewindowPicker value={timewindow} onChange={setTimewindow} />
          {toolbar}
        </div>
      </div>
      <DashboardGrid
        key={state.id}
        state={state}
        timewindow={timewindow}
        refreshS={definition.settings.refreshS}
        device={device}
        profile={profile}
        widgetActions={(w) => widgetActions(w, timewindow)}
      />
    </div>
  );
}
