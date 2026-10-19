import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { arcGauge, arcGaugeModel, zonesOf } from '../src/library/gauges/arc-gauge';
import { barGauge, segmentsOf } from '../src/library/gauges/bar-gauge';
import { barList, barRows } from '../src/library/gauges/bar-list';
import { ringFractions, ringGauge } from '../src/library/gauges/ring-gauge';
import { signalBars, signalLevel } from '../src/library/gauges/signal-bars';
import { device, latest, propsFor } from './props';

const range = { min: 0, max: 100, decimals: 0, unit: '', lowIsBad: false };

describe('dial', () => {
  it('fills to the value and takes its band', () => {
    expect(arcGaugeModel({ ...range, warnAt: 70, critAt: 90 }, 75)).toEqual({ fraction: 0.75, band: 'warn' });
    expect(arcGaugeModel(range, null).fraction).toBe(0);
    expect(arcGaugeModel(range, 140).fraction).toBe(1);
  });

  it('marks the zones on the rim, from the bottom when low values are bad', () => {
    expect(zonesOf({ ...range, warnAt: 70, critAt: 90 })).toEqual([
      { band: 'warn', from: 0.7, to: 0.9 },
      { band: 'crit', from: 0.9, to: 1 },
    ]);
    expect(zonesOf({ ...range, lowIsBad: true, warnAt: 30, critAt: 15 })).toEqual([
      { band: 'crit', from: 0, to: 0.15 },
      { band: 'warn', from: 0.15, to: 0.3 },
    ]);
    expect(zonesOf(range)).toEqual([]);
  });

  it('renders a meter with the reading and the profile unit', () => {
    render(<arcGauge.Component {...propsFor(arcGauge, { result: latest({ fuel_level: 64.4 }) })} />);
    const meter = screen.getByRole('meter', { name: 'Widget' });
    expect(meter).toHaveAttribute('aria-valuenow', '64.4');
    expect(meter).toHaveAttribute('aria-valuetext', '64 %');
    expect(meter).toHaveTextContent('64');
  });
});

describe('rings', () => {
  it('share one range', () => {
    expect(ringFractions({ min: 0, max: 200 }, [50, null, 300])).toEqual([0.25, 0, 1]);
  });

  it('lists up to three keys with their values', () => {
    render(
      <ringGauge.Component
        {...propsFor(ringGauge, { datasource: { kind: 'currentDevice', keys: ['fuel_level', 'batt_v'] }, settings: { decimals: 1 }, result: latest({ fuel_level: 42, batt_v: 51.2 }) })}
      />,
    );
    expect(screen.getByRole('meter', { name: 'Fuel level' })).toHaveTextContent('42.0 %');
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveTextContent('51.2 V');
  });
});

describe('segmented meter', () => {
  it('lights segments up to the value, each in the band it sits in', () => {
    const segs = segmentsOf(barGauge.settingsSchema.parse({ segments: 10, warnAt: 60, critAt: 80 }), 72);
    expect(segs.filter((s) => s.lit)).toHaveLength(7);
    expect(segs.map((s) => s.band)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'warn', 'warn', 'crit', 'crit']);
  });

  it('renders a meter', () => {
    render(<barGauge.Component {...propsFor(barGauge, { result: latest({ fuel_level: 30 }) })} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '30');
  });
});

describe('ranked bars', () => {
  const rows = [
    { id: 'a', label: 'A', value: 10 },
    { id: 'b', label: 'B', value: 40 },
    { id: 'c', label: 'C', value: null },
    { id: 'd', label: 'D', value: 20 },
  ];

  it('sorts, limits and scales to the largest value', () => {
    expect(barRows(rows, { sort: 'desc', limit: 3 }).map((r) => [r.id, r.fraction])).toEqual([
      ['b', 1],
      ['d', 0.5],
      ['a', 0.25],
    ]);
    expect(barRows(rows, { sort: 'asc', limit: 2 }).map((r) => r.id)).toEqual(['c', 'a']);
    expect(barRows(rows, { sort: 'none', limit: 10, max: 80 }).map((r) => r.fraction)).toEqual([0.125, 0.5, 0, 0.25]);
  });

  it('opens a device from a fleet row', async () => {
    const fleet = {
      ok: true as const,
      data: { devices: [{ ...device, values: { fuel_level: { ts: 1, v: 12.5 } } }, { ...device, id: 'd2', name: 'Tower 18', values: { fuel_level: { ts: 1, v: 80 } } }] },
    };
    const p = propsFor(barList, { datasource: { kind: 'devicesOfProfile', profileId: null, keys: ['fuel_level'] }, result: fleet });
    render(<barList.Component {...p} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Tower 18');
    expect(buttons[1]).toHaveTextContent('12.5 %');
    await userEvent.click(buttons[0]!);
    expect(p.actions.openDevice).toHaveBeenCalledWith('d2');
  });
});

describe('signal strength', () => {
  it('maps readings to bars', () => {
    expect([-60, -70, -80, -90, -100].map((v) => signalLevel('dbm', v))).toEqual([4, 3, 2, 1, 0]);
    expect(signalLevel('percent', 65)).toBe(3);
    expect(signalLevel('csq', 99)).toBeNull();
    expect(signalLevel('csq', 17)).toBe(3);
  });

  it('says the quality in words', () => {
    render(<signalBars.Component {...propsFor(signalBars, { datasource: { kind: 'currentDevice', keys: ['rssi'] }, result: latest({ rssi: -71 }) })} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', 'Good');
    expect(screen.getByText('Good')).toBeInTheDocument();
  });
});
