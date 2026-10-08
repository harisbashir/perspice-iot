import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthLayout } from './AuthLayout';

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/auth/forgot', { body: { email } });
    } catch {
      /* the response is identical either way; show the same message */
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <AuthLayout title="Reset password" description="We'll email you a link to choose a new password.">
      {sent ? (
        <p className="text-sm">If an account exists for {email}, a reset link is on its way. The link expires in 1 hour.</p>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Email">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Button type="submit" className="w-full" disabled={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <div className="mt-4 text-center text-sm">
        <Link to="/login" className="text-primary-700 hover:underline dark:text-primary-300">
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
