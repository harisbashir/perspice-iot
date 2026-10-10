import type { DashboardDefinition, DeviceDto } from '@perspice/shared';
import type { Page } from '@/api/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '@/api/client';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { DashboardEditor } from '@/dashboards/builder/DashboardEditor';
import { NotFoundPage } from '../NotFoundPage';
import { useProfile } from '../devices/hooks';
import { useAssetTree, useAssetTypes } from '../assets/hooks';
import type { TemplateDto } from './types';

export function TemplateEditorPage() {
  const { templateId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: tpl, isLoading, error } = useQuery({ queryKey: ['dashboard-templates', templateId], queryFn: () => api<TemplateDto>(`/dashboard-templates/${templateId}`) });
  const { data: profile } = useProfile(tpl?.profileId ?? undefined);
  const { data: devices } = useQuery({
    queryKey: ['devices', 'preview', tpl?.profileId],
    queryFn: () => api<Page<DeviceDto>>('/devices', { query: { profileId: tpl!.profileId!, limit: 50 } }),
    enabled: !!tpl?.profileId,
  });
  const [previewId, setPreviewId] = useState('');
  const { data: assetTypes = [] } = useAssetTypes();
  const { data: assetRows = [] } = useAssetTree();
  const assetsOfType = assetRows.filter((a) => a.typeId === tpl?.assetTypeId);
  const [previewAssetId, setPreviewAssetId] = useState('');
  const previewAsset = assetsOfType.find((a) => a.id === previewAssetId) ?? assetsOfType[0];
  const preview = devices?.items.find((d) => d.id === previewId) ?? devices?.items[0] ?? null;

  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !tpl) return <NotFoundPage />;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/dashboards" className="text-sm text-primary-700 hover:underline dark:text-primary-300">
          ← Dashboards
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{tpl.name}</h1>
        <p className="text-sm text-slate-500">
          {tpl.kind === 'device' ? `${profile?.name ?? ''} devices` : tpl.kind === 'asset' ? `${assetTypes.find((a) => a.id === tpl.assetTypeId)?.name ?? ''} assets` : 'Overview'} · version {tpl.version}
        </p>
      </div>
      <DashboardEditor
        key={tpl.version}
        initial={tpl.definition}
        profile={profile ?? null}
        previewDevice={tpl.kind === 'device' ? preview : null}
        previewAssetId={tpl.kind === 'asset' ? previewAsset?.id : undefined}
        toolbar={
          tpl.kind === 'asset' && assetsOfType.length ? (
            <label className="flex items-center gap-2 text-sm">
              Preview with
              <select className="h-8 rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700" value={previewAsset?.id ?? ''} onChange={(e) => setPreviewAssetId(e.target.value)}>
                {assetsOfType.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : tpl.kind === 'device' && devices?.items.length ? (
            <label className="flex items-center gap-2 text-sm">
              Preview with
              <select className="h-8 rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700" value={preview?.id ?? ''} onChange={(e) => setPreviewId(e.target.value)}>
                {devices.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null
        }
        onSave={async (definition: DashboardDefinition) => {
          const saved = await api<TemplateDto>(`/dashboard-templates/${tpl.id}`, { method: 'PATCH', body: { definition } });
          qc.setQueryData(['dashboard-templates', tpl.id], saved);
          await qc.invalidateQueries({ queryKey: ['dashboards'] });
          toast({ title: `Saved as version ${saved.version}`, variant: 'success' });
        }}
      />
    </div>
  );
}
