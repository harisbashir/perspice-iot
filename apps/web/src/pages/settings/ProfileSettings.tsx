import { type FormEvent, useState } from 'react';
import QRCode from 'qrcode';
import { useLocation } from 'react-router';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import type { MeResponse } from '@perspice/shared';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

function NameForm() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/users/${user!.id}`, { method: 'PATCH', body: { name } });
      setUser({ ...user!, name });
      toast({ title: 'Profile saved', variant: 'success' });
    } catch (err) {
      setError(err);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <ErrorText error={error} />
      <Button type="submit">Save</Button>
    </form>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/auth/password', { body: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      setError(null);
      toast({ title: 'Password changed', description: 'Other sessions were signed out.', variant: 'success' });
    } catch (err) {
      setError(err);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Current password">
        {(id) => <Input id={id} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
      </Field>
      <Field label="New password" help="At least 10 characters.">
        {(id, d) => (
          <Input id={id} type="password" autoComplete="new-password" required minLength={10} aria-describedby={d} value={next} onChange={(e) => setNext(e.target.value)} />
        )}
      </Field>
      <ErrorText error={error} />
      <Button type="submit">Change password</Button>
    </form>
  );
}

/** Two-factor enrolment: show the QR code, then confirm with a code from the app. */
export function TotpEnrol() {
  const { user, setUser } = useAuth();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function start() {
    setError(null);
    try {
      const res = await api<{ otpauthUrl: string; secret: string }>('/auth/totp/setup', { method: 'POST' });
      setSecret(res.secret);
      setQr(await QRCode.toDataURL(res.otpauthUrl, { margin: 1, width: 192 }));
    } catch (err) {
      setError(err);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    try {
      const me = await api<MeResponse>('/auth/totp/enable', { body: { code } });
      setUser(me);
      setQr(null);
      setSecret(null);
    } catch (err) {
      setError(err);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    try {
      const me = await api<MeResponse>('/auth/totp/disable', { body: { code } });
      setUser(me);
      setCode('');
    } catch (err) {
      setError(err);
    }
  }

  if (user?.totpEnabled) {
    return (
      <form onSubmit={disable} className="space-y-4">
        <p className="text-sm">Two-factor authentication is on.</p>
        {user.roleKey !== 'super_admin' && (
          <>
            <Field label="Code to turn it off">
              {(id) => <Input id={id} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
            </Field>
            <ErrorText error={error} />
            <Button type="submit" variant="outline" disabled={code.length !== 6}>
              Turn off
            </Button>
          </>
        )}
      </form>
    );
  }

  if (!qr) {
    return (
      <div className="space-y-4">
        <p className="text-sm">Protect your account with a code from an authenticator app.</p>
        <ErrorText error={error} />
        <Button onClick={() => void start()}>Set up two-factor authentication</Button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-4">
      <p className="text-sm">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
      <img src={qr} alt="QR code for your authenticator app" className="h-48 w-48 rounded border bg-surface p-2" />
      <p className="text-xs text-fg-muted">
        Can't scan? Enter this key: <code className="font-mono">{secret}</code>
      </p>
      <Field label="Code">
        {(id) => (
          <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        )}
      </Field>
      <ErrorText error={error} />
      <Button type="submit" disabled={code.length !== 6}>
        Turn on
      </Button>
    </form>
  );
}

export function ProfileSettings() {
  const { user } = useAuth();
  const location = useLocation();
  const mustEnrol = user?.roleKey === 'super_admin' && !user.totpEnabled;
  return (
    <div className="grid max-w-2xl gap-6">
      {mustEnrol && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {(location.state as { enrolTotp?: boolean } | null)?.enrolTotp ? 'Before you continue: ' : ''}
          Super admins must turn on two-factor authentication.
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>{user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <TotpEnrol />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <NameForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
