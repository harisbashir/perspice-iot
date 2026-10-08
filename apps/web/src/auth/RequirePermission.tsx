import type { Permission } from '@perspice/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';

/** Redirects to /login when signed out; renders a 403 message without the permission. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function RequirePermission({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { hasPerm } = useAuth();
  if (!hasPerm(perm)) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Not allowed</h1>
        <p className="mt-2 text-sm text-slate-500">You don't have access to this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}
