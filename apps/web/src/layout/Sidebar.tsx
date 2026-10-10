import { NavLink } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { useBranding } from '@/branding/BrandingProvider';
import { cn } from '@/lib/utils';
import { useAlarmFeed, useAlarmSummary } from '@/alarms/hooks';
import { NAV_ITEMS } from './nav';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, hasPerm } = useAuth();
  const b = useBranding();
  const alarms = useAlarmSummary();
  useAlarmFeed();
  const unacked = alarms.data?.unacknowledged ?? 0;
  const items = NAV_ITEMS.filter(
    (i) => (!i.perm || hasPerm(i.perm)) && (!i.platformOnly || user?.scopeType === 'platform'),
  );
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 flex h-10 items-center px-2">
        {b.logoLightUrl ? (
          <>
            <img src={b.logoLightUrl} alt={b.productName} className="h-8 dark:hidden" />
            <img src={b.logoDarkUrl ?? b.logoLightUrl} alt="" className="hidden h-8 dark:block" />
          </>
        ) : (
          <span className="text-lg font-bold text-primary-700 dark:text-primary-300">{b.productName}</span>
        )}
      </div>
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              isActive && 'bg-primary-50 text-primary-800 dark:bg-primary-950 dark:text-primary-200',
            )
          }
        >
          <Icon className="h-4 w-4" />
          {label}
          {to === '/alarms' && unacked > 0 && (
            <span aria-label={`${unacked} unacknowledged`} className="ml-auto rounded-full bg-red-600 px-1.5 text-[10px] font-semibold leading-4 text-white">
              {unacked > 99 ? '99+' : unacked}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
