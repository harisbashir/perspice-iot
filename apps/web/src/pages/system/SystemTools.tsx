import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/api/client';
import { CopyField } from '@/components/CopyField';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface UpdateCheck {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  url: string | null;
}

/** A newer release than this one is published: how to install it (updates run on the server). */
export function UpdateNotice() {
  const { data } = useQuery({ queryKey: ['system-update'], queryFn: () => api<UpdateCheck>('/system/update'), staleTime: 3_600_000 });
  if (!data?.updateAvailable) return null;
  return (
    <div role="status" className="space-y-2 rounded-md border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
      <p className="flex items-center gap-2 font-medium">
        <ArrowUpCircle className="h-4 w-4" /> Version {data.latest} is available (this server runs {data.current}).
        {data.url && (
          <a className="underline" href={data.url} target="_blank" rel="noopener noreferrer">
            What’s new
          </a>
        )}
      </p>
      <p>Update on the server; it backs up first and rolls back by itself if anything fails:</p>
      <div className="max-w-md">
        <CopyField value={`sudo perspice update --version ${data.latest}`} />
      </div>
    </div>
  );
}

interface RoundtripResult {
  ok: boolean;
  ms: number | null;
  message: string;
}

/** Checks from the browser what `perspice cli health --mqtt-roundtrip` checks, and sets up push. */
export function ToolsCard() {
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<RoundtripResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const push = useQuery({ queryKey: ['push-key'], queryFn: () => api<{ publicKey: string | null }>('/push/public-key') });

  async function check() {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api<RoundtripResult>('/system/roundtrip', { method: 'POST' }));
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  }

  async function setUpPush() {
    setError(null);
    try {
      await api('/system/push', { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['push-key'] });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checks and setup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-2">
          <p className="font-medium">End-to-end check</p>
          <p className="text-fg-muted">
            Connects a temporary device to the broker, sends a value and waits for it to be stored, then removes the device. If
            this works, devices can connect and their data arrives.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void check()} disabled={checking}>
              {checking ? 'Checking…' : 'Run check'}
            </Button>
            {result && (
              <span role="status" className={result.ok ? 'text-ok' : 'text-crit'}>
                {result.ok ? `Working: stored in ${result.ms} ms` : `Failed: ${result.message}`}
              </span>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <p className="font-medium">Push notifications</p>
          {push.data?.publicKey ? (
            <p className="text-fg-muted">Set up: people can turn on push under Settings → Notifications.</p>
          ) : (
            <>
              <p className="text-fg-muted">Not set up. This creates the keys browsers need (stored encrypted); it can’t be undone.</p>
              <Button variant="outline" onClick={() => void setUpPush()}>
                Set up push notifications
              </Button>
            </>
          )}
        </div>
        <ErrorText error={error} />
      </CardContent>
    </Card>
  );
}
