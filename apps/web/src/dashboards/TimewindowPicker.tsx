import type { Timewindow } from '@perspice/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PRESETS = [
  { label: '1 h', ms: 3_600_000 },
  { label: '24 h', ms: 86_400_000 },
  { label: '7 d', ms: 7 * 86_400_000 },
  { label: '30 d', ms: 30 * 86_400_000 },
];

const toLocal = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function TimewindowPicker({ value, onChange }: { value: Timewindow; onChange: (t: Timewindow) => void }) {
  return (
    <div role="group" aria-label="Time window" className="flex flex-wrap items-center gap-1">
      {PRESETS.map((p) => (
        <Button
          key={p.label}
          size="sm"
          variant={value.kind === 'relative' && value.lastMs === p.ms ? 'default' : 'outline'}
          onClick={() => onChange({ kind: 'relative', lastMs: p.ms })}
        >
          {p.label}
        </Button>
      ))}
      <Button
        size="sm"
        variant={value.kind === 'absolute' ? 'default' : 'outline'}
        onClick={() => value.kind === 'relative' && onChange({ kind: 'absolute', fromMs: Date.now() - value.lastMs, toMs: Date.now() })}
      >
        Custom
      </Button>
      {value.kind === 'absolute' && (
        <>
          <Input aria-label="From" type="datetime-local" className="h-8 w-48" value={toLocal(value.fromMs)} onChange={(e) => onChange({ ...value, fromMs: new Date(e.target.value).getTime() })} />
          <Input aria-label="To" type="datetime-local" className="h-8 w-48" value={toLocal(value.toMs)} onChange={(e) => onChange({ ...value, toMs: new Date(e.target.value).getTime() })} />
        </>
      )}
    </div>
  );
}
