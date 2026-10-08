import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { SecuritySettingsDto } from '@/api/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function SecuritySettings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings', 'security'], queryFn: () => api<SecuritySettingsDto>('/settings/security') });
  if (!data) return <Skeleton className="h-32" />;
  const update = async (patch: Partial<SecuritySettingsDto>) => {
    qc.setQueryData(['settings', 'security'], await api<SecuritySettingsDto>('/settings/security', { method: 'PUT', body: patch }));
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Security</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={data.enforceTotpForSuperAdmin} onChange={(e) => void update({ enforceTotpForSuperAdmin: e.target.checked })} />
          <span>
            <span className="font-medium">Require two-factor authentication for super admins</span>
            <span className="block text-slate-500">Super admins can only manage their own account until they enrol.</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={data.docsPublic} onChange={(e) => void update({ docsPublic: e.target.checked })} />
          <span>
            <span className="font-medium">Public API documentation</span>
            <span className="block text-slate-500">Serve Swagger UI at /api/docs without signing in (takes effect after a restart).</span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
