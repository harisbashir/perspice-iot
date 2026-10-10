import type { BuiltInRoleKey, DeviceProfileDto } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '@/api/client';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { selectClass } from '@/components/TimezoneSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useProfile } from '../devices/hooks';
import { CalculatedKeysEditor } from './CalculatedKeysEditor';
import { CommandsEditor } from './CommandsEditor';
import { TelemetryKeysEditor } from './TelemetryKeysEditor';

type Draft = Omit<DeviceProfileDto, 'id' | 'createdAt' | 'updatedAt' | 'defaultDashboardTemplateId'>;

const EMPTY: Draft = {
  name: '',
  description: null,
  telemetrySchema: [],
  commands: [],
  offlineTimeoutS: 300,
  deadTimeoutS: 86400,
  sleepy: false,
  transport: 'mqtt',
  retentionDays: 365,
  statusNotify: { enabled: false, roleKeys: ['customer_admin'], channels: ['email', 'inapp'] },
  locationMode: 'none',
  locationKeys: { lat: 'lat', lng: 'lng', alt: 'alt', speed: 'speed', heading: 'heading', accuracy: 'acc' },
  trips: { enabled: false, minSpeedKmh: 5, minMoveM: 50, stopAfterS: 300 },
  calculated: [],
};

const LOCATION_KEYS = [
  ['lat', 'Latitude key'],
  ['lng', 'Longitude key'],
  ['speed', 'Speed key (km/h)'],
  ['heading', 'Heading key'],
  ['accuracy', 'Accuracy key (m)'],
  ['alt', 'Altitude key'],
] as const;

const NOTIFY_ROLES: [BuiltInRoleKey, string][] = [
  ['customer_admin', 'Customer admins'],
  ['customer_operator', 'Customer operators'],
  ['platform_admin', 'Platform admins'],
];

export function ProfileEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useProfile(isNew ? undefined : id);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (data) {
      const { id: _id, createdAt: _c, updatedAt: _u, defaultDashboardTemplateId: _d, ...rest } = data;
      setDraft(rest);
    }
  }, [data]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const notify = draft.statusNotify;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const saved = await api<DeviceProfileDto>(isNew ? '/device-profiles' : `/device-profiles/${id}`, {
        method: isNew ? 'POST' : 'PATCH',
        body: draft,
      });
      await qc.invalidateQueries({ queryKey: ['profiles'] });
      navigate(`/profiles/${saved.id}`, { replace: true });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form onSubmit={submit}>
      <PageHeader title={isNew ? 'New device profile' : draft.name || 'Device profile'} actions={<Button type="submit">Save profile</Button>} />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Name">{(fid) => <Input id={fid} required value={draft.name} onChange={(e) => set('name', e.target.value)} />}</Field>
            <Field label="Transport">
              {(fid) => (
                <select id={fid} className="h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700" value={draft.transport} onChange={(e) => set('transport', e.target.value as Draft['transport'])}>
                  <option value="mqtt">MQTT</option>
                  <option value="http">HTTP</option>
                </select>
              )}
            </Field>
            <Field label="Description">{(fid) => <Input id={fid} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value || null)} />}</Field>
            <Field label="History retention (days)">
              {(fid) => <Input id={fid} type="number" min={1} value={draft.retentionDays} onChange={(e) => set('retentionDays', Number(e.target.value))} />}
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Presence</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field label="Offline after (seconds)">
              {(fid) => <Input id={fid} type="number" min={10} value={draft.offlineTimeoutS} onChange={(e) => set('offlineTimeoutS', Number(e.target.value))} />}
            </Field>
            <Field label="Dead after (seconds)" error={draft.deadTimeoutS <= draft.offlineTimeoutS ? 'Must be longer than the offline timeout.' : null}>
              {(fid, d) => (
                <Input id={fid} type="number" aria-describedby={d} aria-invalid={draft.deadTimeoutS <= draft.offlineTimeoutS} value={draft.deadTimeoutS} onChange={(e) => set('deadTimeoutS', Number(e.target.value))} />
              )}
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={draft.sleepy} onChange={(e) => set('sleepy', e.target.checked)} />
              Sleepy device (disconnects are normal)
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Field label="Location">
              {(fid) => (
                <select id={fid} className={`${selectClass} max-w-sm`} value={draft.locationMode} onChange={(e) => set('locationMode', e.target.value as Draft['locationMode'])}>
                  <option value="none">None</option>
                  <option value="fixed">Fixed, set by hand</option>
                  <option value="reported">Reported by the device</option>
                </select>
              )}
            </Field>
            {draft.locationMode === 'reported' && (
              <>
                <p className="text-slate-500">Telemetry keys that carry the position (a message needs both latitude and longitude).</p>
                <div className="grid gap-3 md:grid-cols-3">
                  {LOCATION_KEYS.map(([k, label]) => (
                    <Field key={k} label={label}>
                      {(fid) => <Input id={fid} value={draft.locationKeys[k]} onChange={(e) => set('locationKeys', { ...draft.locationKeys, [k]: e.target.value })} />}
                    </Field>
                  ))}
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={draft.trips.enabled} onChange={(e) => set('trips', { ...draft.trips, enabled: e.target.checked })} />
                  Detect trips
                </label>
                {draft.trips.enabled && (
                  <div className="grid gap-3 md:grid-cols-4">
                    <Field label="Starts at (km/h)">
                      {(fid) => <Input id={fid} type="number" min={0.5} step="any" value={draft.trips.minSpeedKmh} onChange={(e) => set('trips', { ...draft.trips, minSpeedKmh: Number(e.target.value) })} />}
                    </Field>
                    <Field label="…or after moving (m)">
                      {(fid) => <Input id={fid} type="number" min={10} value={draft.trips.minMoveM} onChange={(e) => set('trips', { ...draft.trips, minMoveM: Number(e.target.value) })} />}
                    </Field>
                    <Field label="Ends after standing (s)">
                      {(fid) => <Input id={fid} type="number" min={60} value={draft.trips.stopAfterS} onChange={(e) => set('trips', { ...draft.trips, stopAfterS: Number(e.target.value) })} />}
                    </Field>
                    <Field label="Ignition key (optional)" help="A true/false key: trips then follow ignition">
                      {(fid) => (
                        <Input
                          id={fid}
                          value={draft.trips.ignitionKey ?? ''}
                          onChange={(e) => {
                            const { ignitionKey: _drop, ...rest } = draft.trips;
                            set('trips', e.target.value ? { ...rest, ignitionKey: e.target.value } : rest);
                          }}
                        />
                      )}
                    </Field>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Telemetry keys</CardTitle>
          </CardHeader>
          <CardContent>
            <TelemetryKeysEditor value={draft.telemetrySchema} onChange={(v) => set('telemetrySchema', v)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Calculated keys</CardTitle>
          </CardHeader>
          <CardContent>
            <CalculatedKeysEditor
              value={draft.calculated}
              onChange={(v) => set('calculated', v as Draft['calculated'])}
              telemetry={draft.telemetrySchema}
              profileId={isNew ? undefined : id}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Commands</CardTitle>
          </CardHeader>
          <CardContent>
            <CommandsEditor value={draft.commands} onChange={(v) => set('commands', v)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notify.enabled} onChange={(e) => set('statusNotify', { ...notify, enabled: e.target.checked })} />
              Notify when devices go offline, dead or come back online
            </label>
            <div className="flex flex-wrap gap-4">
              {NOTIFY_ROLES.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notify.roleKeys.includes(key)}
                    onChange={(e) =>
                      set('statusNotify', { ...notify, roleKeys: e.target.checked ? [...notify.roleKeys, key] : notify.roleKeys.filter((k) => k !== key) })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              {(['email', 'inapp'] as const).map((ch) => (
                <label key={ch} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notify.channels.includes(ch)}
                    onChange={(e) =>
                      set('statusNotify', { ...notify, channels: e.target.checked ? [...notify.channels, ch] : notify.channels.filter((c) => c !== ch) })
                    }
                  />
                  {ch === 'email' ? 'Email' : 'In-app'}
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
        <ErrorText error={error} />
      </div>
    </form>
  );
}
