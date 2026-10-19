import { useQuery } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { renderHelp } from '@/help/render';
import { useHelpArticles } from '@/help/useHelp';
import { NotFoundPage } from '../NotFoundPage';

// One chunk per article, loaded when it is opened.
const CONTENT = import.meta.glob('../../help/content/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

export function HelpArticlePage() {
  const { slug = '' } = useParams();
  const { articles, platform } = useHelpArticles();
  const navigate = useNavigate();
  const article = articles.find((a) => a.slug === slug);
  const load = CONTENT[`../../help/content/${slug}.md`];
  const { data: html } = useQuery({
    queryKey: ['help', slug, platform],
    queryFn: async () => renderHelp(await load!(), { platform }),
    enabled: !!article && !!load,
    staleTime: Infinity,
  });
  if (!article || !load) return <NotFoundPage />;

  // Links to other app pages navigate in place; external ones open in a new tab.
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href) return;
    if (href.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    } else if (/^https?:/.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  };

  return (
    <article className="max-w-3xl">
      <Link to="/help" className="text-sm text-primary-700 hover:underline dark:text-primary-300">
        ← Help
      </Link>
      <h1 className="mb-1 mt-1 text-2xl font-semibold">{article.title}</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">{article.summary}</p>
      {html === undefined ? (
        <Skeleton className="h-64" />
      ) : (
        // Trusted content from the app itself, sanitised all the same.
        <div className="help-article" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </article>
  );
}
