import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-100',
      secondary: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
      success: 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200',
      warning: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
      danger: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...p }: BadgeProps) => <span className={cn(badgeVariants({ variant }), className)} {...p} />;
