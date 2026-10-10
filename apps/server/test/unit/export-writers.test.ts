import type { BrandingDto } from '@perspice/shared';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { exportFilename } from '../../src/exports/exports.service';
import { type Cell, type Column, writeExport } from '../../src/exports/writers';

const branding = { productName: 'Perspice', primaryColor: '#2563eb' } as BrandingDto;

async function csv(columns: Column[], rows: Cell[][]): Promise<string> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on('data', (c: Buffer) => chunks.push(c));
  const n = await writeExport('csv', { title: 'T', columns, rows: (async function* () { yield* rows; })(), branding }, out);
  await new Promise((r) => out.on('end', r));
  expect(n).toBe(rows.length);
  return Buffer.concat(chunks).toString();
}

describe('export writers', () => {
  it('quotes CSV fields and formats times as UTC', async () => {
    const text = await csv(
      [{ header: 'Time (UTC)', kind: 'time' }, { header: 'Note', kind: 'text' }, { header: 'V', kind: 'number' }],
      [[new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), 'a, "b"\nc', -1.5], [null, { x: 1 }, null]],
    );
    expect(text).toBe('Time (UTC),Note,V\n2026-01-02 03:04:05,"a, ""b""\nc",-1.5\n,"{""x"":1}",\n');
  });

  it('neutralises spreadsheet formulas in text cells only', async () => {
    const text = await csv([{ header: 'Name', kind: 'text' }, { header: 'V', kind: 'number' }], [['=HYPERLINK("x")', -3], ['@SUM(A1)', 0]]);
    expect(text.split('\n').slice(1, 3)).toEqual([`"'=HYPERLINK(""x"")",-3`, "'@SUM(A1),0"]);
  });

  it('names files after the title and time', () => {
    expect(exportFilename('Tower 17 telemetry', 'csv', new Date(Date.UTC(2026, 0, 2, 3, 4)))).toBe('tower-17-telemetry-20260102-0304.csv');
    expect(exportFilename('***', 'pdf', new Date(0))).toBe('export-19700101-0000.pdf');
  });
});
