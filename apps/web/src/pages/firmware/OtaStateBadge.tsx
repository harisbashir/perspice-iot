import type { OtaDeviceState, OtaJobStatus } from '@perspice/shared';
import { Badge } from '@/components/ui/badge';

const STATE: Record<OtaDeviceState, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'danger' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  sent: { label: 'Sent', variant: 'default' },
  downloading: { label: 'Downloading', variant: 'default' },
  verifying: { label: 'Verifying', variant: 'default' },
  applied: { label: 'Updated', variant: 'success' },
  failed: { label: 'Failed', variant: 'danger' },
  skipped: { label: 'Skipped', variant: 'secondary' },
};

const JOB: Record<OtaJobStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'danger' }> = {
  running: { label: 'Running', variant: 'default' },
  halted: { label: 'Halted', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
};

export function OtaStateBadge({ state, pct }: { state: OtaDeviceState; pct?: number | null }) {
  const s = STATE[state];
  return (
    <Badge variant={s.variant}>
      {s.label}
      {state === 'downloading' && pct != null ? ` ${Math.round(pct)}%` : ''}
    </Badge>
  );
}

export function OtaJobBadge({ status }: { status: OtaJobStatus }) {
  const s = JOB[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
