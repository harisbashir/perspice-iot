import type { AwsIotBundle } from '@perspice/shared';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { saveBlob } from '@/exports/download';

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

/** AWS IoT Core credentials: certificate and key as files to put on the device. */
function AwsIotSection({ bundle }: { bundle: AwsIotBundle }) {
  const save = (text: string, name: string) => saveBlob(new Blob([text], { type: 'application/x-pem-file' }), name);
  return (
    <div data-testid="aws-iot-bundle" className="space-y-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
      <p className="font-medium">AWS IoT Core</p>
      <dl className="grid grid-cols-[120px_1fr] gap-1">
        <dt className="text-slate-500">Endpoint</dt>
        <dd className="break-all font-mono">{bundle.endpoint}:8883</dd>
        <dt className="text-slate-500">Client ID</dt>
        <dd className="font-mono">{bundle.clientId}</dd>
        <dt className="text-slate-500">Topics</dt>
        <dd className="font-mono">{bundle.topicPrefix}…</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => save(bundle.certificatePem, `${bundle.clientId}.cert.pem`)}>
          Download certificate
        </Button>
        <Button size="sm" variant="outline" onClick={() => save(bundle.privateKey, `${bundle.clientId}.private.key`)}>
          Download private key
        </Button>
        <a className="self-center text-xs underline" href={bundle.rootCaUrl} target="_blank" rel="noreferrer">
          Amazon root CA
        </a>
      </div>
      <p className="text-xs text-amber-700">Download the private key now: it is not kept and can’t be shown again.</p>
    </div>
  );
}

/** Shows freshly issued credentials exactly once; they cannot be retrieved after the dialog closes. */
export function TokenDialog({ deviceId, token, awsIot, onClose }: { deviceId: string; token: string | null; awsIot?: AwsIotBundle | null; onClose: () => void }) {
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
            {awsIot ? <AwsIotSection bundle={awsIot} /> : <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{arduinoSnippet(deviceId, token)}</pre>}
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
  const [awsIot, setAwsIot] = useState<AwsIotBundle | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function regenerate() {
    try {
      const res = await api<{ token: string; awsIot?: AwsIotBundle }>(`/devices/${deviceId}/credentials/regenerate`, { method: 'POST' });
      setAwsIot(res.awsIot ?? null);
      setToken(res.token);
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
      <TokenDialog deviceId={deviceId} token={token} awsIot={awsIot} onClose={() => setToken(null)} />
    </div>
  );
}
