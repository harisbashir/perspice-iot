import type { CommandDef } from '@perspice/shared';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function SchemaInput({ value, onChange }: { value?: Record<string, unknown>; onChange: (v?: Record<string, unknown>) => void }) {
  const [text, setText] = useState(value ? JSON.stringify(value, null, 2) : '');
  const [invalid, setInvalid] = useState(false);
  return (
    <div>
      <textarea
        aria-label="Parameter schema (JSON Schema)"
        rows={3}
        placeholder='{"type":"object","properties":{"seconds":{"type":"integer"}}}'
        className="w-full rounded-md border border-slate-300 bg-transparent p-2 font-mono text-xs dark:border-slate-700"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setInvalid(false);
            return onChange(undefined);
          }
          try {
            onChange(JSON.parse(e.target.value) as Record<string, unknown>);
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid && <p className="text-xs text-red-600">Not valid JSON yet.</p>}
    </div>
  );
}

export function CommandsEditor({ value, onChange }: { value: CommandDef[]; onChange: (v: CommandDef[]) => void }) {
  const update = (i: number, patch: Partial<CommandDef>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-3">
      {value.map((c, i) => (
        <div key={i} className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <div className="grid grid-cols-[1fr_1fr_auto_36px] items-center gap-2">
            <Input aria-label="Command name" className="h-8 text-xs" value={c.name} onChange={(e) => update(i, { name: e.target.value })} />
            <Input aria-label="Command label" className="h-8 text-xs" value={c.label} onChange={(e) => update(i, { label: e.target.value })} />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={c.confirm} onChange={(e) => update(i, { confirm: e.target.checked })} /> Confirm
            </label>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${c.name || 'command'}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <SchemaInput value={c.paramsSchema} onChange={(paramsSchema) => update(i, { paramsSchema })} />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { name: '', label: '', confirm: false }])}>
        Add command
      </Button>
    </div>
  );
}
