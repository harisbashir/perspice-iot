import type { BrandingDto } from '@perspice/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '@/api/client';
import { ContrastBadge } from './ContrastBadge';
import { ErrorText } from './ErrorText';
import { Button } from './ui/button';
import { Field } from './ui/field';
import { Input } from './ui/input';

type Editable = Pick<
  BrandingDto,
  'productName' | 'primaryColor' | 'accentColor' | 'supportEmail' | 'logoLightUrl' | 'logoDarkUrl' | 'faviconUrl' | 'loginBackgroundUrl' | 'customCss'
>;

const ASSET_FIELDS: [keyof Editable, string][] = [
  ['logoLightUrl', 'Logo (light background)'],
  ['logoDarkUrl', 'Logo (dark background)'],
  ['faviconUrl', 'Favicon'],
  ['loginBackgroundUrl', 'Login background'],
];

/**
 * Edits platform or customer branding. `overrides` are the stored values (empty = inherited),
 * `effective` what is shown today; saving sends a merge patch where cleared fields become null.
 */
export function BrandingEditor({
  overrides,
  effective,
  onSave,
}: {
  overrides: Partial<BrandingDto>;
  effective: BrandingDto;
  onSave: (patch: Partial<Record<keyof Editable, string | null>>) => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<Record<keyof Editable, string>>>({});
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v ?? ''])) as Partial<Record<keyof Editable, string>>);
  }, [overrides]);

  const value = (k: keyof Editable) => form[k] ?? '';
  const set = (k: keyof Editable, v: string) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const shown = (k: keyof Editable) => (value(k) || (effective[k] as string | null) || '') as string;

  async function upload(k: keyof Editable, file: File) {
    const body = new FormData();
    body.append('file', file);
    try {
      const { url } = await api<{ url: string }>('/branding/assets', { body });
      set(k, url);
    } catch (e) {
      setError(e);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const patch = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
      await onSave(patch);
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const primary = shown('primaryColor');

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <Field label="Product name" help={`Inherited: ${effective.productName}`}>
          {(id, d) => <Input id={id} aria-describedby={d} value={value('productName')} onChange={(e) => set('productName', e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary colour">
            {(id) => (
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Pick primary colour" value={primary || '#0F766E'} onChange={(e) => set('primaryColor', e.target.value.toUpperCase())} />
                <Input id={id} value={value('primaryColor')} placeholder={effective.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} />
                <ContrastBadge color={primary} />
              </div>
            )}
          </Field>
          <Field label="Accent colour">
            {(id) => (
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Pick accent colour" value={shown('accentColor') || '#F59E0B'} onChange={(e) => set('accentColor', e.target.value.toUpperCase())} />
                <Input id={id} value={value('accentColor')} placeholder={effective.accentColor} onChange={(e) => set('accentColor', e.target.value)} />
              </div>
            )}
          </Field>
        </div>
        <Field label="Support email">
          {(id) => <Input id={id} type="email" value={value('supportEmail')} placeholder={effective.supportEmail ?? ''} onChange={(e) => set('supportEmail', e.target.value)} />}
        </Field>
        {ASSET_FIELDS.map(([k, label]) => (
          <Field key={k} label={label} help="PNG, SVG or ICO up to 1 MB.">
            {(id, d) => (
              <div className="flex items-center gap-2">
                <Input id={id} aria-describedby={d} value={value(k)} placeholder={(effective[k] as string | null) ?? ''} onChange={(e) => set(k, e.target.value)} />
                <label className="cursor-pointer whitespace-nowrap rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
                  Upload
                  <input
                    type="file"
                    accept="image/png,image/svg+xml,image/x-icon,.ico"
                    className="sr-only"
                    onChange={(e) => e.target.files?.[0] && void upload(k, e.target.files[0])}
                  />
                </label>
              </div>
            )}
          </Field>
        ))}
        <Field label="Custom CSS" help="Applied on every page. Remote imports and URLs are removed.">
          {(id, d) => (
            <textarea
              id={id}
              aria-describedby={d}
              rows={4}
              className="w-full rounded-md border border-slate-300 bg-transparent p-2 font-mono text-xs dark:border-slate-700"
              value={value('customCss')}
              onChange={(e) => set('customCss', e.target.value)}
            />
          )}
        </Field>
        <ErrorText error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            Save branding
          </Button>
          {saved && <span className="text-sm text-green-700 dark:text-green-400">Saved</span>}
        </div>
      </div>
      <BrandingPreview productName={value('productName') || effective.productName} primary={primary} logo={shown('logoLightUrl')} />
    </form>
  );
}

function BrandingPreview({ productName, primary, logo }: { productName: string; primary: string; logo: string }) {
  return (
    <div aria-label="Preview" className="h-fit rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <p className="mb-3 text-xs font-medium uppercase text-slate-500">Preview</p>
      <div className="rounded-md border border-slate-200 bg-white p-4 text-slate-900 dark:border-slate-700">
        {logo ? <img src={logo} alt="" className="mb-3 h-8" /> : <div className="mb-3 text-lg font-bold" style={{ color: primary }}>{productName}</div>}
        <div className="mb-3 text-sm">Sign in to {productName}</div>
        <button type="button" className="w-full rounded-md px-3 py-2 text-sm font-medium text-white" style={{ backgroundColor: primary }}>
          Sign in
        </button>
      </div>
    </div>
  );
}
