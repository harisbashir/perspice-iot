import { type CalculatedKeyInput, type DeviceDto, EXPR_FUNCTIONS, type TelemetryKeyDef, checkCalculated, compileExpr, evaluate } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDeviceList } from '../devices/hooks';

const cell = 'h-8 text-xs';
const selectCls = 'h-8 rounded-md border border-slate-300 bg-transparent px-1 text-xs dark:border-slate-700';

type Kind = CalculatedKeyInput['kind'];
const KINDS: [Kind, string][] = [
  ['formula', 'Formula'],
  ['counter_delta', 'Counter: use since last reading'],
  ['runtime', 'Run time (seconds)'],
  ['fuel_used', 'Level drop (fuel used)'],
];

function blank(kind: Kind, base: Pick<CalculatedKeyInput, 'key' | 'label' | 'unit' | 'decimals'>, source: string): CalculatedKeyInput {
  switch (kind) {
    case 'formula':
      return { ...base, kind, expr: '' };
    case 'counter_delta':
      return { ...base, kind, source };
    case 'runtime':
      return { ...base, kind, source, gapCapS: 900 };
    case 'fuel_used':
      return { ...base, kind, source, deadband: 0.5 };
  }
}

/** Calculated keys (spec §11): checked as you type, formulas previewed on one of the profile's devices. */
export function CalculatedKeysEditor({
  value,
  onChange,
  telemetry,
  profileId,
}: {
  value: CalculatedKeyInput[];
  onChange: (v: CalculatedKeyInput[]) => void;
  telemetry: TelemetryKeyDef[];
  profileId: string | undefined;
}) {
  const [previewId, setPreviewId] = useState('');
  const devices = useDeviceList(profileId ? { profileId } : {});
  const sample = profileId ? (devices.data?.pages.flatMap((p) => p.items) ?? []).slice(0, 50) : [];
  // The list may leave out latest values; the preview reads the device itself.
  const { data: preview } = useQuery({ queryKey: ['devices', previewId], queryFn: () => api<DeviceDto>(`/devices/${previewId}`), enabled: !!previewId });
  const issues = checkCalculated(value, telemetry);
  const update = (i: number, next: CalculatedKeyInput) => onChange(value.map((k, j) => (j === i ? next : k)));

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Computed as data arrives and stored like telemetry. Formulas use key names, numbers, <code>+ - * / % ^</code>, comparisons, <code>&amp;&amp; || !</code>,{' '}
        <code>a ? b : c</code> and {EXPR_FUNCTIONS.join(', ')}; write <code>["odd-key"]</code> for keys with other characters. They apply to new data.
      </p>
      {value.map((k, i) => {
        const mine = issues.filter((x) => x.index === i);
        const sources = [...telemetry.map((t) => t.key), ...value.slice(0, i).map((c) => c.key)].filter(Boolean);
        const base = { key: k.key, label: k.label, ...(k.unit ? { unit: k.unit } : {}), ...(k.decimals !== undefined ? { decimals: k.decimals } : {}) };
        return (
          <div key={i} className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800" data-testid={`calculated-${i}`}>
            <div className="grid grid-cols-[1fr_1fr_80px_80px_1.4fr_36px] gap-2">
              <Input aria-label="Calculated key" placeholder="key" className={cell} value={k.key} onChange={(e) => update(i, { ...k, key: e.target.value })} />
              <Input aria-label="Calculated label" placeholder="Label" className={cell} value={k.label} onChange={(e) => update(i, { ...k, label: e.target.value })} />
              <Input aria-label="Calculated unit" placeholder="Unit" className={cell} value={k.unit ?? ''} onChange={(e) => update(i, { ...k, unit: e.target.value || undefined })} />
              <Input
                aria-label="Calculated decimals"
                type="number"
                min={0}
                max={6}
                placeholder="Dec."
                className={cell}
                value={k.decimals ?? ''}
                onChange={(e) => update(i, { ...k, decimals: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
              <select aria-label="Kind" className={selectCls} value={k.kind} onChange={(e) => update(i, blank(e.target.value as Kind, base, sources[0] ?? ''))}>
                {KINDS.map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${k.key || 'calculated key'}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {k.kind === 'formula' ? (
              <div className="flex items-center gap-2">
                <Input aria-label="Formula" placeholder="e.g. v * i * pf" className={`${cell} font-mono`} value={k.expr} onChange={(e) => update(i, { ...k, expr: e.target.value })} />
                {preview && <PreviewValue expr={k.expr} device={preview} earlier={value.slice(0, i)} />}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1">
                  Source
                  <select aria-label="Source" className={selectCls} value={k.source} onChange={(e) => update(i, { ...k, source: e.target.value })}>
                    {!sources.includes(k.source) && <option value={k.source}>{k.source || 'Choose a key'}</option>}
                    {sources.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                {k.kind === 'counter_delta' && (
                  <label className="flex items-center gap-1">
                    Ignore jumps above
                    <Input aria-label="Ignore jumps above" type="number" min={0} className={`${cell} w-24`} value={k.maxDelta ?? ''} onChange={(e) => update(i, { ...k, maxDelta: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </label>
                )}
                {k.kind === 'runtime' && (
                  <label className="flex items-center gap-1">
                    Gaps longer than (s) count 0
                    <Input aria-label="Gap cap" type="number" min={10} className={`${cell} w-24`} value={k.gapCapS ?? 900} onChange={(e) => update(i, { ...k, gapCapS: Number(e.target.value) })} />
                  </label>
                )}
                {k.kind === 'fuel_used' && (
                  <label className="flex items-center gap-1">
                    Deadband
                    <Input aria-label="Deadband" type="number" min={0} step="any" className={`${cell} w-24`} value={k.deadband ?? 0.5} onChange={(e) => update(i, { ...k, deadband: Number(e.target.value) })} />
                  </label>
                )}
              </div>
            )}
            {mine.map((x) => (
              <p key={x.field + x.message} role="alert" className="text-xs text-red-600 dark:text-red-400">
                {x.message}
              </p>
            ))}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={value.length >= 20} onClick={() => onChange([...value, { key: '', label: '', kind: 'formula', expr: '' }])}>
          Add calculated key
        </Button>
        {sample.length > 0 && value.some((k) => k.kind === 'formula') && (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Preview formulas on
            <select aria-label="Preview device" className={selectCls} value={previewId} onChange={(e) => setPreviewId(e.target.value)}>
              <option value="">—</option>
              {sample.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

/** The formula over the device's latest values (earlier formulas included, as in ingest). */
function PreviewValue({ expr, device, earlier }: { expr: string; device: DeviceDto; earlier: CalculatedKeyInput[] }) {
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of Object.entries(device.latest ?? {})) values[k] = v.v;
  for (const e of earlier) {
    if (e.kind !== 'formula') continue;
    const c = compileExpr(e.expr);
    if (c.ok) values[e.key] = evaluate(c.expr, (k) => values[k]) ?? undefined;
  }
  const c = compileExpr(expr);
  const v = c.ok ? evaluate(c.expr, (k) => values[k]) : null;
  return (
    <span className="whitespace-nowrap text-xs text-slate-500" data-testid="formula-preview">
      = {v === null ? 'missing' : typeof v === 'number' ? Number(v.toFixed(6)) : String(v)}
    </span>
  );
}
