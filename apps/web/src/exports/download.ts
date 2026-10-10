import type { ExportJobDto, ExportRequest } from '@perspice/shared';
import { apiResponse } from '@/api/client';

export type ExportOutcome = { kind: 'file'; filename: string } | { kind: 'job'; job: ExportJobDto };

/** `attachment; filename="x.csv"` → `x.csv` */
export function filenameFrom(disposition: string | null, fallback: string): string {
  return /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? fallback;
}

/** Hands a blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Small exports come back as the file and are saved straight away; large ones (202) run as a
 * background job and the user is notified when the file is ready.
 */
export async function runExport(req: ExportRequest): Promise<ExportOutcome> {
  const res = await apiResponse('/exports', { body: req });
  if (res.status === 202) return { kind: 'job', job: (await res.json()) as ExportJobDto };
  const filename = filenameFrom(res.headers.get('content-disposition'), `export.${req.format}`);
  saveBlob(await res.blob(), filename);
  return { kind: 'file', filename };
}
