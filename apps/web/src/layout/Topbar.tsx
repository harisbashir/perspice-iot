import { CircleHelp, LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { type Appearance, getAppearance, setAppearance } from '@/branding/applyTheme';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { articleForPath } from '@/help/articles';
import { useHelpArticles } from '@/help/useHelp';
import { Brand } from './Brand';
import { NotificationsBell } from './NotificationsBell';

const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** The translucent bar over the page: the brand on phones (the sidebar has it on desktop), help, notifications, account. */
export function Topbar({ actions, showBrand }: { actions?: ReactNode; showBrand: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { articles } = useHelpArticles();
  const article = articleForPath(pathname, articles);
  const [appearance, setMode] = useState<Appearance>(getAppearance);
  return (
    <header className="glass sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-line/70 px-3 pt-[env(safe-area-inset-top)] sm:px-4 lg:px-6">
      {showBrand ? <Brand className="mr-auto" /> : <div className="flex-1" />}
      {actions}
      <Button variant="ghost" size="icon" className="rounded-full" asChild>
        {/* One fixed name: a page-dependent one ("Help: Alarm rules") would clash with the page's own links. */}
        <Link to={article ? `/help/${article.slug}` : '/help'} aria-label="Help for this page" title={article ? `Help: ${article.title}` : 'Help'}>
          <CircleHelp className="h-5 w-5" />
        </Link>
      </Button>
      <NotificationsBell />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="ml-1 gap-2 rounded-full pl-1 pr-1 sm:pr-3" aria-label="Account menu">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-primary-400 to-primary-700 text-[11px] font-semibold text-white">
              {initials(user?.name)}
            </span>
            <span className="hidden max-w-[10rem] truncate sm:inline">{user?.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate('/settings/profile')}>
            <UserRound className="h-4 w-4" /> My profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={appearance}
            onValueChange={(v) => {
              setAppearance(v as Appearance);
              setMode(v as Appearance);
            }}
          >
            <DropdownMenuRadioItem value="system" onSelect={(e) => e.preventDefault()}>
              <Monitor className="h-4 w-4" /> Match system
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light" onSelect={(e) => e.preventDefault()}>
              <Sun className="h-4 w-4" /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" onSelect={(e) => e.preventDefault()}>
              <Moon className="h-4 w-4" /> Dark
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
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
