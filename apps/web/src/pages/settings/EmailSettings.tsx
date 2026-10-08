import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { EmailSettingsDto } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText, errorMessage } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

type Driver = 'smtp' | 'ses';

const EMPTY_SMTP = { host: '', port: 587, secure: false, user: '', pass: '', from: '' };
const EMPTY_SES = { region: 'us-east-1', accessKeyId: '', secretAccessKey: '', from: '' };

export function EmailSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings', 'email'], queryFn: () => api<EmailSettingsDto>('/settings/email') });
  const [driver, setDriver] = useState<Driver>('smtp');
  const [smtp, setSmtp] = useState(EMPTY_SMTP);
  const [ses, setSes] = useState(EMPTY_SES);
  const [testTo, setTestTo] = useState(user?.email ?? '');
  const [error, setError] = useState<unknown>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDriver(data.driver ?? 'smtp');
    if (data.smtp) setSmtp({ ...data.smtp, pass: '' });
    if (data.ses) setSes({ ...data.ses, secretAccessKey: '' });
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/settings/email', { method: 'PUT', body: driver === 'smtp' ? { driver, smtp } : { driver, ses } });
      await qc.invalidateQueries({ queryKey: ['settings', 'email'] });
      toast({ title: 'Email settings saved', variant: 'success' });
    } catch (err) {
      setError(err);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      await api('/settings/email/test', { body: { to: testTo } });
      toast({ title: 'Test email sent', description: `Check the inbox of ${testTo}.`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Test email failed', description: errorMessage(err), variant: 'error' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Outgoing email</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={save}>
            <fieldset className="flex gap-4 text-sm">
              <legend className="sr-only">Driver</legend>
              {(['smtp', 'ses'] as const).map((d) => (
                <label key={d} className="flex items-center gap-2">
                  <input type="radio" name="driver" checked={driver === d} onChange={() => setDriver(d)} />
                  {d === 'smtp' ? 'SMTP' : 'Amazon SES'}
                </label>
              ))}
            </fieldset>
            {driver === 'smtp' ? (
              <>
                <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                  <Field label="Host">{(id) => <Input id={id} required value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />}</Field>
                  <Field label="Port">
                    {(id) => <Input id={id} type="number" required value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} />}
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} />
                  Use TLS from the start (port 465)
                </label>
                <Field label="Username">{(id) => <Input id={id} value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} />}</Field>
                <Field label="Password" help={data?.smtp?.hasPassword ? 'Leave empty to keep the saved password.' : undefined}>
                  {(id, d) => <Input id={id} type="password" aria-describedby={d} value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} />}
                </Field>
                <Field label="From address">{(id) => <Input id={id} required value={smtp.from} placeholder="Perspice <no-reply@example.com>" onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} />}</Field>
              </>
            ) : (
              <>
                <Field label="Region">{(id) => <Input id={id} required value={ses.region} onChange={(e) => setSes({ ...ses, region: e.target.value })} />}</Field>
                <Field label="Access key ID">{(id) => <Input id={id} required value={ses.accessKeyId} onChange={(e) => setSes({ ...ses, accessKeyId: e.target.value })} />}</Field>
                <Field label="Secret access key" help={data?.ses?.hasSecret ? 'Leave empty to keep the saved secret.' : undefined}>
                  {(id, d) => <Input id={id} type="password" aria-describedby={d} value={ses.secretAccessKey} onChange={(e) => setSes({ ...ses, secretAccessKey: e.target.value })} />}
                </Field>
                <Field label="From address">{(id) => <Input id={id} required value={ses.from} onChange={(e) => setSes({ ...ses, from: e.target.value })} />}</Field>
              </>
            )}
            <ErrorText error={error} />
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Send a test email</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <Field label="Recipient">{(id) => <Input id={id} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />}</Field>
          </div>
          <Button variant="outline" disabled={testing || !testTo} onClick={() => void sendTest()}>
            Send test
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
