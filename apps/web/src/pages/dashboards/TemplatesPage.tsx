import type { DeviceProfileDto } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, MoreHorizontal, Plus, Upload, Wand2 } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '@/api/client';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useProfiles } from '../devices/hooks';
import { useAssetTypes } from '../assets/hooks';
import { CloneDialog } from './KeyMappingDialog';
import type { TemplateDto } from './types';

const selectClass = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm';
const EMPTY = { states: [{ id: 'main', name: 'Main', layout: [], widgets: [] }], settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 } };

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^A-Za-z0-9-_]+/g, '-')}.dashboard.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function ProfileSelect({ id, value, onChange, profiles }: { id: string; value: string; onChange: (v: string) => void; profiles: DeviceProfileDto[] }) {
  return (
    <select id={id} required className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Choose a profile
      </option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export function TemplatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: templates = [] } = useQuery({ queryKey: ['dashboard-templates'], queryFn: () => api<TemplateDto[]>('/dashboard-templates') });
  const { data: profiles = [] } = useProfiles();
  const { data: assetTypes = [] } = useAssetTypes();
  const [assetTypeId, setAssetTypeId] = useState('');
  const [dialog, setDialog] = useState<'new' | 'generate' | 'import' | null>(null);
  const [cloning, setCloning] = useState<TemplateDto | null>(null);
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['dashboard-templates'] });
  const profileName = (id: string | null) => profiles.find((p) => p.id === id)?.name ?? '—';
  const isDefault = (t: TemplateDto) => profiles.some((p) => p.defaultDashboardTemplateId === t.id);

  async function run(fn: () => Promise<unknown>, success?: string) {
    setError(null);
    try {
      await fn();
      await refresh();
      if (success) toast({ title: success, variant: 'success' });
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    let created: TemplateDto | undefined;
    const ok = await run(async () => {
      created = await api<TemplateDto>('/dashboard-templates', {
        body: assetTypeId ? { name, kind: 'asset', assetTypeId, definition: EMPTY } : { name, kind: 'device', profileId, definition: EMPTY },
      });
    });
    if (ok && created) navigate(`/dashboards/${created.id}/edit`);
  }

  async function submitGenerate(e: FormEvent) {
    e.preventDefault();
    let created: TemplateDto | undefined;
    const ok = await run(async () => {
      created = await api<TemplateDto>(`/device-profiles/${profileId}/generate-dashboard`, { method: 'POST' });
    });
    if (ok && created) navigate(`/dashboards/${created.id}/edit`);
  }

  async function submitImport(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    let envelope: unknown;
    try {
      envelope = JSON.parse(await file.text());
    } catch {
      setError(new Error('That file is not JSON.'));
      return;
    }
    const kind = (envelope as { template?: { kind?: string } })?.template?.kind;
    if (await run(() => api('/dashboard-templates/import', { body: { envelope, profileId: kind === 'overview' ? null : profileId } }), 'Dashboard imported')) setDialog(null);
  }

  return (
    <div>
      <PageHeader
        title="Dashboards"
        description="One template serves every device of its profile; customers can customise their copy."
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog('import')}>
              <Upload className="h-4 w-4" /> Import
            </Button>
            <Button variant="outline" onClick={() => setDialog('generate')}>
              <Wand2 className="h-4 w-4" /> Generate from profile
            </Button>
            <Button onClick={() => setDialog('new')}>
              <Plus className="h-4 w-4" /> New dashboard
            </Button>
          </>
        }
      />
      <ErrorText error={error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Profile</TableHead>
            <TableHead>Version</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                <Link to={`/dashboards/${t.id}/edit`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                  {t.name}
                </Link>{' '}
                {t.builtIn && <Badge variant="secondary">built-in</Badge>} {isDefault(t) && <Badge>profile default</Badge>}
              </TableCell>
              <TableCell>{t.kind}</TableCell>
              <TableCell>{t.kind === 'device' ? profileName(t.profileId) : t.kind === 'asset' ? `${assetTypes.find((a) => a.id === t.assetTypeId)?.name ?? '—'} assets` : 'All devices'}</TableCell>
              <TableCell>v{t.version}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for ${t.name}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => navigate(`/dashboards/${t.id}/edit`)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setCloning(t)}>Clone…</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void api(`/dashboard-templates/${t.id}/export`).then((env) => download(t.name, env))}>
                      <Download className="h-4 w-4" /> Export JSON
                    </DropdownMenuItem>
                    {t.kind === 'device' && t.profileId && (
                      <DropdownMenuItem
                        onSelect={() =>
                          void run(
                            () => api(`/device-profiles/${t.profileId}/default-dashboard`, { method: 'PUT', body: { templateId: t.id } }).then(() => qc.invalidateQueries({ queryKey: ['profiles'] })),
                            'Set as the profile’s dashboard',
                          )
                        }
                      >
                        Use for all {profileName(t.profileId)} devices
                      </DropdownMenuItem>
                    )}
                    {!t.builtIn && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600" onSelect={() => void run(() => api(`/dashboard-templates/${t.id}`, { method: 'DELETE' }), 'Dashboard deleted')}>
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
          {templates.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-fg-muted">
                No dashboards yet. Generate one from a device profile to start.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === 'new' ? 'New dashboard' : dialog === 'generate' ? 'Generate from profile' : 'Import dashboard'}</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => void (dialog === 'new' ? submitNew(e) : dialog === 'generate' ? submitGenerate(e) : submitImport(e))}>
            {dialog === 'new' && <Field label="Name">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>}
            {dialog === 'import' && (
              <Field label="File">{(id) => <input id={id} ref={fileRef} type="file" accept="application/json,.json" required className="text-sm" />}</Field>
            )}
            {dialog === 'new' && assetTypes.length > 0 ? (
              <Field label="Dashboard for" help="A device profile's devices, or an asset type's assets.">
                {(id, h) => (
                  <select
                    id={id}
                    aria-describedby={h}
                    required
                    className={selectClass}
                    value={assetTypeId ? `a:${assetTypeId}` : profileId ? `p:${profileId}` : ''}
                    onChange={(e) => {
                      const [k, v] = e.target.value.split(':') as [string, string];
                      setProfileId(k === 'p' ? v : '');
                      setAssetTypeId(k === 'a' ? v : '');
                    }}
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    <optgroup label="Device profiles">
                      {profiles.map((p) => (
                        <option key={p.id} value={`p:${p.id}`}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Asset types">
                      {assetTypes.map((a) => (
                        <option key={a.id} value={`a:${a.id}`}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                )}
              </Field>
            ) : (
              <Field label="Profile" help={dialog === 'import' ? 'For device dashboards; ignored for overview dashboards.' : undefined}>
                {(id) => <ProfileSelect id={id} value={profileId} onChange={setProfileId} profiles={profiles} />}
              </Field>
            )}
            <ErrorText error={error} />
            <DialogFooter>
              <Button type="submit">{dialog === 'new' ? 'Create' : dialog === 'generate' ? 'Generate' : 'Import'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {cloning && (
        <CloneDialog
          open
          onOpenChange={(o) => !o && setCloning(null)}
          source={cloning}
          profiles={profiles}
          onClone={async (body) => {
            await run(() => api(`/dashboard-templates/${cloning.id}/clone`, { body }), 'Dashboard cloned');
          }}
        />
      )}
    </div>
  );
}
