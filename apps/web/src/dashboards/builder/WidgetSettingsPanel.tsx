import { profileKeys } from '@perspice/shared';
import type { DeviceProfileDto, WidgetConfig } from '@perspice/shared';
import { AutoForm, getWidget, settingsFor } from '@perspice/widgets';
import { Trash2 } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { DatasourceEditor } from './DatasourceEditor';

export function WidgetSettingsPanel({
  widget,
  profile,
  onChange,
  onRemove,
}: {
  widget: WidgetConfig;
  profile: DeviceProfileDto | null;
  onChange: (patch: Partial<WidgetConfig>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const def = getWidget(widget.type);
  return (
    <aside aria-label="Widget settings" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{def?.name ?? widget.type}</h2>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="h-4 w-4" /> Remove
        </Button>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-title`} className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Title
        </label>
        <input
          id={`${id}-title`}
          className="h-8 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700"
          value={widget.title ?? ''}
          maxLength={200}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>
      {def ? (
        <>
          <DatasourceEditor widget={def} value={widget.datasource} profile={profile} onChange={(datasource) => onChange({ datasource })} />
          <AutoForm
            key={widget.id}
            schema={def.settingsSchema as never}
            value={settingsFor(def, widget.settings)}
            keys={profileKeys(profile).map((k) => k.key)}
            onChange={(settings) => onChange({ settings })}
          />
        </>
      ) : (
        <p className="text-sm text-slate-500">This widget type is not available in this version; it is kept as is.</p>
      )}
    </aside>
  );
}
