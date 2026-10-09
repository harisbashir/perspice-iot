import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';
import { filenameFrom } from './download';

const auditor = makeUser({ permissions: ['audit.read', 'export.data'] });
const auditPage = http.get('*/api/audit', () => HttpResponse.json({ items: [], nextCursor: null }));
const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  kind: 'audit',
  format: 'csv',
  title: 'Audit log',
  status: 'done',
  rowCount: 60_000,
  error: null,
  createdAt: Date.now(),
  expiresAt: Date.now() + 86_400_000,
  downloadUrl: '/api/files/exports/u/job-1/audit-log.csv?exp=1&sig=x',
  ...over,
});

describe('exports', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the filename from Content-Disposition', () => {
    expect(filenameFrom('attachment; filename="tower-17-telemetry-20260101-0000.csv"', 'x.csv')).toBe('tower-17-telemetry-20260101-0000.csv');
    expect(filenameFrom(null, 'export.pdf')).toBe('export.pdf');
  });

  it('downloads small exports straight away', async () => {
    let body: unknown;
    server.use(
      auditPage,
      http.post('*/api/exports', async ({ request }) => {
        body = await request.json();
        return new HttpResponse('Time (UTC),Action\n', {
          headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="audit-log.csv"' },
        });
      }),
    );
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderApp('/audit', { user: auditor });
    await user.click(await screen.findByRole('button', { name: /export/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'CSV' }));
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    expect(body).toEqual({ kind: 'audit', format: 'csv', params: {} });
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('audit-log.csv');
  });

  it('sends large exports to the job page, which offers the download when ready', async () => {
    let polls = 0;
    server.use(
      auditPage,
      http.post('*/api/exports', () => HttpResponse.json(job({ status: 'queued', rowCount: null, downloadUrl: null, expiresAt: null }), { status: 202 })),
      http.get('*/api/exports/job-1', () => HttpResponse.json(++polls < 2 ? job({ status: 'running', rowCount: null, downloadUrl: null }) : job())),
    );
    const user = userEvent.setup();
    renderApp('/audit', { user: auditor });
    await user.click(await screen.findByRole('button', { name: /export/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excel (XLSX)' }));
    expect(await screen.findByText(/prepared in the background/)).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'Download' }, { timeout: 4000 });
    expect(link).toHaveAttribute('href', job().downloadUrl);
    expect(screen.getByText('60,000 rows')).toBeInTheDocument();
  });

  it('shows expired jobs without a link', async () => {
    server.use(http.get('*/api/exports', () => HttpResponse.json([job({ downloadUrl: null })])));
    renderApp('/exports', { user: auditor });
    const row = (await screen.findByRole('cell', { name: 'Audit log' })).closest('tr')!;
    expect(within(row).getByText('Expired')).toBeInTheDocument();
    expect(within(row).getByText('60,000')).toBeInTheDocument();
  });

  it('hides export controls without export.data', async () => {
    server.use(auditPage);
    renderApp('/audit', { user: makeUser({ permissions: ['audit.read'] }) });
    await screen.findByRole('heading', { name: 'Audit log' });
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
  });
});
