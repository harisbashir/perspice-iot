import { ErrorCode } from '@perspice/shared';
import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthProvider';
import { TotpStep } from './TotpStep';

export function lockMessage(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(totp?: string) {
    setBusy(true);
    setError(null);
    try {
      await login(email, password, totp);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      if (!(err instanceof ApiError)) setError('Could not reach the server.');
      else if (err.code === ErrorCode.TOTP_REQUIRED) setNeedTotp(true);
      else if (err.code === ErrorCode.ACCOUNT_LOCKED)
        setError(lockMessage((err.details as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 900));
      else if (err.code === ErrorCode.RATE_LIMITED) setError('Too many attempts. Please wait a minute.');
      else if (needTotp && err.code === ErrorCode.INVALID_CREDENTIALS) setError('That code is not valid.');
      else setError('Invalid email or password.');
    } finally {
      setBusy(false);
    }
  }

  if (needTotp) {
    return (
      <AuthLayout title="Two-factor authentication" description="Enter the 6-digit code from your authenticator app.">
        <TotpStep busy={busy} error={error} onSubmit={(code) => void submit(code)} onBack={() => setNeedTotp(false)} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in">
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Email">
          {(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password">
          {(id) => (
            <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <div className="text-center text-sm">
          <Link to="/forgot" className="text-primary-700 hover:underline dark:text-primary-300">
            Forgot your password?
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
