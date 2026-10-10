import type { ExportFormat, ExportRequest } from '@perspice/shared';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { runExport } from './download';

const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'csv', label: 'CSV' },
  { format: 'xlsx', label: 'Excel (XLSX)' },
  { format: 'pdf', label: 'PDF' },
];

interface ExportMenuProps {
  /** Builds the request for the chosen format (null = nothing to export right now). */
  request: (format: ExportFormat) => ExportRequest | null;
  label?: string;
  /** Icon-only trigger, for widget headers. */
  compact?: boolean;
  className?: string;
}

export function ExportMenu({ request, label = 'Export', compact, className }: ExportMenuProps) {
  const { hasPerm } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!hasPerm('export.data')) return null;

  const run = async (format: ExportFormat) => {
    const req = request(format);
    if (!req) return;
    setBusy(true);
    try {
      const out = await runExport(req);
      if (out.kind === 'job') {
        toast({ title: 'Export started', description: "It's a large one, so it runs in the background. We'll notify you when it's ready." });
        navigate(`/exports/${out.job.id}`);
      }
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof ApiError ? err.message : 'Please try again.', variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button
            type="button"
            aria-label={label}
            title={label}
            disabled={busy}
            className={cn('rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100', className)}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Button variant="outline" size="sm" disabled={busy} className={className}>
            <Download className="h-4 w-4" /> {busy ? 'Exporting…' : label}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FORMATS.map((f) => (
          <DropdownMenuItem key={f.format} onSelect={() => void run(f.format)}>
            {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
