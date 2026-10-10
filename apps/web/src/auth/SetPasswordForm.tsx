import { ErrorCode } from '@perspice/shared';
import { type FormEvent, useState } from 'react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export const MIN_PASSWORD = 10;

/** Shared by reset and activate: new password + confirmation, with server error mapping. */
export function SetPasswordForm({
  submitLabel,
  withName,
  onSubmit,
}: {
  submitLabel: string;
  withName?: boolean;
  onSubmit: (password: string, name?: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password, withName && name.trim() ? name.trim() : undefined);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === ErrorCode.TOKEN_INVALID
          ? 'This link is invalid or has expired. Ask for a new one.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {withName && <Field label="Your name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>}
      <Field label="New password" help={`At least ${MIN_PASSWORD} characters.`}>
        {(id, d) => (
          <Input id={id} type="password" autoComplete="new-password" required aria-describedby={d} value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Field>
      <Field label="Confirm password">
        {(id) => <Input id={id} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
