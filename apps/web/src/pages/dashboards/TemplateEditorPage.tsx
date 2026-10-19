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

const SAMPLE = 'sample';

/** The device or asset a template is previewed with, or made-up sample data. */
function PreviewPicker({ value, onChange, options }: { value: string; onChange: (id: string) => void; options: { id: string; name: string }[] }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      Preview with
      <select className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={SAMPLE}>Sample data</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

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
  // '' = the first device (or sample data without one); 'sample' = always sample data.
  const [previewId, setPreviewId] = useState('');
  const { data: assetTypes = [] } = useAssetTypes();
  const { data: assetRows = [] } = useAssetTree();
  const assetsOfType = assetRows.filter((a) => a.typeId === tpl?.assetTypeId);
  const [previewAssetId, setPreviewAssetId] = useState('');
  const previewAsset = previewAssetId === SAMPLE ? undefined : (assetsOfType.find((a) => a.id === previewAssetId) ?? assetsOfType[0]);
  const preview = previewId === SAMPLE ? null : (devices?.items.find((d) => d.id === previewId) ?? devices?.items[0] ?? null);
  const sample = tpl?.kind === 'device' ? !preview : tpl?.kind === 'asset' ? !previewAsset : false;

  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !tpl) return <NotFoundPage />;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/dashboards" className="text-sm text-primary-700 hover:underline dark:text-primary-300">
          ← Dashboards
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{tpl.name}</h1>
        <p className="text-sm text-fg-muted">
          {tpl.kind === 'device' ? `${profile?.name ?? ''} devices` : tpl.kind === 'asset' ? `${assetTypes.find((a) => a.id === tpl.assetTypeId)?.name ?? ''} assets` : 'Overview'} · version {tpl.version}
        </p>
      </div>
      <DashboardEditor
        key={tpl.version}
        initial={tpl.definition}
        profile={profile ?? null}
        previewDevice={tpl.kind === 'device' ? preview : null}
        previewAssetId={tpl.kind === 'asset' ? previewAsset?.id : undefined}
        sample={sample}
        toolbar={
          tpl.kind === 'asset' ? (
            <PreviewPicker value={previewAsset?.id ?? SAMPLE} onChange={setPreviewAssetId} options={assetsOfType} />
          ) : tpl.kind === 'device' ? (
            <PreviewPicker value={preview?.id ?? SAMPLE} onChange={setPreviewId} options={devices?.items ?? []} />
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
