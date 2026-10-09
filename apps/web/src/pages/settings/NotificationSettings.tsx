import { NOTIFY_LEVELS, type NotificationPreferences, type NotifyLevel } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '@/api/client';
import { ErrorText, errorMessage } from '@/components/ErrorText';
import { TimezoneSelect, selectClass } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { disablePush, enablePush, pushStatus } from '@/push/push';

interface PreferencesView {
  timezone: string | null;
  effectiveTimezone: string;
  preferences: NotificationPreferences;
}

const LEVEL_LABEL: Record<NotifyLevel, string> = {
  info: 'Everything',
  warning: 'Warnings and above',
  minor: 'Minor alarms and above',
  major: 'Major alarms and above',
  critical: 'Critical only',
};

function Toggle({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {help && <span className="block text-xs text-slate-500">{help}</span>}
      </span>
    </label>
  );
}

function PushCard() {
  const toast = useToast();
  const status = useQuery({ queryKey: ['push-status'], queryFn: pushStatus });
  const [busy, setBusy] = useState(false);
  const s = status.data;
  if (!s) return null;

  async function toggle() {
    setBusy(true);
    try {
      if (s!.enabled) await disablePush();
      else await enablePush();
      await status.refetch();
      toast({ title: s!.enabled ? 'Push turned off for this browser' : 'Push turned on for this browser', variant: 'success' });
    } catch (err) {
      toast({ title: 'Push notifications', description: errorMessage(err), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">This browser</h3>
      {!s.available ? (
        <p className="text-sm text-slate-500">Push notifications are not set up on this server.</p>
      ) : !s.supported ? (
        <p className="text-sm text-slate-500">This browser does not support push notifications.</p>
      ) : (
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void toggle()}>
            {s.enabled ? 'Turn off push on this browser' : 'Turn on push on this browser'}
          </Button>
          {s.permission === 'denied' && <span className="text-xs text-amber-700">Notifications are blocked in this browser’s site settings.</span>}
        </div>
      )}
    </div>
  );
}

/** The signed-in user's channels, minimum level, quiet hours, digest and timezone. */
export function NotificationSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notification-preferences'], queryFn: () => api<PreferencesView>('/me/notification-preferences') });
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!data) return;
    setPrefs(data.preferences);
    setTimezone(data.timezone);
  }, [data]);

  if (!prefs || !data) return null;
  const set = (patch: Partial<NotificationPreferences>) => setPrefs({ ...prefs, ...patch });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const saved = await api<PreferencesView>('/me/notification-preferences', { method: 'PUT', body: { timezone, preferences: prefs } });
      qc.setQueryData(['notification-preferences'], saved);
      toast({ title: 'Notification settings saved', variant: 'success' });
    } catch (err) {
      setError(err);
    }
  }

  async function test() {
    try {
      const { queued } = await api<{ queued: number }>('/me/notification-preferences/test', { method: 'POST' });
      toast({ title: 'Test notification sent', description: `${queued} channel${queued === 1 ? '' : 's'}: check the bell, your inbox and this browser.`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Test failed', description: errorMessage(err), variant: 'error' });
    }
  }

  return (
    <form className="max-w-2xl space-y-6" onSubmit={(e) => void save(e)}>
      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-500">The bell in the app always shows your notifications. Choose where else they reach you.</p>
          <Toggle label="Email" checked={prefs.email} onChange={(email) => set({ email })} />
          <Toggle label="Push notifications" checked={prefs.push} onChange={(push) => set({ push })} help="On the browsers where you turn push on below." />
          <PushCard />
          <Field label="Send email and push for">
            {(id) => (
              <select id={id} className={selectClass} value={prefs.minSeverity} onChange={(e) => set({ minSeverity: e.target.value as NotifyLevel })}>
                {NOTIFY_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABEL[l]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quiet hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            label="Hold email and push during quiet hours"
            checked={!!prefs.quietHours}
            onChange={(on) => set({ quietHours: on ? { from: '22:00', to: '07:00' } : null })}
            help="Held notifications arrive as one summary email when quiet hours end."
          />
          {prefs.quietHours && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">{(id) => <Input id={id} type="time" value={prefs.quietHours!.from} onChange={(e) => set({ quietHours: { ...prefs.quietHours!, from: e.target.value } })} />}</Field>
              <Field label="To">{(id) => <Input id={id} type="time" value={prefs.quietHours!.to} onChange={(e) => set({ quietHours: { ...prefs.quietHours!, to: e.target.value } })} />}</Field>
            </div>
          )}
          <Toggle label="Critical alarms ignore quiet hours" checked={prefs.criticalBypassesQuietHours} onChange={(v) => set({ criticalBypassesQuietHours: v })} />
          <Field label="Timezone" help={timezone ? undefined : `Using ${data.effectiveTimezone}.`}>
            {(id) => <TimezoneSelect id={id} value={timezone} onChange={setTimezone} inheritLabel="Organisation default" />}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Busy periods</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Field label="Send at most" help="emails and pushes…">
            {(id) => (
              <Input id={id} type="number" min={1} max={100} value={prefs.digest.threshold} onChange={(e) => set({ digest: { ...prefs.digest, threshold: Number(e.target.value) } })} />
            )}
          </Field>
          <Field label="Within (minutes)" help="…then the rest arrive as one summary email.">
            {(id) => (
              <Input id={id} type="number" min={1} max={120} value={prefs.digest.windowMin} onChange={(e) => set({ digest: { ...prefs.digest, windowMin: Number(e.target.value) } })} />
            )}
          </Field>
        </CardContent>
      </Card>

      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit">Save</Button>
        <Button type="button" variant="outline" onClick={() => void test()}>
          Send a test notification
        </Button>
      </div>
    </form>
  );
}
