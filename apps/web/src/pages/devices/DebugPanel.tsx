import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';

interface DebugEntry {
  ts: number;
  kind: string;
  summary: string;
  raw?: string;
}

const KIND_VARIANT: Record<string, 'danger' | 'warning' | 'secondary' | 'default'> = {
  rejected: 'danger',
  ts_adjusted: 'warning',
  connect: 'default',
  disconnect: 'secondary',
};

/** The last 100 raw messages and rejections, refreshed every 3 seconds. */
export function DebugPanel({ deviceId }: { deviceId: string }) {
  const { data = [] } = useQuery({
    queryKey: ['debug', deviceId],
    queryFn: () => api<DebugEntry[]>(`/devices/${deviceId}/debug`),
    refetchInterval: 3000,
  });
  if (!data.length) return <p className="text-sm text-fg-muted">No messages yet.</p>;
  return (
    <ol className="space-y-2 font-mono text-xs">
      {data.map((e, i) => (
        <li key={`${e.ts}-${i}`} className="rounded border border-line p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-fg-muted">{new Date(e.ts).toLocaleTimeString()}</span>
            <Badge variant={KIND_VARIANT[e.kind] ?? 'secondary'}>{e.kind}</Badge>
            <span className="font-sans">{e.summary}</span>
          </div>
          {e.raw && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-fg-muted">{e.raw}</pre>}
        </li>
      ))}
    </ol>
  );
}
