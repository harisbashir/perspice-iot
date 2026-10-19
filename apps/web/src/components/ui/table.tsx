import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** A data table on a card; it scrolls sideways inside the card when the screen is narrower than it. */
export const Table = ({ className, ...p }: HTMLAttributes<HTMLTableElement>) => (
  <div className="table-card w-full overflow-x-auto rounded-xl bg-surface shadow-card">
    <table className={cn('w-full caption-bottom text-sm', className)} {...p} />
  </div>
);
export const TableHeader = (p: HTMLAttributes<HTMLTableSectionElement>) => <thead className="[&_tr]:border-b [&_tr]:hover:bg-transparent" {...p} />;
export const TableBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody className="[&_tr:last-child]:border-0" {...p} />;
export const TableRow = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('border-b border-line transition-colors hover:bg-fill/50', className)} {...p} />
);
export const TableHead = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn('h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-medium text-fg-muted first:pl-4 last:pr-4', className)} {...p} />
);
export const TableCell = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('px-3 py-2.5 align-middle first:pl-4 last:pr-4', className)} {...p} />
);
