import * as LabelPrimitive from '@radix-ui/react-label';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Label = forwardRef<HTMLLabelElement, ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn('text-[13px] font-medium leading-none text-fg-2', className)} {...props} />
));
Label.displayName = 'Label';
