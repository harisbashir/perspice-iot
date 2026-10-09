import { Suspense, lazy } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardViewProps } from './DashboardView';

// The widget library (charts, markdown, grid) is only loaded when a dashboard is shown.
const DashboardView = lazy(() => import('./DashboardView').then((m) => ({ default: m.DashboardView })));

export function LazyDashboardView(props: DashboardViewProps) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <DashboardView {...props} />
    </Suspense>
  );
}
