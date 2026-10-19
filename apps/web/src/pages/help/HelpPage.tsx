import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { HELP_SECTIONS } from '@/help/articles';
import { useHelpArticles } from '@/help/useHelp';

export function HelpPage() {
  const { articles, platform } = useHelpArticles();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = articles.filter((a) => !needle || `${a.title} ${a.summary}`.toLowerCase().includes(needle));
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Help"
        description={
          platform
            ? 'How everything works, for you and for your customers. Articles marked “Platform” and boxed notes inside articles are only shown to platform users.'
            : 'How the platform works and how to use each page. The Help button at the top of every page opens the article for that page.'
        }
      />
      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input aria-label="Search help" placeholder="Search help" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {HELP_SECTIONS.map((s) => {
        const items = shown.filter((a) => a.section === s.id);
        if (!items.length) return null;
        return (
          <section key={s.id} aria-label={s.title} className="mb-8">
            <h2 className="mb-3 text-lg font-semibold">{s.title}</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {items.map((a) => (
                <li key={a.slug}>
                  <Link
                    to={`/help/${a.slug}`}
                    className="block h-full rounded-lg border border-slate-200 p-4 hover:border-primary-400 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {a.title}
                      {a.audience === 'platform' && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Platform</span>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{a.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!shown.length && <p className="text-sm text-slate-500">Nothing matches “{q}”.</p>}
    </div>
  );
}
