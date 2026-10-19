import { type ReactNode, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { followSystemAppearance } from '@/branding/applyTheme';
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/useMediaQuery';
import { MaintenanceBanner } from './MaintenanceBanner';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { Topbar } from './Topbar';

/**
 * Signed-in layout: a sidebar from lg (1024 px) up, a bottom tab bar below it. Only one of the two
 * is rendered, so screen readers and tests never meet the navigation twice. A super admin without
 * 2FA is sent to enrol first (the API requires it).
 */
export function AppShell({ topbarActions }: { topbarActions?: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  useEffect(followSystemAppearance, []);
  // Each page starts at the top, as on a native app (the browser keeps the old offset otherwise).
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [location.pathname]);

  if (user?.roleKey === 'super_admin' && !user.totpEnabled && location.pathname !== '/settings/profile') {
    return <Navigate to="/settings/profile" replace state={{ enrolTotp: true }} />;
  }

  return (
    <div className="min-h-dvh overflow-x-clip lg:pl-60">
      {desktop && (
        <aside className="fixed inset-y-0 left-0 z-40 w-60 border-r border-line bg-surface">
          <Sidebar />
        </aside>
      )}
      <Topbar actions={topbarActions} showBrand={!desktop} />
      <MaintenanceBanner />
      <main className="mx-auto w-full max-w-[1600px] px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7">
        <Outlet />
      </main>
      {!desktop && <TabBar />}
    </div>
  );
}
