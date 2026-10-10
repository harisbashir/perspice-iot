import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { alarmKpi } from '../src/library/alarms/alarm-kpi';
import { alarmTable } from '../src/library/alarms/alarm-table';
import { alarmTimeline } from '../src/library/alarms/alarm-timeline';
import { propsFor } from './props';

const ds = { kind: 'alarms' as const, filter: {}, pageSize: 10 };
const a = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  ruleId: 'r',
  ruleName: `Rule ${id}`,
  type: 'threshold',
  severity: 'critical',
  status: 'active',
  device: { id: 'd1', name: 'Tower 17', profileId: 'p' },
  customer: null,
  startedAt: Date.now() - 120_000,
  acknowledgedAt: null,
  acknowledgedBy: null,
  clearedAt: null,
  clearReason: null,
  value: null,
  message: 'm',
  ...over,
});

describe('alarm widgets', () => {
  it('table lists alarms and acknowledges active ones when allowed', async () => {
    const p = propsFor(alarmTable, { datasource: ds, result: { ok: true, data: { alarms: [a('1'), a('2', { status: 'acknowledged' })], total: 5 } } });
    render(<alarmTable.Component {...p} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('2 of 5')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Acknowledge' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(p.actions.ackAlarm).toHaveBeenCalledWith('1');
    await userEvent.click(screen.getByRole('link', { name: 'Rule 1' }));
    expect(p.actions.openAlarm).toHaveBeenCalledWith('1');
  });

  it('table hides acknowledge without permission', () => {
    render(<alarmTable.Component {...propsFor(alarmTable, { datasource: ds, can: { ack: false }, result: { ok: true, data: { alarms: [a('1')], total: 1 } } })} />);
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });

  it('KPI shows the chosen count', () => {
    const data = { critical: 2, major: 1, minor: 0, warning: 0, total: 3, unacknowledged: 2 };
    render(<alarmKpi.Component {...propsFor(alarmKpi, { datasource: ds, settings: { metric: 'unacknowledged' }, result: { ok: true, data } })} />);
    expect(screen.getByTestId('alarm-kpi')).toHaveTextContent('2');
  });

  it('timeline orders raised and cleared moments, newest first', () => {
    const now = Date.now();
    const alarms = [a('1', { startedAt: now - 3_600_000, clearedAt: now - 60_000, status: 'cleared' }), a('2', { startedAt: now - 600_000 })];
    render(<alarmTimeline.Component {...propsFor(alarmTimeline, { datasource: ds, result: { ok: true, data: { alarms, total: 2 } } })} />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/Rule 1.*Cleared/);
    expect(items[1]).toMatch(/Rule 2.*Raised/);
    expect(items[2]).toMatch(/Rule 1.*Raised/);
  });
});
