import { z } from 'zod';

/** UI metadata carried in a zod schema's description, read back by AutoForm. */
export interface FieldMeta {
  label: string;
  hint?: 'color' | 'textarea' | 'key';
  help?: string;
}

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const meta = (m: FieldMeta) => JSON.stringify(m);

export function readMeta(schema: z.ZodTypeAny): FieldMeta | undefined {
  let s: z.ZodTypeAny | undefined = schema;
  while (s) {
    if (s.description) {
      try {
        return JSON.parse(s.description) as FieldMeta;
      } catch {
        return { label: s.description };
      }
    }
    s = s instanceof z.ZodDefault || s instanceof z.ZodOptional || s instanceof z.ZodNullable ? s._def.innerType : undefined;
  }
  return undefined;
}

/** Settings field builders: `z.object({ decimals: field.number('Decimals', { min: 0 }).default(1) })`. */
export const field = {
  text: (label: string, opts: { max?: number; help?: string } = {}) =>
    z.string().max(opts.max ?? 200).describe(meta({ label, help: opts.help })),
  textarea: (label: string, opts: { max?: number; help?: string } = {}) =>
    z.string().max(opts.max ?? 20_000).describe(meta({ label, hint: 'textarea', help: opts.help })),
  number: (label: string, opts: { min?: number; max?: number; int?: boolean; help?: string } = {}) => {
    let n = opts.int ? z.number().int() : z.number();
    if (opts.min !== undefined) n = n.min(opts.min, `Must be at least ${opts.min}`);
    if (opts.max !== undefined) n = n.max(opts.max, `Must be at most ${opts.max}`);
    return n.describe(meta({ label, help: opts.help }));
  },
  boolean: (label: string, help?: string) => z.boolean().describe(meta({ label, help })),
  select: <T extends string>(label: string, options: readonly [T, ...T[]], help?: string) =>
    z.enum(options).describe(meta({ label, help })),
  multi: <T extends string>(label: string, options: readonly [T, ...T[]], help?: string) =>
    z.array(z.enum(options)).describe(meta({ label, help })),
  color: (label: string, help?: string) => z.string().regex(HEX_COLOR, 'Use a colour like #1D4ED8').describe(meta({ label, hint: 'color', help })),
  /** A telemetry key; the builder offers the profile's keys. */
  key: (label: string, help?: string) => z.string().max(64).describe(meta({ label, hint: 'key', help })),
};
