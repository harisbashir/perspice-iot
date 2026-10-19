import { IMPORT_COLUMNS, type ImportReport, toCsv } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '@/api/client';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { saveBlob } from '@/exports/download';
import { DEVICE_LISTS } from '@/realtime/hooks';

/** Devices from a CSV: checked first (dry run), then created, with credentials to save once. */
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [created, setCreated] = useState<NonNullable<ImportReport['created']> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFile(null);
    setReport(null);
    setCreated(null);
    setError(null);
  }

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<ImportReport>('/devices/import', { body: file, query: { dryRun: dryRun || undefined } });
      setReport(res);
      if (!dryRun && res.created) {
        setCreated(res.created);
        await qc.invalidateQueries({ queryKey: DEVICE_LISTS });
      }
    } catch (err) {
      // A file with errors comes back as a 400 carrying the same report.
      const errors = err instanceof ApiError ? (err.details as { errors?: ImportReport['errors'] } | undefined)?.errors : undefined;
      if (errors) setReport({ ok: false, rows: report?.rows ?? 0, errors });
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!created) return;
    const csv = toCsv([['id', 'name', 'token', 'claim_code'], ...created.map((d) => [d.id, d.name, d.token, d.claimCode])]);
    saveBlob(new Blob([csv], { type: 'text/csv' }), 'device-credentials.csv');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // The credentials are shown once: closing forgets them.
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import devices</DialogTitle>
        </DialogHeader>
        {created ? (
          <div className="space-y-3 text-sm">
            <p data-testid="import-created">{created.length === 1 ? '1 device created.' : `${created.length} devices created.`}</p>
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              Save the credentials now: tokens and claim codes are shown only once.
            </p>
            <DialogFooter>
              <Button onClick={download}>Download credentials (CSV)</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Columns: <span className="font-mono">{IMPORT_COLUMNS.join(', ')}</span>. Name and profile are required; tags are separated by “;”; claim = yes gives an unassigned device a claim code; serial registers the device’s serial for provisioning keys. Up to 5,000 devices.
            </p>
            <Field label="CSV file">
              {(id) => (
                <input
                  id={id}
                  type="file"
                  accept=".csv,text/csv"
                  className="text-sm"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setReport(null);
                  }}
                />
              )}
            </Field>
            {report && (
              <div className="text-sm" data-testid="import-report">
                {report.ok ? (
                  <p className="text-green-700 dark:text-green-300">{report.rows === 1 ? '1 device is ready to import.' : `${report.rows} devices are ready to import.`}</p>
                ) : (
                  <>
                    <p className="mb-1 font-medium text-red-700 dark:text-red-300">Fix these and check again; nothing has been imported:</p>
                    <ul className="max-h-48 list-disc overflow-auto pl-5">
                      {report.errors.map((e) => (
                        <li key={`${e.row}-${e.field}`}>
                          {e.row ? `Row ${e.row}` : 'Header'}, {e.field}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            <ErrorText error={error} />
            <DialogFooter>
              <Button variant="outline" disabled={!file || busy} onClick={() => void send(true)}>
                Check
              </Button>
              <Button disabled={!file || busy || !report?.ok} onClick={() => void send(false)}>
                Import
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
