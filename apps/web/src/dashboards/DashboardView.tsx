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
  /** Set for asset dashboards; resolves `currentAsset` sources. */
  assetId?: string;
  /** Extra controls in the toolbar (customise, report…); a function gets the current view and time window. */
  toolbar?: ReactNode | ((ctx: { timewindow: Timewindow; stateId: string }) => ReactNode);
  /** Controls per widget frame; defaults to the export menu. */
  widgetActions?: (w: WidgetConfig, timewindow: Timewindow) => ReactNode;
}

export function StateTabs({ definition, active, onChange }: { definition: DashboardDefinition; active: string; onChange: (id: string) => void }) {
  if (definition.states.length < 2) return <span />;
  return (
    <div role="tablist" aria-label="Dashboard views" className="scroll-row h-9 items-center gap-0.5 rounded-[10px] bg-fill p-0.5">
      {definition.states.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={s.id === active}
          className={`h-full shrink-0 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium ${s.id === active ? 'bg-surface text-fg shadow-sm dark:bg-fill-strong' : 'text-fg-muted hover:text-fg'}`}
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
  assetId,
  toolbar,
  widgetActions = (w, tw) => widgetExportAction(w, tw, device),
}: DashboardViewProps) {
  const [stateId, setStateId] = useState(definition.states[0]!.id);
  const state = definition.states.find((s) => s.id === stateId) ?? definition.states[0]!;
  const [timewindow, setTimewindow] = useState<Timewindow>(definition.settings.timewindow);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StateTabs definition={definition} active={state.id} onChange={setStateId} />
        <div className="flex flex-wrap items-center gap-2">
          <TimewindowPicker value={timewindow} onChange={setTimewindow} />
          {typeof toolbar === 'function' ? toolbar({ timewindow, stateId: state.id }) : toolbar}
        </div>
      </div>
      <DashboardGrid
        key={state.id}
        state={state}
        timewindow={timewindow}
        refreshS={definition.settings.refreshS}
        device={device}
        profile={profile}
        assetId={assetId}
        widgetActions={(w) => widgetActions(w, timewindow)}
      />
    </div>
  );
}
