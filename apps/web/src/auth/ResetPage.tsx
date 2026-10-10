import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '@/api/client';
import { AuthLayout } from './AuthLayout';
import { SetPasswordForm } from './SetPasswordForm';

export function ResetPage() {
  const [params] = useSearchParams();
  const [done, setDone] = useState(false);
  return (
    <AuthLayout title="Choose a new password">
      {done ? (
        <p className="text-sm">
          Your password was changed and other sessions were signed out.{' '}
          <Link to="/login" className="text-primary-700 hover:underline dark:text-primary-300">
            Sign in
          </Link>
        </p>
      ) : (
        <SetPasswordForm
          submitLabel="Set password"
          onSubmit={async (password) => {
            await api('/auth/reset', { body: { token: params.get('token') ?? '', password } });
            setDone(true);
          }}
        />
      )}
    </AuthLayout>
  );
}
