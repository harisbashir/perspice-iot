import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-lg border border-line-strong bg-surface px-3 py-1 text-sm text-fg placeholder:text-fg-muted/80 focus-visible:border-primary-500 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-crit touch:h-11 dark:bg-surface-2/50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
