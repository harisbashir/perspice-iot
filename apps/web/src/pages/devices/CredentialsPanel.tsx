import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function mqttHost(): string {
  const host = window.location.hostname;
  // Customer subdomains share the platform's broker at mqtt.<base domain>.
  const base = host.split('.').length > 2 ? host.split('.').slice(1).join('.') : host;
  return `mqtt.${base}`;
}

export function arduinoSnippet(deviceId: string, token: string): string {
  return `PerspiceConfig cfg;
cfg.host = "${mqttHost()}";
cfg.port = 8883;          // 1883 if TLS is disabled
cfg.useTls = true;
cfg.deviceId = "${deviceId}";
cfg.token = "${token}";
perspice.begin(cfg);`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {label}
    </Button>
  );
}

/** Shows a freshly issued token exactly once; it cannot be retrieved after the dialog closes. */
export function TokenDialog({ deviceId, token, onClose }: { deviceId: string; token: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!token} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Device token</DialogTitle>
          <DialogDescription>Copy it now. For security it is shown only once and cannot be retrieved later.</DialogDescription>
        </DialogHeader>
        {token && (
          <div className="space-y-3">
            <code data-testid="device-token" className="block break-all rounded bg-slate-100 p-3 font-mono text-sm dark:bg-slate-800">
              {token}
            </code>
            <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{arduinoSnippet(deviceId, token)}</pre>
          </div>
        )}
        <DialogFooter>
          {token && <CopyButton text={token} label="Copy token" />}
          {token && <CopyButton text={arduinoSnippet(deviceId, token)} label="Copy snippet" />}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CredentialsPanel({ deviceId, initialToken = null }: { deviceId: string; initialToken?: string | null }) {
  const { hasPerm } = useAuth();
  const [token, setToken] = useState<string | null>(initialToken);
  const [error, setError] = useState<unknown>(null);

  async function regenerate() {
    try {
      setToken((await api<{ token: string }>(`/devices/${deviceId}/credentials/regenerate`, { method: 'POST' })).token);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[140px_1fr] gap-2">
        <dt className="text-slate-500">MQTT host</dt>
        <dd className="font-mono">{mqttHost()}</dd>
        <dt className="text-slate-500">Ports</dt>
        <dd>8883 (TLS), 1883 (plain, if enabled)</dd>
        <dt className="text-slate-500">Client ID / username</dt>
        <dd className="font-mono">{deviceId}</dd>
        <dt className="text-slate-500">Password</dt>
        <dd>The device token</dd>
        <dt className="text-slate-500">HTTP</dt>
        <dd className="font-mono">POST /api/v1/device/telemetry with header X-Device-Token</dd>
      </dl>
      {hasPerm('device.credentials') && (
        <div className="space-y-2">
          <p className="text-slate-500">Regenerating disconnects the device and invalidates the current token.</p>
          <Button variant="outline" onClick={() => void regenerate()}>
            Regenerate token
          </Button>
        </div>
      )}
      <ErrorText error={error} />
      <TokenDialog deviceId={deviceId} token={token} onClose={() => setToken(null)} />
    </div>
  );
}
