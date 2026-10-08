import { type ReactNode, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** Signed-in layout. A super admin without 2FA is sent to enrol first (the API requires it). */
export function AppShell({ topbarActions }: { topbarActions?: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  if (user?.roleKey === 'super_admin' && !user.totpEnabled && location.pathname !== '/settings/profile') {
    return <Navigate to="/settings/profile" replace state={{ enrolTotp: true }} />;
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-60 border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-950 md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setOpen(true)} actions={topbarActions} />
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
