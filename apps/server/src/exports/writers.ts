import type { BrandingDto, ExportFormat } from '@perspice/shared';
import ExcelJS from 'exceljs';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import PdfPrinter from 'pdfmake';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';

export interface Column {
  header: string;
  kind: 'time' | 'number' | 'text';
}

/** One cell: a Date for time columns, otherwise any JSON-able value. */
export type Cell = Date | string | number | boolean | null | undefined | object;

export interface ExportDocument {
  title: string;
  columns: Column[];
  rows: AsyncIterable<Cell[]>;
  branding: BrandingDto;
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** `2026-01-01 00:00:00` (UTC): sorts as text and opens cleanly in spreadsheets. */
export const formatTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

function text(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return formatTime(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function csvField(v: Cell, kind: Column['kind']): string {
  let s = text(v);
  // Spreadsheet formula injection: neutralise text that a spreadsheet would evaluate.
  if (kind === 'text' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function writeCsv(doc: ExportDocument, out: Writable): Promise<number> {
  let n = 0;
  let chunk = `${doc.columns.map((c) => csvField(c.header, 'text')).join(',')}\n`;
  for await (const row of doc.rows) {
    chunk += `${row.map((v, i) => csvField(v, doc.columns[i]!.kind)).join(',')}\n`;
    n++;
    if (chunk.length > 64_000) {
      if (!out.write(chunk)) await once(out, 'drain');
      chunk = '';
    }
  }
  out.end(chunk);
  return n;
}

async function writeXlsx(doc: ExportDocument, out: Writable): Promise<number> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
  wb.creator = doc.branding.productName;
  const ws = wb.addWorksheet(doc.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ') || 'Export');
  ws.columns = doc.columns.map((c) => ({
    header: c.header,
    width: c.kind === 'time' ? 20 : Math.max(12, c.header.length + 2),
    style: c.kind === 'time' ? { numFmt: 'yyyy-mm-dd hh:mm:ss' } : {},
  }));
  ws.getRow(1).font = { bold: true };
  let n = 0;
  for await (const row of doc.rows) {
    ws.addRow(row.map((v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : (v ?? null)))).commit();
    n++;
  }
  ws.commit();
  await wb.commit();
  return n;
}

const printer = new PdfPrinter({
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
});

async function writePdf(doc: ExportDocument, out: Writable): Promise<number> {
  const body: TableCell[][] = [doc.columns.map((c) => ({ text: c.header, bold: true, color: '#ffffff', fillColor: doc.branding.primaryColor }))];
  for await (const row of doc.rows) {
    body.push(row.map((v, i) => ({ text: text(v), alignment: doc.columns[i]!.kind === 'number' ? 'right' : 'left' })));
  }
  const n = body.length - 1;
  const content: Content[] = [
    { text: doc.branding.productName, color: doc.branding.primaryColor, bold: true, fontSize: 10 },
    { text: doc.title, fontSize: 16, bold: true, margin: [0, 4, 0, 2] },
    { text: `Generated ${formatTime(new Date())} UTC · ${n} rows`, fontSize: 8, color: '#6b7280', margin: [0, 0, 0, 10] },
    {
      table: { headerRows: 1, widths: doc.columns.map(() => '*'), body },
      layout: 'lightHorizontalLines',
      fontSize: 8,
    },
  ];
  const definition: TDocumentDefinitions = {
    info: { title: `${doc.title} — ${doc.branding.productName}`, creator: doc.branding.productName },
    pageOrientation: doc.columns.length > 5 ? 'landscape' : 'portrait',
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: 'center', fontSize: 8, color: '#6b7280' }),
    content,
  };
  const pdf = printer.createPdfKitDocument(definition);
  pdf.pipe(out);
  pdf.end();
  await once(out, 'finish');
  return n;
}

/** Writes the document to `out` (and ends it); resolves with the number of data rows. */
export function writeExport(format: ExportFormat, doc: ExportDocument, out: Writable): Promise<number> {
  return { csv: writeCsv, xlsx: writeXlsx, pdf: writePdf }[format](doc, out);
}
