import * as Menu from '@radix-ui/react-dropdown-menu';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export const DropdownMenuContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Menu.Content>>(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('z-50 min-w-[10rem] rounded-md border border-slate-200 bg-white p-1 shadow-md dark:border-slate-800 dark:bg-slate-900', className)}
        {...props}
      />
    </Menu.Portal>
  ),
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Menu.Item>>(({ className, ...props }, ref) => (
  <Menu.Item
    ref={ref}
    className={cn('flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none focus:bg-slate-100 dark:focus:bg-slate-800', className)}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuLabel = ({ className, ...p }: ComponentPropsWithoutRef<typeof Menu.Label>) => (
  <Menu.Label className={cn('px-2 py-1.5 text-xs font-medium text-slate-500', className)} {...p} />
);
export const DropdownMenuSeparator = () => <Menu.Separator className="my-1 h-px bg-slate-200 dark:bg-slate-800" />;
