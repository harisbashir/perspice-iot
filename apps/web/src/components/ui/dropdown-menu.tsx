import * as Menu from '@radix-ui/react-dropdown-menu';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export const DropdownMenuContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Menu.Content>>(
  ({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn('z-50 min-w-[12rem] max-w-[calc(100vw-1rem)] animate-fade-in rounded-xl bg-surface p-1.5 shadow-float dark:bg-surface-2', className)}
        {...props}
      />
    </Menu.Portal>
  ),
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

const itemClass = 'flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none focus:bg-fill touch:py-2.5 data-[disabled]:opacity-40';

export const DropdownMenuItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Menu.Item>>(({ className, ...props }, ref) => (
  <Menu.Item ref={ref} className={cn(itemClass, className)} {...props} />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuRadioItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Menu.RadioItem>>(({ className, children, ...props }, ref) => (
  <Menu.RadioItem ref={ref} className={cn(itemClass, 'pr-8', className)} {...props}>
    {children}
    <Menu.ItemIndicator className="absolute right-3 text-primary-600 dark:text-primary-300">✓</Menu.ItemIndicator>
  </Menu.RadioItem>
));
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';

export const DropdownMenuLabel = ({ className, ...p }: ComponentPropsWithoutRef<typeof Menu.Label>) => (
  <Menu.Label className={cn('truncate px-2.5 py-1.5 text-xs font-medium text-fg-muted', className)} {...p} />
);
export const DropdownMenuSeparator = () => <Menu.Separator className="mx-1 my-1 h-px bg-line" />;
