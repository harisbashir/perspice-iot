import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';
import { Brand } from './Brand';
import { NavBadge } from './NavBadge';
import { NAV_GROUPS } from './nav';
import { useNavItems } from './useNavItems';

/** Desktop navigation (lg and up): grouped sections, the current one tinted in the brand colour. */
export function Sidebar() {
  const { items, unacked } = useNavItems();
  return (
    <nav aria-label="Main" className="flex h-full flex-col overflow-y-auto px-3 pb-4">
      <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center bg-surface px-2">
        <Brand />
      </div>
      {NAV_GROUPS.map((g) => {
        const group = items.filter((i) => i.group === g.id);
        if (!group.length) return null;
        return (
          <div key={g.id} className={cn('mt-3 flex flex-col gap-px', g.id === 'app' && 'mt-auto pt-3')}>
            {g.label && <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{g.label}</div>}
            {group.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-fg-2 transition-colors hover:bg-fill',
                    isActive && 'bg-primary-500/10 text-primary-700 hover:bg-primary-500/15 dark:bg-primary-400/15 dark:text-primary-200',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary-600 dark:text-primary-300' : 'text-fg-muted group-hover:text-fg-2')} strokeWidth={2} />
                    <span className="truncate">{label}</span>
                    {to === '/alarms' && <NavBadge count={unacked} className="ml-auto" />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
