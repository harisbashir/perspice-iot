import DOMPurify from 'dompurify';
import { FileText } from 'lucide-react';
import { marked } from 'marked';
import { useMemo } from 'react';
import { z } from 'zod';
import { formatValue, keyDef } from '../../data/format';
import { dataOf, isLatest } from '../../data/result';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';

const schema = z.object({
  content: field.textarea('Content (Markdown)', { help: 'Use {{key}} to insert the latest value of a key' }).default('**Notes**'),
});
type Settings = z.infer<typeof schema>;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let hooked = false;
function purifier() {
  if (!hooked) {
    // Links open safely in a new tab; DOMPurify already drops javascript: URLs and event handlers.
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    hooked = true;
  }
  return DOMPurify;
}

/** Markdown → sanitised HTML; `{{key}}` placeholders are replaced with escaped values first. */
export function renderMarkdown(content: string, values: Record<string, string>): string {
  const filled = content.replace(/\{\{\s*([A-Za-z0-9_.-]{1,64})\s*\}\}/g, (_m, k: string) => escapeHtml(values[k] ?? '—'));
  const html = marked.parse(filled, { async: false, gfm: true, breaks: true }) as string;
  return purifier().sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'object', 'embed'] });
}

export const markdownCard: WidgetDefinition<Settings> = {
  type: 'markdown',
  name: 'Text / Markdown',
  description: 'Formatted text, optionally showing live values with {{key}}.',
  icon: FileText,
  category: 'other',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['none', 'currentDevice', 'device'] },
  defaultSize: { w: 4, h: 4 },
  Component: ({ settings, result, profile }) => {
    const data = dataOf(result);
    const html = useMemo(() => {
      const values = isLatest(data)
        ? Object.fromEntries(Object.entries(data.values).map(([k, lv]) => [k, formatValue(lv.v, keyDef(profile, k))]))
        : {};
      return renderMarkdown(settings.content, values);
    }, [settings.content, data, profile]);
    return <div className="prose prose-sm h-full max-w-none overflow-auto dark:prose-invert" dangerouslySetInnerHTML={{ __html: html }} />;
  },
};
