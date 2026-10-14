import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Help articles are Markdown. Blocks between `:::platform` and `:::` are technical notes for
 * platform users: customers never see them, platform users see them set apart.
 */
export function renderHelp(markdown: string, opts: { platform: boolean }): string {
  const withBlocks = markdown.replace(/^:::platform[ \t]*\n([\s\S]*?)^:::[ \t]*$/gm, (_m, body: string) =>
    opts.platform ? `<aside class="help-platform" aria-label="For platform administrators">\n\n${body}\n</aside>\n` : '',
  );
  const html = marked.parse(withBlocks, { async: false, gfm: true }) as string;
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'object', 'embed', 'script'] });
}
