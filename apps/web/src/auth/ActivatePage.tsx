import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '@/api/client';
import { AuthLayout } from './AuthLayout';
import { SetPasswordForm } from './SetPasswordForm';

export function ActivatePage() {
  const [params] = useSearchParams();
  const [done, setDone] = useState(false);
  return (
    <AuthLayout title="Activate your account" description="Choose a password to finish setting up your account.">
      {done ? (
        <p className="text-sm">
          Your account is ready.{' '}
          <Link to="/login" className="text-primary-700 hover:underline dark:text-primary-300">
            Sign in
          </Link>
        </p>
      ) : (
        <SetPasswordForm
          submitLabel="Activate"
          withName
          onSubmit={async (password, name) => {
            await api('/auth/activate', { body: { token: params.get('token') ?? '', password, ...(name ? { name } : {}) } });
            setDone(true);
          }}
        />
      )}
    </AuthLayout>
  );
}
