import type { BrandingDto } from '@perspice/shared';
import Handlebars from 'handlebars';
import mjml2html from 'mjml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMAIL_SUBJECTS, type EmailTemplateKey } from './templates';

const TEMPLATE_DIR = join(__dirname, 'templates');
const fileCache = new Map<string, string>();

function templateFile(name: string): string {
  let content = fileCache.get(name);
  if (content === undefined) {
    content = readFileSync(join(TEMPLATE_DIR, `${name}.mjml`), 'utf8');
    fileCache.set(name, content);
  }
  return content;
}

export interface TemplateOverride {
  subject: string;
  bodyMjml: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x3D;/g, '=')
    .replace(/&#x60;/g, '`')
    .replace(/&amp;/g, '&');

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
        const text = label.replace(/<[^>]+>/g, '').trim();
        return text && text !== href ? `${text}: ${href}` : href;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

export async function renderTemplate(
  key: EmailTemplateKey,
  vars: Record<string, unknown>,
  branding: BrandingDto,
  override?: TemplateOverride | null,
): Promise<RenderedEmail> {
  const ctx = { ...vars, productName: branding.productName, branding };
  const subject = Handlebars.compile(override?.subject ?? EMAIL_SUBJECTS[key])(ctx);
  const body = Handlebars.compile(override?.bodyMjml ?? templateFile(key))(ctx);
  const mjml = Handlebars.compile(templateFile('layout'))({ ...ctx, subject, body });
  const { html, errors } = await mjml2html(mjml, { validationLevel: 'soft' });
  if (errors.length && !html) throw new Error(`MJML render failed for ${key}: ${errors[0]?.message}`);
  return { subject, html, text: htmlToText(html) };
}
