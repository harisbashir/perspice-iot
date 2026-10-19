import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/**
 * An inset grouped list, the phone stand-in for a table (HIG › Lists and tables): one tappable row
 * per item, at least 44 px tall, with the item's title, a secondary line and a trailing accessory.
 */
export function ListRows({ children, empty, className }: { children: ReactNode; empty?: ReactNode; className?: string }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <ul className={cn('overflow-hidden rounded-xl bg-surface shadow-card', className)}>
      {items.length ? items : <li className="px-4 py-8 text-center text-sm text-fg-muted">{empty}</li>}
    </ul>
  );
}

export function ListRow({
  to,
  leading,
  title,
  subtitle,
  trailing,
  footer,
}: {
  to?: string;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  /** Controls under the row (buttons); they sit outside the link. */
  footer?: ReactNode;
}) {
  const body = (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[13px] text-fg-muted">{subtitle}</div>}
      </div>
      {trailing}
      {to && <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-muted/70" />}
    </>
  );
  return (
    <li className="border-b border-line last:border-0">
      {to ? (
        <Link to={to} className="flex min-h-11 items-center gap-3 px-4 py-2.5 active:bg-fill">
          {body}
        </Link>
      ) : (
        <div className="flex min-h-11 items-center gap-3 px-4 py-2.5">{body}</div>
      )}
      {footer && <div className="flex flex-wrap gap-2 px-4 pb-3">{footer}</div>}
    </li>
  );
}
