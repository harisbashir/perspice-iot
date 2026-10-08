import { LogOut, Menu, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NotificationsBell } from './NotificationsBell';
import { ThemeToggle } from './ThemeToggle';

export function Topbar({ onMenu, actions }: { onMenu: () => void; actions?: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="flex h-14 items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={onMenu}>
        <Menu className="h-5 w-5" />
      </Button>
      <div className="flex-1" />
      {actions}
      <NotificationsBell />
      <ThemeToggle />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Account menu">
            <UserRound className="h-4 w-4" />
            <span className="hidden sm:inline">{user?.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate('/settings/profile')}>
            <UserRound className="h-4 w-4" /> My profile
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void logout().then(() => navigate('/login'));
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
