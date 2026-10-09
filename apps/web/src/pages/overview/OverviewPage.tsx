import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { LazyDashboardView as DashboardView } from '@/dashboards/LazyDashboardView';
import { useOverviewDashboard } from '@/dashboards/hooks';
import { ReportButton } from '@/exports/ReportButton';

/**
 * Both portals open on the built-in overview dashboard: live KPI tiles and the device table
 * (platform users also see and filter by customer). Platform admins can change it in the builder.
 */
export function OverviewPage() {
  const { hasPerm } = useAuth();
  const { data: view, isLoading } = useOverviewDashboard();
  if (isLoading) return <Skeleton className="h-64" />;
  return (
    <div>
      <PageHeader title="Overview" />
      {view ? (
        <DashboardView definition={view.definition} toolbar={(ctx) => <ReportButton {...ctx} />} />
      ) : (
        <p className="text-sm text-slate-500">
          No overview dashboard is set up.{' '}
          {hasPerm('dashboard.edit') && (
            <Link className="underline" to="/dashboards">
              Manage dashboards
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
