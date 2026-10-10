import type { ExportJobDto, Timewindow } from '@perspice/shared';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

interface ReportButtonProps {
  /** A device dashboard, or the overview when omitted. */
  deviceId?: string;
  timewindow: Timewindow;
  stateId: string;
}

/** Requests a branded PDF of the dashboard as shown (view and time window); it is rendered in the background. */
export function ReportButton({ deviceId, timewindow, stateId }: ReportButtonProps) {
  const { hasPerm } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!hasPerm('export.data')) return null;

  async function request() {
    setBusy(true);
    try {
      const job = await api<ExportJobDto>('/reports/dashboard', {
        body: { ...(deviceId ? { deviceId } : { overview: true }), stateId, timewindow },
      });
      toast({ title: 'PDF report requested', description: "We'll notify you when it's ready." });
      navigate(`/exports/${job.id}`);
    } catch (err) {
      toast({ title: 'Report failed', description: err instanceof ApiError ? err.message : 'Please try again.', variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void request()}>
      <FileText className="h-4 w-4" /> PDF report
    </Button>
  );
}
