import { ChevronRight, Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { NavBadge } from './NavBadge';
import { NAV_GROUPS, isActivePath } from './nav';
import { useNavItems } from './useNavItems';

const tabClass = 'relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[10px] font-medium';

/**
 * Phone and tablet navigation (below lg): a translucent tab bar for the sections people check most,
 * and a More tab holding the rest in a sheet. A More tab is a compromise (HIG › Tab bars), but the
 * app has up to 17 sections; the sheet lists them in the sidebar's groups so they stay findable.
 */
export function TabBar() {
  const { items, unacked } = useNavItems();
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  const tabs = items.filter((i) => i.tab);
  const rest = items.filter((i) => !i.tab);
  const inMore = rest.some((i) => isActivePath(i.to, pathname));

  return (
    <>
      <nav aria-label="Tab bar" className="glass fixed inset-x-0 bottom-0 z-40 border-t border-line/70 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex h-[3.25rem] max-w-xl">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cn(tabClass, isActive ? 'text-primary-600 dark:text-primary-300' : 'text-fg-muted')}>
              <span className="relative">
                <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} />
                {to === '/alarms' && <NavBadge count={unacked} className="absolute -right-3 -top-1.5" />}
              </span>
              {label}
            </NavLink>
          ))}
          {rest.length > 0 && (
            <button type="button" className={cn(tabClass, inMore ? 'text-primary-600 dark:text-primary-300' : 'text-fg-muted')} aria-haspopup="dialog" onClick={() => setMore(true)}>
              <Ellipsis className="h-[22px] w-[22px]" strokeWidth={1.9} />
              More
            </button>
          )}
        </div>
      </nav>
      <Dialog open={more} onOpenChange={setMore}>
        <DialogContent className="gap-5 bg-canvas sm:max-w-md dark:bg-canvas">
          <DialogTitle>More</DialogTitle>
          {NAV_GROUPS.map((g) => {
            const group = rest.filter((i) => i.group === g.id);
            if (!group.length) return null;
            return (
              <section key={g.id} aria-label={g.label ?? undefined}>
                {g.label && <h3 className="px-4 pb-1.5 text-[13px] font-medium uppercase tracking-wide text-fg-muted">{g.label}</h3>}
                <ul className="overflow-hidden rounded-xl bg-surface">
                  {group.map(({ to, label, icon: Icon }) => (
                    <li key={to} className="border-b border-line last:border-0">
                      <Link
                        to={to}
                        onClick={() => setMore(false)}
                        aria-current={isActivePath(to, pathname) ? 'page' : undefined}
                        className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-[15px] active:bg-fill aria-[current=page]:font-semibold aria-[current=page]:text-primary-700 dark:aria-[current=page]:text-primary-300"
                      >
                        <span className="grid h-7 w-7 place-items-center rounded-md bg-primary-600 text-white">
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <span className="flex-1">{label}</span>
                        <ChevronRight className="h-4 w-4 text-fg-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </DialogContent>
      </Dialog>
    </>
  );
}
