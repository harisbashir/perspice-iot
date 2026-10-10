import type { EnergyData } from '@perspice/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { changePct, energyBarOption, energySummary } from '../src/library/values/energy-summary';
import { propsFor } from './props';

const data = (o: Partial<EnergyData> = {}): EnergyData => ({
  key: 'energy_used',
  unit: 'kWh',
  timezone: 'Europe/London',
  currency: 'GBP',
  period: 'day',
  periods: [
    { period: '2026-10-01', consumption: 10, cost: 2 },
    { period: '2026-10-02', consumption: 14.5, cost: 3.1 },
  ],
  total: { consumption: 24.5, cost: 5.1 },
  previous: { consumption: 20, cost: 4 },
  ...o,
});

describe('energy summary widget', () => {
  it('shows consumption, cost and the change against the previous period', () => {
    render(
      <energySummary.Component
        {...propsFor(energySummary, { datasource: { kind: 'currentDevice', keys: ['energy_used'] }, settings: { range: 'month', showChart: false }, result: { ok: true, data: data() } })}
      />,
    );
    expect(screen.getByTestId('energy-total')).toHaveTextContent('24.5 kWh');
    expect(screen.getByTestId('energy-cost')).toHaveTextContent('£5.10');
    expect(screen.getByTestId('energy-change')).toHaveTextContent('▲ 23% compared with last month so far');
  });

  it('leaves out cost without a tariff and the change without a previous period', () => {
    render(
      <energySummary.Component
        {...propsFor(energySummary, {
          datasource: { kind: 'currentDevice', keys: ['energy_used'] },
          settings: { range: 'today', showChart: false },
          result: { ok: true, data: data({ currency: null, total: { consumption: 3, cost: null }, previous: { consumption: 0, cost: null } }) },
        })}
      />,
    );
    expect(screen.getByTestId('energy-total')).toHaveTextContent('3 kWh');
    expect(screen.queryByTestId('energy-cost')).not.toBeInTheDocument();
    expect(screen.queryByTestId('energy-change')).not.toBeInTheDocument();
  });

  it('labels bars by hour, day or month', () => {
    expect(energyBarOption(data()).xAxis.data).toEqual(['10-01', '10-02']);
    expect(energyBarOption(data({ period: 'hour', periods: [{ period: '2026-10-01T17:00', consumption: 1, cost: null }] })).xAxis.data).toEqual(['17:00']);
    expect(energyBarOption(data({ period: 'month', periods: [{ period: '2026-10', consumption: 1, cost: null }] })).series[0]!.data).toEqual([1]);
    expect(changePct(data({ total: { consumption: 15, cost: null } }))).toBe(-25);
  });

  it('asks the dashboard for energy data of one key', () => {
    expect(energySummary.data).toEqual({ mode: 'energy', sources: ['currentDevice', 'device', 'currentAsset'], keys: { min: 1, max: 1 } });
    expect(energySummary.settingsSchema.parse({})).toEqual({ range: 'month', showChart: true });
  });
});
