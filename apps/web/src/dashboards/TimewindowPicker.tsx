import type { Timewindow } from '@perspice/shared';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const PRESETS = [
  { label: '1 h', ms: 3_600_000 },
  { label: '24 h', ms: 86_400_000 },
  { label: '7 d', ms: 7 * 86_400_000 },
  { label: '30 d', ms: 30 * 86_400_000 },
];

const toLocal = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

const segment = (on: boolean) =>
  cn('h-full rounded-[7px] px-2.5 text-[13px] font-medium transition-colors', on ? 'bg-surface text-fg shadow-sm dark:bg-fill-strong' : 'text-fg-muted hover:text-fg');

/** A segmented control of preset windows, plus a custom range. */
export function TimewindowPicker({ value, onChange }: { value: Timewindow; onChange: (t: Timewindow) => void }) {
  return (
    <div role="group" aria-label="Time window" className="flex flex-wrap items-center gap-2">
      <div className="flex h-8 items-center gap-px rounded-[9px] bg-fill p-0.5 touch:h-10">
        {PRESETS.map((p) => {
          const on = value.kind === 'relative' && value.lastMs === p.ms;
          return (
            <button key={p.label} type="button" aria-pressed={on} className={segment(on)} onClick={() => onChange({ kind: 'relative', lastMs: p.ms })}>
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={value.kind === 'absolute'}
          className={segment(value.kind === 'absolute')}
          onClick={() => value.kind === 'relative' && onChange({ kind: 'absolute', fromMs: Date.now() - value.lastMs, toMs: Date.now() })}
        >
          Custom
        </button>
      </div>
      {value.kind === 'absolute' && (
        <div className="flex flex-wrap gap-2">
          <Input aria-label="From" type="datetime-local" className="h-8 w-48" value={toLocal(value.fromMs)} onChange={(e) => onChange({ ...value, fromMs: new Date(e.target.value).getTime() })} />
          <Input aria-label="To" type="datetime-local" className="h-8 w-48" value={toLocal(value.toMs)} onChange={(e) => onChange({ ...value, toMs: new Date(e.target.value).getTime() })} />
        </div>
      )}
    </div>
  );
}
