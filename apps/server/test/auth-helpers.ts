import { generateSync } from 'otplib';
import type { TestApp } from './harness';

export const REFRESH_COOKIE = 'pr_refresh';

export function refreshCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const hit = list.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  return hit?.split(';')[0];
}

export async function login(
  t: TestApp,
  email: string,
  password: string,
  opts: { host?: string; totp?: string } = {},
) {
  return t.http
    .post('/api/auth/login')
    .set('Host', opts.host ?? 'localhost')
    .send({ email, password, ...(opts.totp ? { totp: opts.totp } : {}) });
}

/** Logs in and returns the access token; fails the test if login does not succeed. */
export async function tokenFor(t: TestApp, email: string, password: string, host = 'localhost'): Promise<string> {
  const res = await login(t, email, password, { host });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

export const totpCode = (secret: string) => generateSync({ secret });
