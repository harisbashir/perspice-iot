import type { ReactNode } from 'react';

/**
 * The page's large title. Actions sit beside it on wide screens and wrap below it on phones;
 * `children` (status lines, breadcrumbs) go under the title.
 */
export function PageHeader({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-6">
      <div className="min-w-0">
        <h1 className="break-words text-[28px] font-bold leading-tight tracking-tight sm:text-[30px]">{title}</h1>
        {description && <p className="mt-1 text-[15px] text-fg-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
