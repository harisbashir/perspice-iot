import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { readMeta } from './fields';

type Shape = Record<string, z.ZodTypeAny>;

const unwrap = (s: z.ZodTypeAny): z.ZodTypeAny =>
  s instanceof z.ZodDefault || s instanceof z.ZodOptional || s instanceof z.ZodNullable ? unwrap(s._def.innerType) : s;

const inputClass =
  'h-8 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700 aria-[invalid=true]:border-red-500';

export interface AutoFormProps<T extends Record<string, unknown>> {
  schema: z.ZodObject<Shape>;
  value: T;
  onChange: (value: T) => void;
  /** Suggestions for `field.key` inputs (the profile's telemetry keys). */
  keys?: string[];
}

/**
 * Renders a settings form from a widget's zod schema. Changes are emitted only when the whole
 * object is valid; field errors show the zod message.
 */
export function AutoForm<T extends Record<string, unknown>>({ schema, value, onChange, keys = [] }: AutoFormProps<T>) {
  const [draft, setDraft] = useState<Record<string, unknown>>(value);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const base = useId();

  useEffect(() => setDraft(value), [value]);

  function update(name: string, v: unknown) {
    const next = { ...draft, [name]: v };
    setDraft(next);
    const parsed = schema.safeParse(next);
    if (parsed.success) {
      setErrors({});
      onChange(parsed.data as T);
    } else {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
      setErrors(errs);
    }
  }

  return (
    <div className="space-y-3">
      {Object.entries(schema.shape).map(([name, fieldSchema]) => {
        const inner = unwrap(fieldSchema);
        const meta = readMeta(fieldSchema) ?? { label: name };
        const id = `${base}-${name}`;
        const err = errors[name];
        const v = draft[name];
        const common = { id, 'aria-invalid': !!err, 'aria-describedby': err || meta.help ? `${id}-msg` : undefined };
        let control: JSX.Element;
        if (inner instanceof z.ZodBoolean) {
          control = <input {...common} type="checkbox" checked={!!v} onChange={(e) => update(name, e.target.checked)} />;
        } else if (inner instanceof z.ZodEnum) {
          control = (
            <select {...common} className={inputClass} value={String(v ?? '')} onChange={(e) => update(name, e.target.value)}>
              {(inner.options as string[]).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        } else if (inner instanceof z.ZodArray && unwrap(inner.element) instanceof z.ZodEnum) {
          const options = (unwrap(inner.element) as z.ZodEnum<[string, ...string[]]>).options;
          const selected = Array.isArray(v) ? (v as string[]) : [];
          control = (
            <div id={id} role="group" aria-label={meta.label} className="flex flex-wrap gap-3">
              {options.map((o) => (
                <label key={o} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(o)}
                    onChange={(e) => update(name, e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))}
                  />
                  {o}
                </label>
              ))}
            </div>
          );
        } else if (inner instanceof z.ZodNumber) {
          control = (
            <input
              {...common}
              type="number"
              className={inputClass}
              value={v === undefined || v === null ? '' : String(v)}
              onChange={(e) => update(name, e.target.value === '' ? undefined : Number(e.target.value))}
            />
          );
        } else if (meta.hint === 'color') {
          control = (
            <div className="flex items-center gap-2">
              <input type="color" aria-hidden tabIndex={-1} value={String(v ?? '#000000')} onChange={(e) => update(name, e.target.value.toUpperCase())} />
              <input {...common} className={inputClass} value={String(v ?? '')} onChange={(e) => update(name, e.target.value)} />
            </div>
          );
        } else if (meta.hint === 'textarea') {
          control = (
            <textarea {...common} rows={5} className={`${inputClass} h-auto py-1 font-mono`} value={String(v ?? '')} onChange={(e) => update(name, e.target.value)} />
          );
        } else {
          const listId = meta.hint === 'key' ? `${id}-keys` : undefined;
          control = (
            <>
              <input {...common} list={listId} className={inputClass} value={String(v ?? '')} onChange={(e) => update(name, e.target.value)} />
              {listId && (
                <datalist id={listId}>
                  {keys.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              )}
            </>
          );
        }
        const isCheckbox = inner instanceof z.ZodBoolean;
        return (
          <div key={name} className={isCheckbox ? 'flex items-center gap-2' : 'space-y-1'}>
            {isCheckbox && control}
            {!(inner instanceof z.ZodArray) && (
              <label htmlFor={id} className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {meta.label}
              </label>
            )}
            {inner instanceof z.ZodArray && <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{meta.label}</span>}
            {!isCheckbox && control}
            {err ? (
              <p id={`${id}-msg`} role="alert" className="text-xs text-red-600">
                {err}
              </p>
            ) : meta.help ? (
              <p id={`${id}-msg`} className="text-xs text-slate-500">
                {meta.help}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
