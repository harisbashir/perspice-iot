import type { TelemetryKeyDef } from '@perspice/shared';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const cell = 'h-8 text-xs';

export function TelemetryKeysEditor({ value, onChange }: { value: TelemetryKeyDef[]; onChange: (v: TelemetryKeyDef[]) => void }) {
  const update = (i: number, patch: Partial<TelemetryKeyDef>) => onChange(value.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_1fr_80px_110px_80px_36px] gap-2 text-xs font-medium text-slate-500">
        <span>Key</span>
        <span>Label</span>
        <span>Unit</span>
        <span>Type</span>
        <span>Decimals</span>
        <span />
      </div>
      {value.map((k, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_80px_110px_80px_36px] gap-2">
          <Input aria-label="Key" className={cell} value={k.key} onChange={(e) => update(i, { key: e.target.value })} />
          <Input aria-label="Label" className={cell} value={k.label} onChange={(e) => update(i, { label: e.target.value })} />
          <Input aria-label="Unit" className={cell} value={k.unit ?? ''} onChange={(e) => update(i, { unit: e.target.value || undefined })} />
          <select
            aria-label="Type"
            className="h-8 rounded-md border border-slate-300 bg-transparent px-1 text-xs dark:border-slate-700"
            value={k.type}
            onChange={(e) => update(i, { type: e.target.value as TelemetryKeyDef['type'] })}
          >
            <option value="number">number</option>
            <option value="string">string</option>
            <option value="boolean">boolean</option>
            <option value="json">json</option>
          </select>
          <Input
            aria-label="Decimals"
            type="number"
            min={0}
            max={10}
            className={cell}
            value={k.decimals ?? ''}
            onChange={(e) => update(i, { decimals: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${k.key || 'key'}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { key: '', label: '', type: 'number' }])}>
        Add key
      </Button>
    </div>
  );
}
