import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** A grouped surface on the canvas; it separates itself by colour and a soft shadow, not a border. */
export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('card min-w-0 rounded-xl bg-surface shadow-card', className)} {...p} />;
export const CardHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1 p-4 sm:p-5', className)} {...p} />
);
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-[17px] font-semibold leading-tight', className)} {...p} />
);
export const CardDescription = ({ className, ...p }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-[13px] text-fg-muted', className)} {...p} />
);
export const CardContent = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('p-4 pt-0 sm:p-5 sm:pt-0', className)} {...p} />;
export const CardFooter = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center p-4 pt-0 sm:p-5 sm:pt-0', className)} {...p} />
);
