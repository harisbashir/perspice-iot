import type { LocationsData, WidgetDataResult } from '@perspice/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mapWidget } from '../src/library/maps/map';
import { device, propsFor } from './props';

// Leaflet sizes the map from the container; jsdom reports 0.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

const located = (n: number, spread = 0.01): WidgetDataResult<LocationsData> => ({
  ok: true,
  data: {
    truncated: false,
    devices: Array.from({ length: n }, (_, i) => ({
      ...device,
      id: `d${i}`,
      name: `Van ${i}`,
      status: (['online', 'offline', 'dead'] as const)[i % 3]!,
      location: { lat: 51.5 + (i % 10) * spread, lng: -0.12 + Math.floor(i / 10) * spread, ts: Date.now(), source: 'reported' as const },
      values: { fuel_level: { ts: 1, v: 40 + i } },
    })),
  },
});

const datasource = { kind: 'devicesOfProfile' as const, profileId: null, filter: {}, keys: ['fuel_level'] };

describe('map widget', () => {
  it('draws one marker per located device, coloured by status, over the configured tiles', async () => {
    const props = propsFor(mapWidget, { datasource, result: located(3) });
    const { container } = render(<mapWidget.Component {...props} />);
    expect(container.querySelectorAll('.perspice-marker')).toHaveLength(3);
    expect(container.querySelectorAll('.perspice-status-online')).toHaveLength(1);
    expect(container.querySelectorAll('.perspice-status-dead')).toHaveLength(1);
    await waitFor(() => expect(container.querySelector('.leaflet-tile-pane img, .leaflet-tile')).not.toBeNull());
    expect(props.actions.mapTiles).toHaveBeenCalled();
  });

  it('opens a popup with the chosen values and a link to the device', async () => {
    const props = propsFor(mapWidget, { datasource, result: located(1) });
    const { container } = render(<mapWidget.Component {...props} />);
    const marker = container.querySelector('.perspice-marker')!;
    act(() => {
      marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const popup = await waitFor(() => {
      const p = container.querySelector('.leaflet-popup-content');
      if (!p) throw new Error('no popup');
      return p as HTMLElement;
    });
    expect(popup).toHaveTextContent('Van 0');
    expect(popup).toHaveTextContent('Fuel level: 40.0 %'); // the profile's 1 decimal
    act(() => (popup.querySelector('button') as HTMLButtonElement).click());
    expect(props.actions.openDevice).toHaveBeenCalledWith('d0');
  });

  it('device names are text, never markup', async () => {
    const result = located(1);
    if (result.ok) result.data.devices[0]!.name = '<img src=x onerror=alert(1)>';
    const { container } = render(<mapWidget.Component {...propsFor(mapWidget, { datasource, result })} />);
    act(() => {
      container.querySelector('.perspice-marker')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(container.querySelector('.leaflet-popup-content')).not.toBeNull());
    expect(container.querySelector('.leaflet-popup-content img')).toBeNull();
    expect(container.querySelector('.leaflet-popup-content')).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('clusters when there are many devices', () => {
    const { container } = render(<mapWidget.Component {...propsFor(mapWidget, { datasource, result: located(150, 0.0001) })} />);
    expect(container.querySelectorAll('.marker-cluster').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.perspice-marker').length).toBeLessThan(150);
  });

  it('moves markers in place when a new location arrives', () => {
    const props = propsFor(mapWidget, { datasource, result: located(2) });
    const { container, rerender } = render(<mapWidget.Component {...props} />);
    const before = container.querySelector('.perspice-marker')!;
    const d = before.getAttribute('d');
    const moved = located(2);
    if (moved.ok) moved.data.devices[0]!.location = { ...moved.data.devices[0]!.location, lat: 51.52 };
    rerender(<mapWidget.Component {...props} result={moved} />);
    const after = container.querySelector('.perspice-marker')!;
    expect(after).toBe(before); // the same element, moved
    expect(after.getAttribute('d')).not.toBe(d);
  });

  it('draws the geofences the viewer can see', async () => {
    const props = propsFor(mapWidget, { datasource, result: located(1) });
    props.actions.geofences = async () => [
      { id: 'g1', name: 'Depot', customerId: 'c1', color: '#2563eb', shape: { type: 'circle', center: { lat: 51.5, lng: -0.12 }, radiusM: 300 }, createdAt: 0, updatedAt: 0 },
      { id: 'g2', name: 'Port', customerId: null, color: '#9333ea', shape: { type: 'polygon', coordinates: [[-0.13, 51.49], [-0.11, 51.49], [-0.11, 51.51], [-0.13, 51.49]] }, createdAt: 0, updatedAt: 0 },
    ];
    const { container } = render(<mapWidget.Component {...props} />);
    await waitFor(() => expect(container.querySelectorAll('.perspice-geofence')).toHaveLength(2));
  });

  it('says when no device has a location', () => {
    const { getByText } = render(<mapWidget.Component {...propsFor(mapWidget, { datasource, result: { ok: true, data: { truncated: false, devices: [] } } })} />);
    expect(getByText('No devices with a location')).toBeInTheDocument();
  });
});

describe('route playback', () => {
  const T0 = Date.now() - 3_600_000;
  const points = Array.from({ length: 20 }, (_, i) => ({ ts: T0 + i * 60_000, lat: 51.5 + i * 0.001, lng: -0.12, speed: 30 }));
  const trip = { id: 't1', deviceId: 'd0', startTs: T0 + 5 * 60_000, endTs: T0 + 15 * 60_000, start: { lat: 51.505, lng: -0.12 }, end: { lat: 51.515, lng: -0.12 }, distanceM: 1112, maxSpeedKmh: 30, avgSpeedKmh: 6.7 };
  const routeProps = () => {
    const props = propsFor(mapWidget, { datasource: { kind: 'currentDevice', keys: [] }, settings: { mode: 'route' }, result: located(1) });
    props.actions.route = vi.fn().mockResolvedValue({ points, downsampled: false });
    props.actions.trips = vi.fn().mockResolvedValue([trip]);
    return props;
  };

  it("draws the device's route over the dashboard's time window", async () => {
    const props = routeProps();
    const { container } = render(<mapWidget.Component {...props} />);
    await waitFor(() => expect(container.querySelector('.perspice-route')).not.toBeNull());
    expect(props.actions.route).toHaveBeenCalledWith('d0', expect.any(Number), expect.any(Number));
    const [, from, to] = (props.actions.route as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(to - from).toBe(86_400_000); // the last 24 h
  });

  it('the time slider moves the position marker along the route', async () => {
    const { container } = render(<mapWidget.Component {...routeProps()} />);
    const slider = await screen.findByRole('slider', { name: 'Time' });
    const marker = () => container.querySelector('.perspice-position')!.getAttribute('d');
    const start = marker();
    fireEvent.change(slider, { target: { value: '19' } });
    expect(marker()).not.toBe(start);
    expect(screen.getByTestId('route-time')).toHaveTextContent(new Date(points[19]!.ts).toLocaleTimeString());
  });

  it('plays the route', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<mapWidget.Component {...routeProps()} />);
      const slider = await screen.findByRole('slider', { name: 'Time' });
      fireEvent.click(screen.getByRole('button', { name: 'Play' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(Number((slider as HTMLInputElement).value)).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists trips; choosing one moves to its start', async () => {
    render(<mapWidget.Component {...routeProps()} />);
    const item = await screen.findByRole('button', { name: /1\.1 km/ });
    fireEvent.click(item);
    expect((screen.getByRole('slider', { name: 'Time' }) as HTMLInputElement).value).toBe('5');
  });

  it('asks for a single device', () => {
    render(<mapWidget.Component {...propsFor(mapWidget, { datasource, settings: { mode: 'route' }, result: located(3) })} />);
    expect(screen.getByText(/Route playback shows one device/)).toBeInTheDocument();
  });
});
