import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'bg-primary-500/10 text-primary-700 dark:bg-primary-400/15 dark:text-primary-200',
      secondary: 'bg-fill text-fg-2',
      success: 'bg-ok-tint text-ok',
      warning: 'bg-warn-tint text-warn',
      danger: 'bg-crit-tint text-crit',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...p }: BadgeProps) => <span className={cn(badgeVariants({ variant }), className)} {...p} />;
