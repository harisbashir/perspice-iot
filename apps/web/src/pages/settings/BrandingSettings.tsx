import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { BrandingEdit } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { BrandingEditor } from '@/components/BrandingEditor';
import { Skeleton } from '@/components/ui/skeleton';
import { CustomerBrandingForm } from '../customers/CustomerBrandingForm';

/** Platform users edit the platform branding; customer admins edit their own customer's. */
export function BrandingSettings() {
  const { user } = useAuth();
  if (user?.scopeType === 'customer') return <CustomerBrandingForm customerId={user.customerId!} />;
  return <PlatformBranding />;
}

function PlatformBranding() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['branding', 'platform'], queryFn: () => api<BrandingEdit>('/branding/platform') });
  if (!data) return <Skeleton className="h-64" />;
  return (
    <BrandingEditor
      overrides={data.overrides}
      effective={data.effective}
      onSave={async (patch) => {
        await api('/branding/platform', { method: 'PUT', body: patch });
        await qc.invalidateQueries({ queryKey: ['branding', 'platform'] });
        await qc.invalidateQueries({ queryKey: ['public', 'branding'] });
      }}
    />
  );
}
