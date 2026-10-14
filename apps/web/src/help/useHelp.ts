import { useMemo } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { visibleArticles } from './articles';

/** The help articles the signed-in user may read. */
export function useHelpArticles() {
  const { user, hasPerm } = useAuth();
  const scope = user?.scopeType ?? 'customer';
  return { articles: useMemo(() => visibleArticles(scope, hasPerm), [scope, hasPerm]), platform: scope === 'platform' };
}
