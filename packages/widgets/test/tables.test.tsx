import type { ListData } from '@perspice/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { entityTable } from '../src/library/tables/entity-table';
import { historyTable } from '../src/library/tables/history-table';
import { latestTable } from '../src/library/tables/latest-table';
import { device, latest, propsFor } from './props';

const list = (n: number, total = n): ListData => ({
  items: Array.from({ length: n }, (_, i) => ({
    ...device,
    id: `d${i}`,
    name: `Site ${i}`,
    profileName: 'RMS',
    customerName: 'Acme',
    values: { fuel_level: { ts: 1, v: i * 10 } },
  })),
  total,
  page: 0,
  pageSize: n,
});

describe('table widgets', () => {
  it('latest table lists keys with labels and formatted values', () => {
    render(
      <latestTable.Component
        {...propsFor(latestTable, { datasource: { kind: 'currentDevice', keys: ['fuel_level', 'gen_running'] }, result: latest({ fuel_level: 12.34, gen_running: false }) })}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]!).getByText('Fuel level')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('12.3 %')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('No')).toBeInTheDocument();
  });

  it('history table merges series by timestamp, newest first', () => {
    render(
      <historyTable.Component
        {...propsFor(historyTable, {
          datasource: { kind: 'currentDevice', keys: ['fuel_level', 'batt_v'] },
          result: {
            ok: true,
            data: {
              source: 'raw',
              series: {
                fuel_level: [
                  [1000, 10],
                  [2000, 20],
                ],
                batt_v: [[2000, 50]],
              },
            },
          },
        })}
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('20.0 %')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('50.00 V')).toBeInTheDocument();
    expect(within(rows[1]!).getAllByText('—')).toHaveLength(1);
  });

  it('entity table sorts, pages and opens devices', async () => {
    const p = propsFor(entityTable, {
      datasource: { kind: 'entityList', profileId: null, columns: ['status', 'name', 'customer', 'fuel_level'], pageSize: 2 },
      settings: { linkToDevice: true },
      result: { ok: true, data: list(2, 5) },
    });
    render(<entityTable.Component {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /Fuel level/ }));
    expect(p.actions.setQuery).toHaveBeenLastCalledWith({ sort: { by: 'fuel_level', dir: 'asc' } });
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(p.actions.setQuery).toHaveBeenLastCalledWith({ page: 1 });
    expect(screen.getByText('1–2 of 5')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Site 1' }));
    expect(p.actions.openDevice).toHaveBeenCalledWith('d1');
    expect(screen.getByRole('columnheader', { name: /Customer/ })).toBeInTheDocument();
  });

  it('entity table filters by customer for platform viewers only', async () => {
    const data = { ...list(1), customers: [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Beta' }] };
    const ds = { kind: 'entityList' as const, profileId: null, columns: ['name', 'customer'], pageSize: 2 };
    const p = propsFor(entityTable, { datasource: ds, result: { ok: true, data } });
    const { unmount } = render(<entityTable.Component {...p} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by customer' }), 'Beta');
    expect(p.actions.setQuery).toHaveBeenLastCalledWith({ customerId: 'c2', page: 0 });
    unmount();
    render(<entityTable.Component {...propsFor(entityTable, { datasource: ds, result: { ok: true, data }, scopeType: 'customer' })} />);
    expect(screen.queryByRole('combobox', { name: 'Filter by customer' })).not.toBeInTheDocument();
  });

  it('entity table hides the customer column on customer portals', () => {
    render(
      <entityTable.Component
        {...propsFor(entityTable, {
          datasource: { kind: 'entityList', profileId: null, columns: ['name', 'customer'], pageSize: 2 },
          result: { ok: true, data: list(1) },
          scopeType: 'customer',
        })}
      />,
    );
    expect(screen.queryByRole('columnheader', { name: /Customer/ })).not.toBeInTheDocument();
  });
});
