import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { MAINTENANCE_EVENT, api } from '@/api/client';

/**
 * Shown while a restore runs (the API answers 503 MAINTENANCE). Checks every few seconds and
 * refreshes everything once the platform is back.
 */
export function MaintenanceBanner({ pollMs = 5000 }: { pollMs?: number }) {
  const qc = useQueryClient();
  const [active, setActive] = useState(false);

  useEffect(() => {
    const on = () => setActive(true);
    window.addEventListener(MAINTENANCE_EVENT, on);
    return () => window.removeEventListener(MAINTENANCE_EVENT, on);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void api<{ maintenance: boolean }>('/public/maintenance').then(
        (s) => {
          if (s.maintenance) return;
          setActive(false);
          void qc.invalidateQueries();
        },
        () => undefined,
      );
    }, pollMs);
    return () => clearInterval(timer);
  }, [active, pollMs, qc]);

  if (!active) return null;
  return (
    <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      The platform is being restored from a backup. It will be back in a few minutes; this page refreshes when it is.
    </div>
  );
}
