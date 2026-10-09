import { type DataSource, type DeviceProfileDto, ENTITY_COLUMNS } from '@perspice/shared';
import type { WidgetDefinition } from '@perspice/widgets';
import { useId } from 'react';
import { useProfiles } from '@/pages/devices/hooks';

const KIND_LABEL: Record<DataSource['kind'], string> = {
  none: 'No data',
  currentDevice: 'The dashboard’s device',
  device: 'A specific device',
  devicesOfProfile: 'Devices of a profile',
  entityList: 'Device list',
};

const selectClass = 'h-8 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700';

function KeyPicker({ keys, value, onChange, max }: { keys: { key: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const atMax = max !== undefined && value.length >= max;
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-slate-600 dark:text-slate-300">Keys{max ? ` (up to ${max})` : ''}</legend>
      {keys.length === 0 && <p className="text-xs text-slate-500">This profile declares no telemetry keys.</p>}
      <div className="flex max-h-40 flex-col gap-1 overflow-auto">
        {keys.map((k) => {
          const checked = value.includes(k.key);
          return (
            <label key={k.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && atMax}
                onChange={(e) => onChange(e.target.checked ? (max === 1 ? [k.key] : [...value, k.key]) : value.filter((x) => x !== k.key))}
              />
              {k.label} <span className="font-mono text-xs text-slate-400">{k.key}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Picks a widget's data source among the kinds the widget supports, with keys from the profile. */
export function DatasourceEditor({
  widget,
  value,
  onChange,
  profile,
}: {
  widget: WidgetDefinition;
  value: DataSource;
  onChange: (ds: DataSource) => void;
  profile: DeviceProfileDto | null;
}) {
  const id = useId();
  const { data: profiles = [] } = useProfiles();
  const keys = (profile?.telemetrySchema ?? []).map((k) => ({ key: k.key, label: k.label }));
  const keyLimit = widget.data.keys?.max;
  const kinds = widget.data.sources;

  function setKind(kind: DataSource['kind']) {
    const currentKeys = 'keys' in value ? value.keys : [];
    if (kind === 'none') onChange({ kind });
    else if (kind === 'currentDevice') onChange({ kind, keys: currentKeys });
    else if (kind === 'device') onChange({ kind, deviceId: value.kind === 'device' ? value.deviceId : '', keys: currentKeys });
    else if (kind === 'devicesOfProfile') onChange({ kind, profileId: profile?.id ?? null, keys: currentKeys });
    else onChange({ kind, profileId: profile?.id ?? null, columns: ['status', 'name', 'lastSeen'], pageSize: 25 });
  }

  return (
    <div className="space-y-3">
      {kinds.length > 1 && (
        <div className="space-y-1">
          <label htmlFor={`${id}-kind`} className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Data source
          </label>
          <select id={`${id}-kind`} className={selectClass} value={value.kind} onChange={(e) => setKind(e.target.value as DataSource['kind'])}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      )}
      {value.kind === 'device' && (
        <div className="space-y-1">
          <label htmlFor={`${id}-device`} className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Device id
          </label>
          <input id={`${id}-device`} className={selectClass} value={value.deviceId} onChange={(e) => onChange({ ...value, deviceId: e.target.value.trim() })} />
        </div>
      )}
      {(value.kind === 'devicesOfProfile' || value.kind === 'entityList') && (
        <div className="space-y-1">
          <label htmlFor={`${id}-profile`} className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Profile
          </label>
          <select id={`${id}-profile`} className={selectClass} value={value.profileId ?? ''} onChange={(e) => onChange({ ...value, profileId: e.target.value || null })}>
            <option value="">All profiles</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {'keys' in value && widget.data.keys && <KeyPicker keys={keys} value={value.keys} max={keyLimit} onChange={(k) => onChange({ ...value, keys: k })} />}
      {value.kind === 'entityList' && (
        <>
          <KeyPicker
            keys={[...ENTITY_COLUMNS.map((c) => ({ key: c, label: c === 'lastSeen' ? 'Last seen' : c[0]!.toUpperCase() + c.slice(1) })), ...keys]}
            value={value.columns}
            onChange={(columns) => onChange({ ...value, columns })}
          />
          <div className="space-y-1">
            <label htmlFor={`${id}-size`} className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Rows per page
            </label>
            <input
              id={`${id}-size`}
              type="number"
              min={1}
              max={500}
              className={selectClass}
              value={value.pageSize}
              onChange={(e) => onChange({ ...value, pageSize: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
            />
          </div>
        </>
      )}
    </div>
  );
}
