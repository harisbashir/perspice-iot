import type { WidgetDataResult } from '@perspice/shared';
import type { ReactNode } from 'react';

/** Loading / error / empty states shared by widgets; renders children when data is ready. */
export function WidgetStatus({ result, empty, children }: { result: WidgetDataResult | undefined; empty?: boolean; children: ReactNode }) {
  if (!result) return <div className="h-full w-full animate-pulse rounded-lg bg-fill" aria-label="Loading" />;
  if (!result.ok) {
    return (
      <div role="alert" className="flex h-full items-center justify-center p-2 text-center text-xs text-crit">
        {result.code === 'NOT_FOUND' ? 'Data source not available' : result.message}
      </div>
    );
  }
  if (empty) return <div className="flex h-full items-center justify-center text-xs text-fg-muted">No data</div>;
  return <>{children}</>;
}
