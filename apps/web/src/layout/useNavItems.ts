import { useAuth } from '@/auth/AuthProvider';
import { useAlarmFeed, useAlarmSummary } from '@/alarms/hooks';
import { NAV_ITEMS } from './nav';

/** The navigation the signed-in user may see, and the unacknowledged-alarm count for its badge. */
export function useNavItems() {
  const { user, hasPerm } = useAuth();
  const alarms = useAlarmSummary();
  useAlarmFeed();
  const items = NAV_ITEMS.filter((i) => (!i.perm || hasPerm(i.perm)) && (!i.platformOnly || user?.scopeType === 'platform'));
  return { items, unacked: alarms.data?.unacknowledged ?? 0 };
}
