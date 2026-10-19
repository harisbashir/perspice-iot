import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ComponentPropsWithoutRef, type HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * A sheet that rises from the bottom on phones and a centred panel from `sm` up. Content taller
 * than the screen scrolls inside it; `className` widths (max-w-2xl…) apply from `sm`.
 */
export const DialogContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>(
  ({ className, children, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/40" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] w-full animate-sheet-up gap-4 overflow-y-auto rounded-t-2xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-7 shadow-float dark:bg-surface-2',
          'sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88vh] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:animate-pop-in sm:rounded-2xl sm:p-6',
          className,
        )}
        {...props}
      >
        <span aria-hidden className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-fill-strong sm:hidden" />
        {children}
        <DialogPrimitive.Close
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-fill text-fg-muted hover:bg-fill-strong hover:text-fg"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
DialogContent.displayName = 'DialogContent';

export const DialogHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...p} />;
/** Full-width stacked buttons on phones (primary on top), a right-aligned row from `sm`. */
export const DialogFooter = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto', className)} {...p} />
);
export const DialogTitle = forwardRef<HTMLHeadingElement, ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(({ className, ...p }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-[17px] font-semibold', className)} {...p} />
));
DialogTitle.displayName = 'DialogTitle';
export const DialogDescription = forwardRef<HTMLParagraphElement, ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  ({ className, ...p }, ref) => <DialogPrimitive.Description ref={ref} className={cn('text-sm text-fg-muted', className)} {...p} />,
);
DialogDescription.displayName = 'DialogDescription';
