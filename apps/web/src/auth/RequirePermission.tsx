import type { Permission } from '@perspice/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';

/** Redirects to /login when signed out; renders a 403 message without the permission. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, signedOut } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8 text-sm text-fg-muted">Loading…</div>;
  // After an expired session, signing in returns to this page; after signing out, to the overview.
  if (!user) return <Navigate to="/login" replace state={signedOut ? null : { from: location.pathname }} />;
  return <>{children}</>;
}

export function RequirePermission({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { hasPerm } = useAuth();
  if (!hasPerm(perm)) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Not allowed</h1>
        <p className="mt-2 text-sm text-fg-muted">You don't have access to this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}
