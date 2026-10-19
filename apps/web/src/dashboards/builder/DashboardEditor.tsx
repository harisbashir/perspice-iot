import type { DashboardDefinition, DeviceDto, DeviceProfileDto } from '@perspice/shared';
import { Plus } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DashboardGrid } from '../DashboardGrid';
import { StateTabs } from '../DashboardView';
import { WidgetPalette } from './WidgetPalette';
import { WidgetSettingsPanel } from './WidgetSettingsPanel';
import { addState, addWidget, removeState, removeWidget, renameState, setLayout, updateWidget, validationError } from './edit';

const H = 3_600_000;
/** Default time windows a dashboard can open with (viewers pick others with the time picker). */
const WINDOWS: [number, string][] = [
  [H, 'Last hour'],
  [6 * H, 'Last 6 hours'],
  [24 * H, 'Last 24 hours'],
  [7 * 24 * H, 'Last 7 days'],
  [30 * 24 * H, 'Last 30 days'],
  [90 * 24 * H, 'Last 90 days'],
];
const REFRESH: [number, string][] = [
  [0, 'Off'],
  [10, 'Every 10 s'],
  [30, 'Every 30 s'],
  [60, 'Every minute'],
  [300, 'Every 5 minutes'],
  [900, 'Every 15 minutes'],
];
const settingSelect = 'h-8 rounded-lg border border-line-strong bg-surface px-2 text-sm';

export interface DashboardEditorProps {
  initial: DashboardDefinition;
  profile: DeviceProfileDto | null;
  /** A device whose data the preview shows (device dashboards). */
  previewDevice?: DeviceDto | null;
  /** Asset templates: the asset to preview with. */
  previewAssetId?: string;
  /** No device or asset to preview with: widgets of the dashboard's own show made-up data. */
  sample?: boolean;
  onSave: (def: DashboardDefinition) => Promise<void>;
  /** Extra toolbar content (preview device picker, version…). */
  toolbar?: ReactNode;
}

/** Drag-and-drop editor for a dashboard definition, with a live preview of real data. */
export function DashboardEditor({ initial, profile, previewDevice = null, previewAssetId, sample = false, onSave, toolbar }: DashboardEditorProps) {
  const [def, setDef] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [stateId, setStateId] = useState(initial.states[0]!.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const state = def.states.find((s) => s.id === stateId) ?? def.states[0]!;
  const widget = state.widgets.find((w) => w.id === selected) ?? null;
  const invalid = validationError(def);

  // A ref, so a save that navigates away (in onSave) is not blocked by the guard below.
  const dirtyRef = useRef(false);
  const change = (next: DashboardDefinition) => {
    setDef(next);
    setDirty(true);
    dirtyRef.current = true;
  };

  // Guard against losing unsaved work.
  const blocker = useBlocker(() => dirtyRef.current);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save() {
    setSaving(true);
    setError(null);
    dirtyRef.current = false;
    try {
      await onSave(def);
      setDirty(false);
    } catch (e) {
      dirtyRef.current = true;
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StateTabs definition={def} active={state.id} onChange={(id) => (setStateId(id), setSelected(null))} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const r = addState(def, `View ${def.states.length + 1}`);
            change(r.def);
            setStateId(r.id);
          }}
        >
          <Plus className="h-4 w-4" /> View
        </Button>
        <Input aria-label="View name" className="h-8 w-40" value={state.name} onChange={(e) => change(renameState(def, state.id, e.target.value))} />
        {def.states.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => (change(removeState(def, state.id)), setStateId(def.states[0]!.id))}>
            Delete view
          </Button>
        )}
        <div className="flex-1" />
        {toolbar}
        <Button variant="outline" onClick={() => setPaletteOpen(true)}>
          <Plus className="h-4 w-4" /> Add widget
        </Button>
        <Button onClick={() => void save()} disabled={!dirty || saving || !!invalid}>
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Default time window
          <select
            className={settingSelect}
            value={def.settings.timewindow.kind === 'relative' ? String(def.settings.timewindow.lastMs) : ''}
            onChange={(e) => change({ ...def, settings: { ...def.settings, timewindow: { kind: 'relative', lastMs: Number(e.target.value) } } })}
          >
            {def.settings.timewindow.kind === 'absolute' && <option value="">Fixed dates</option>}
            {WINDOWS.map(([ms, label]) => (
              <option key={ms} value={ms}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Refresh
          <select className={settingSelect} value={def.settings.refreshS} onChange={(e) => change({ ...def, settings: { ...def.settings, refreshS: Number(e.target.value) } })}>
            {REFRESH.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-fg-muted">Values update live either way; refreshing also re-reads charts and tables.</span>
      </div>
      {invalid && dirty && <p className="text-sm text-warn">{invalid}</p>}
      <ErrorText error={error} />
      {sample && (
        <p role="status" className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
          Previewing with sample data: widgets of the dashboard's own device or asset show made-up values so you can see the
          layout. Real data appears once the dashboard is opened for one.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <DashboardGrid
          state={state}
          timewindow={def.settings.timewindow}
          refreshS={0}
          device={previewDevice}
          assetId={previewAssetId}
          sample={sample}
          profile={profile}
          edit={{ selectedId: selected, onSelect: setSelected, onLayoutChange: (layout) => {
            // react-grid-layout reports the initial layout too; only count real changes as edits.
            if (JSON.stringify(layout) !== JSON.stringify(state.layout)) change(setLayout(def, state.id, layout));
          } }}
        />
        <div className="rounded-lg border border-line p-4">
          {widget ? (
            <WidgetSettingsPanel
              widget={widget}
              profile={profile}
              onChange={(patch) => change(updateWidget(def, state.id, widget.id, patch))}
              onRemove={() => {
                change(removeWidget(def, state.id, widget.id));
                setSelected(null);
              }}
            />
          ) : (
            <p className="text-sm text-fg-muted">Select a widget to change its data and options, or add a new one.</p>
          )}
        </div>
      </div>
      <WidgetPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onPick={(w) => {
          const r = addWidget(def, state.id, w, profile);
          change(r.def);
          setSelected(r.id);
        }}
      />
      {blocker.state === 'blocked' && (
        <div role="alertdialog" aria-label="Unsaved changes" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm shadow-lg dark:border-amber-800 dark:bg-amber-950">
          You have unsaved changes.
          <Button size="sm" variant="outline" onClick={() => blocker.reset()}>
            Keep editing
          </Button>
          <Button size="sm" variant="destructive" onClick={() => blocker.proceed()}>
            Discard
          </Button>
        </div>
      )}
    </div>
  );
}
