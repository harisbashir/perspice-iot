import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { BrandingEdit } from '@/api/types';
import { BrandingEditor } from '@/components/BrandingEditor';
import { Skeleton } from '@/components/ui/skeleton';

export function CustomerBrandingForm({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['customers', customerId, 'branding'],
    queryFn: () => api<BrandingEdit>(`/customers/${customerId}/branding`),
  });
  if (!data) return <Skeleton className="h-64" />;
  return (
    <BrandingEditor
      overrides={data.overrides}
      effective={data.effective}
      onSave={async (patch) => {
        await api(`/customers/${customerId}/branding`, { method: 'PUT', body: patch });
        await qc.invalidateQueries({ queryKey: ['customers', customerId, 'branding'] });
        await qc.invalidateQueries({ queryKey: ['public', 'branding'] });
      }}
    />
  );
}
