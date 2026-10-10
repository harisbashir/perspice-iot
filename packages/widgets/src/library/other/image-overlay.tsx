import { Image } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { formatValue, keyDef } from '../../data/format';
import { dataOf, isLatest } from '../../data/result';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';

/** Only uploaded branding assets or https images (no http:, data: or javascript: URLs). */
export const isSafeImageUrl = (url: string) => url.startsWith('/api/public/assets/') || /^https:\/\/[^\s"'<>]+$/i.test(url);

const schema = z.object({
  imageUrl: field
    .text('Image URL', { max: 2000, help: 'An uploaded asset or an https:// address' })
    .refine(isSafeImageUrl, 'Use an uploaded image or an https:// URL')
    .optional(),
  labels: field.textarea('Value labels (JSON)', { help: '[{"key":"fuel_level","x":25,"y":40}] — x and y in % of the image' }).default('[]'),
});
type Settings = z.infer<typeof schema>;

const Label = z.object({ key: z.string().max(64), x: z.number().min(0).max(100), y: z.number().min(0).max(100) });

export function parseLabels(text: string): z.infer<typeof Label>[] {
  try {
    const parsed = z.array(Label).max(50).safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export const imageOverlay: WidgetDefinition<Settings> = {
  type: 'image-overlay',
  name: 'Image with values',
  description: 'A site photo or schematic with live values placed on it (SCADA style).',
  icon: Image,
  category: 'other',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 0, max: 50 } },
  defaultSize: { w: 6, h: 8 },
  Component: ({ config, settings, result, profile }) => {
    const data = dataOf(result);
    const labels = useMemo(() => parseLabels(settings.labels), [settings.labels]);
    if (!settings.imageUrl || !isSafeImageUrl(settings.imageUrl)) {
      return <div className="flex h-full items-center justify-center text-xs text-slate-500">Choose an image in the widget settings</div>;
    }
    return (
      <div className="relative h-full w-full">
        <img src={settings.imageUrl} alt={config.title ?? ''} className="h-full w-full object-contain" />
        {labels.map((l, i) => (
          <span
            key={`${l.key}-${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-slate-900/80 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums"
            style={{ left: `${l.x}%`, top: `${l.y}%` }}
          >
            {formatValue(isLatest(data) ? data.values[l.key]?.v : undefined, keyDef(profile, l.key))}
          </span>
        ))}
      </div>
    );
  },
};
