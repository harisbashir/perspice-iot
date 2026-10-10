import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { batteryWidget } from '../src/library/values/battery';
import { kpiWidget } from '../src/library/values/kpi';
import { ledWidget } from '../src/library/values/led';
import { multiValueWidget } from '../src/library/values/multi-value';
import { progressWidget } from '../src/library/values/progress';
import { tankWidget } from '../src/library/values/tank';
import { valueCard } from '../src/library/values/value-card';
import { latest, propsFor } from './props';

describe('value widgets', () => {
  it('value card formats with the profile decimals and unit and shows a trend', () => {
    const p = propsFor(valueCard, { result: latest({ fuel_level: 64.567 }) });
    const { rerender } = render(<valueCard.Component {...p} />);
    expect(screen.getByTestId('value')).toHaveTextContent('64.6 %');
    rerender(<valueCard.Component {...p} result={latest({ fuel_level: 70 })} />);
    expect(screen.getByTestId('value')).toHaveTextContent('70.0 %');
    expect(screen.getByLabelText('Rising')).toBeInTheDocument();
  });

  it('multi-value card lists every key with labels', () => {
    render(
      <multiValueWidget.Component
        {...propsFor(multiValueWidget, { datasource: { kind: 'currentDevice', keys: ['fuel_level', 'batt_v'] }, result: latest({ fuel_level: 50, batt_v: 52.126 }) })}
      />,
    );
    expect(screen.getByText('Fuel level')).toBeInTheDocument();
    expect(screen.getByText('52.13 V')).toBeInTheDocument();
  });

  it('LED shows on/off with text labels, from booleans or a numeric threshold', () => {
    const p = propsFor(ledWidget, { datasource: { kind: 'currentDevice', keys: ['gen_running'] }, result: latest({ gen_running: true }) });
    const { rerender } = render(<ledWidget.Component {...p} />);
    expect(screen.getByRole('status')).toHaveTextContent('On');
    rerender(<ledWidget.Component {...p} result={latest({ gen_running: false })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Off');
    const t = propsFor(ledWidget, { settings: { threshold: 20, onLabel: 'Low fuel', offLabel: 'OK', invert: true }, result: latest({ fuel_level: 10 }) });
    rerender(<ledWidget.Component {...t} />);
    expect(screen.getByRole('status')).toHaveTextContent('Low fuel');
  });

  it('progress, battery and tank compute fractions within their range', () => {
    render(<progressWidget.Component {...propsFor(progressWidget, { settings: { min: 0, max: 200 }, result: latest({ fuel_level: 50 }) })} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    render(
      <batteryWidget.Component
        {...propsFor(batteryWidget, { datasource: { kind: 'currentDevice', keys: ['batt_v'] }, settings: { min: 44, max: 56 }, result: latest({ batt_v: 50 }) })}
      />,
    );
    expect(screen.getByRole('meter', { name: /battery/i })).toHaveAttribute('aria-valuenow', '50');
    render(<tankWidget.Component {...propsFor(tankWidget, { settings: { min: 0, max: 100 }, result: latest({ fuel_level: 120 }) })} />);
    expect(screen.getByRole('meter', { name: /level/i })).toHaveAttribute('aria-valuenow', '100');
  });

  it('KPI tile shows the chosen fleet metric', () => {
    render(
      <kpiWidget.Component
        {...propsFor(kpiWidget, {
          datasource: { kind: 'devicesOfProfile', profileId: null, keys: [] },
          settings: { metric: 'offline' },
          result: { ok: true, data: { total: 10, online: 7, offline: 2, dead: 1, never: 0, messages24h: 12345 } },
        })}
      />,
    );
    expect(screen.getByTestId('kpi')).toHaveTextContent('2');
  });

  it('shows a clear message when the data source is not available', () => {
    render(<valueCard.Component {...propsFor(valueCard, { result: { ok: false, code: 'NOT_FOUND', message: 'Not found' } })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Data source not available');
  });
});
