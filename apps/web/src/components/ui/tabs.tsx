import * as TabsPrimitive from '@radix-ui/react-tabs';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

/** A segmented control; with more tabs than fit, it scrolls sideways instead of wrapping. */
export const TabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(({ className, ...p }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('scroll-row inline-flex h-9 items-center gap-0.5 rounded-[10px] bg-fill p-0.5 touch:h-10', className)} {...p} />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(({ className, ...p }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'h-full shrink-0 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm dark:data-[state=active]:bg-fill-strong',
      className,
    )}
    {...p}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(({ className, ...p }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-4 focus-visible:outline-none', className)} {...p} />
));
TabsContent.displayName = 'TabsContent';
