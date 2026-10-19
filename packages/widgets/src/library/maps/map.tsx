import type { DeviceProfileDto, GeofenceDto, LocationsData, RoutePoint, Timewindow, TripDto } from '@perspice/shared';
import { Map as MapIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { formatValue, keyDef, timeAgo } from '../../data/format';
import { dataOf, isLocations } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetActions, WidgetDefinition } from '../../sdk';
import L from './leaflet';
import 'leaflet.markercluster';

/** Clustering starts above this many markers (when enabled). */
export const CLUSTER_THRESHOLD = 100;

const STATUS_COLOR: Record<string, string> = { online: '#16a34a', offline: '#d97706', dead: '#dc2626', never: '#94a3b8' };

const schema = z.object({
  mode: field.select('Show', ['markers', 'route'], 'Route: one device’s path over the time window, with playback').default('markers'),
  cluster: field.boolean('Group nearby devices when there are many').default(true),
  showGeofences: field.boolean('Show geofences').default(true),
  fit: field.boolean('Zoom to the devices').default(true),
});
type Settings = z.infer<typeof schema>;

type Located = LocationsData['devices'][number];

/** Popup content, built from DOM nodes (device names and values are never parsed as HTML). */
function popupFor(d: Located, keys: string[], profile: DeviceProfileDto | null, actions: WidgetActions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'space-y-1 text-sm';
  const name = document.createElement('div');
  name.className = 'font-medium';
  name.textContent = d.name;
  const status = document.createElement('div');
  status.className = 'text-xs text-fg-muted';
  status.textContent = `${d.status}${d.location.ts ? ` · located ${timeAgo(d.location.ts)}` : ''}`;
  root.append(name, status);
  for (const k of keys) {
    const line = document.createElement('div');
    const def = keyDef(profile, k);
    line.textContent = `${def?.label ?? k}: ${formatValue(d.values[k]?.v, def)}`;
    root.append(line);
  }
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'text-xs font-medium text-blue-600 underline';
  open.textContent = 'Open device';
  open.addEventListener('click', () => actions.openDevice(d.id));
  root.append(open);
  return root;
}

function geofenceLayer(g: GeofenceDto): L.Layer {
  const style = { color: g.color, weight: 2, fillOpacity: 0.08, className: 'perspice-geofence' };
  const layer =
    g.shape.type === 'circle'
      ? L.circle([g.shape.center.lat, g.shape.center.lng], { ...style, radius: g.shape.radiusM })
      : L.polygon(
          g.shape.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
          style,
        );
  return layer.bindTooltip(g.name);
}

const markerClass = (status: string) => `perspice-marker perspice-status-${status}`;

function MapView({ data, keys, settings, profile, actions }: { data: LocationsData; keys: string[]; settings: Settings; profile: DeviceProfileDto | null; actions: WidgetActions }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const group = useRef<{ layer: L.LayerGroup; clustered: boolean } | null>(null);
  const markers = useRef(new Map<string, L.CircleMarker>());
  /** Each marker's newest data, read when its popup opens. */
  const current = useRef(new Map<string, Located>());
  const popupArgs = useRef({ keys, profile, actions });
  popupArgs.current = { keys, profile, actions };
  const fitted = useRef(false);
  /** The bounds last fitted to; re-fitted when the frame resizes, until someone moves the map. */
  const fitBounds = useRef<L.LatLngBounds | null>(null);

  // The map, tiles and geofences: once.
  useEffect(() => {
    const m = L.map(el.current!, { worldCopyJump: true, maxZoom: 19 }).setView([20, 0], 2);
    map.current = m;
    let alive = true;
    const stopWatching = watchSize(m, () => fitBounds.current && m.fitBounds(fitBounds.current, { padding: [24, 24], maxZoom: 16 }), () => (fitBounds.current = null));
    void actions.mapTiles().then((t) => {
      if (!alive) return;
      m.setMaxZoom(t.maxZoom);
      L.tileLayer(t.urlTemplate, { attribution: t.attribution, maxZoom: t.maxZoom }).addTo(m);
    });
    if (settings.showGeofences) {
      void actions.geofences().then((gs) => {
        if (alive) for (const g of gs) geofenceLayer(g).addTo(m);
      });
    }
    return () => {
      alive = false;
      stopWatching();
      m.remove();
      map.current = null;
      group.current = null;
      markers.current.clear();
      current.current.clear();
    };
    // Once per mount: settings changes remount the widget (keyed by config in the dashboard).
  }, []);

  // Markers: diffed on each result so live updates move them in place.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const clustered = settings.cluster && data.devices.length > CLUSTER_THRESHOLD;
    if (!group.current || group.current.clustered !== clustered) {
      group.current?.layer.remove();
      markers.current.clear();
      const layer = clustered ? L.markerClusterGroup({ showCoverageOnHover: false, disableClusteringAtZoom: 17 }) : L.layerGroup();
      group.current = { layer: layer.addTo(m), clustered };
    }
    const layer = group.current.layer;
    const seen = new Set<string>();
    for (const d of data.devices) {
      seen.add(d.id);
      current.current.set(d.id, d);
      const pos: L.LatLngExpression = [d.location.lat, d.location.lng];
      const color = STATUS_COLOR[d.status] ?? STATUS_COLOR.never!;
      const existing = markers.current.get(d.id);
      if (existing) {
        existing.setLatLng(pos);
        existing.setStyle({ color, fillColor: color });
        const path = existing.getElement();
        if (path) path.setAttribute('class', `${markerClass(d.status)} leaflet-interactive`);
      } else {
        const marker = L.circleMarker(pos, { radius: 7, color, fillColor: color, fillOpacity: 0.9, weight: 2, className: markerClass(d.status) });
        const id = d.id;
        marker.bindPopup(() => {
          const a = popupArgs.current;
          return popupFor(current.current.get(id) ?? d, a.keys, a.profile, a.actions);
        });
        markers.current.set(d.id, marker);
        layer.addLayer(marker);
      }
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        layer.removeLayer(marker);
        markers.current.delete(id);
        current.current.delete(id);
      }
    }
    if (settings.fit && !fitted.current && data.devices.length) {
      fitted.current = true;
      if (data.devices.length === 1) m.setView([data.devices[0]!.location.lat, data.devices[0]!.location.lng], 15);
      else {
        fitBounds.current = L.latLngBounds(data.devices.map((d) => [d.location.lat, d.location.lng] as [number, number]));
        m.fitBounds(fitBounds.current, { padding: [24, 24], maxZoom: 16 });
      }
    }
  }, [data, settings.cluster, settings.fit]);

  return <div ref={el} className="h-full w-full overflow-hidden rounded-lg" data-testid="map" />;
}

/**
 * Keeps Leaflet in step with its frame (dashboards resize widgets; phones stack them): redraws on
 * every size change and calls `onResize` until the person drags, zooms or scrolls the map.
 */
function watchSize(m: L.Map, onResize: () => void, onTouched: () => void): () => void {
  const container = m.getContainer();
  let touched = false;
  const touch = () => {
    touched = true;
    onTouched();
  };
  container.addEventListener('pointerdown', touch);
  container.addEventListener('wheel', touch, { passive: true });
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    m.invalidateSize();
    if (!touched) onResize();
  });
  observer?.observe(container);
  return () => {
    observer?.disconnect();
    container.removeEventListener('pointerdown', touch);
    container.removeEventListener('wheel', touch);
  };
}

const SPEEDS = [1, 10, 60, 300] as const;
const windowOf = (tw: Timewindow): [number, number] => (tw.kind === 'absolute' ? [tw.fromMs, tw.toMs] : [Date.now() - tw.lastMs, Date.now()]);

/** One device's fixes over the time window, with a time slider, playback and its trips. */
function RouteView({ deviceId, timewindow, settings, actions }: { deviceId: string; timewindow: Timewindow; settings: Settings; actions: WidgetActions }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const position = useRef<L.CircleMarker | null>(null);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [trips, setTrips] = useState<TripDto[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const m = L.map(el.current!, { maxZoom: 19 }).setView([20, 0], 2);
    const stopWatching = watchSize(m, () => undefined, () => undefined);
    map.current = m;
    let alive = true;
    void actions.mapTiles().then((t) => {
      if (!alive) return;
      m.setMaxZoom(t.maxZoom);
      L.tileLayer(t.urlTemplate, { attribution: t.attribution, maxZoom: t.maxZoom }).addTo(m);
    });
    if (settings.showGeofences) void actions.geofences().then((gs) => alive && gs.forEach((g) => geofenceLayer(g).addTo(m)));
    const [from, to] = windowOf(timewindow);
    void Promise.all([actions.route(deviceId, from, to), actions.trips(deviceId, from, to)]).then(([route, t]) => {
      if (!alive) return;
      setPoints(route.points);
      setTrips(t);
      setLoading(false);
      if (!route.points.length) return;
      const line = route.points.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(line, { color: '#2563eb', weight: 3, className: 'perspice-route' }).addTo(m);
      position.current = L.circleMarker(line[0]!, { radius: 7, color: '#1e3a8a', fillColor: '#ffffff', fillOpacity: 1, weight: 3, className: 'perspice-position' }).addTo(m);
      m.fitBounds(L.latLngBounds(line), { padding: [24, 24], maxZoom: 16 });
    });
    return () => {
      alive = false;
      stopWatching();
      m.remove();
      map.current = null;
      position.current = null;
    };
    // Once per mount: the dashboard remounts the widget when its time window or settings change.
  }, []);

  // Move the position marker with the slider.
  useEffect(() => {
    const p = points[index];
    if (p) position.current?.setLatLng([p.lat, p.lng]);
  }, [index, points]);

  // Playback: advance through the fixes at `speed` × real time (at least one fix per tick).
  useEffect(() => {
    if (!playing || points.length < 2) return;
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= points.length - 1) {
          setPlaying(false);
          return i;
        }
        const target = points[i]!.ts + speed * 250;
        let j = i + 1;
        while (j < points.length - 1 && points[j + 1]!.ts <= target) j++;
        return j;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [playing, points, speed]);

  const pickTrip = (t: TripDto) => {
    const start = points.findIndex((p) => p.ts >= t.startTs);
    if (start >= 0) setIndex(start);
    const inTrip = points.filter((p) => p.ts >= t.startTs && p.ts <= (t.endTs ?? Infinity)).map((p) => [p.lat, p.lng] as [number, number]);
    if (inTrip.length) map.current?.fitBounds(L.latLngBounds(inTrip), { padding: [24, 24], maxZoom: 17 });
  };
  const current = points[index];

  return (
    <div className="flex h-full gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div ref={el} className="min-h-0 flex-1 rounded" data-testid="map" />
        {!loading && !points.length && <p className="text-center text-xs text-fg-muted">No locations in this period</p>}
        {points.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <button type="button" className="rounded border px-2 py-0.5" onClick={() => setPlaying(!playing)}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              type="range"
              aria-label="Time"
              className="min-w-0 flex-1"
              min={0}
              max={points.length - 1}
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
            />
            <select aria-label="Playback speed" className="rounded border px-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <span data-testid="route-time" className="tabular-nums text-fg-muted">
              {current ? new Date(current.ts).toLocaleTimeString() : ''}
              {current?.speed !== undefined ? ` · ${Math.round(current.speed)} km/h` : ''}
            </span>
          </div>
        )}
      </div>
      {trips.length > 0 && (
        <ul className="w-40 shrink-0 space-y-1 overflow-y-auto text-xs" aria-label="Trips">
          {trips.map((t) => (
            <li key={t.id}>
              <button type="button" className="w-full rounded border px-2 py-1 text-left hover:bg-fill" onClick={() => pickTrip(t)}>
                <span className="block">{new Date(t.startTs).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="text-fg-muted">
                  {(t.distanceM / 1000).toFixed(1)} km{t.endTs === null ? ' · under way' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const mapWidget: WidgetDefinition<Settings> = {
  type: 'map',
  name: 'Map',
  description: 'Devices on a map, coloured by status, with geofences.',
  icon: MapIcon,
  category: 'map',
  settingsSchema: schema,
  data: { mode: 'locations', sources: ['currentDevice', 'device', 'devicesOfProfile', 'currentAsset', 'entityList'], keys: { min: 0, max: 5 } },
  defaultSize: { w: 8, h: 8 },
  Component: ({ config, settings, result, profile, actions, timewindow }) => {
    const data = dataOf(result);
    const ds = config.datasource;
    const keys = 'keys' in ds ? ds.keys : ds.kind === 'entityList' ? ds.columns : [];
    if (settings.mode === 'route') {
      const single = ds.kind === 'currentDevice' || ds.kind === 'device';
      const deviceId = isLocations(data) ? data.devices[0]?.id : undefined;
      return (
        <WidgetStatus result={result}>
          {!single ? (
            <p className="p-2 text-sm text-fg-muted">Route playback shows one device: choose “This device” or a single device as the data source.</p>
          ) : deviceId ? (
            <RouteView deviceId={deviceId} timewindow={timewindow} settings={settings} actions={actions} />
          ) : (
            <p className="p-2 text-sm text-fg-muted">This device has no location yet.</p>
          )}
        </WidgetStatus>
      );
    }
    return (
      <WidgetStatus result={result}>
        {isLocations(data) && (
          <div className="relative h-full">
            <MapView data={data} keys={keys} settings={settings} profile={profile} actions={actions} />
            {data.devices.length === 0 && (
              <p className="pointer-events-none absolute inset-x-0 top-2 z-[1000] text-center text-xs text-fg-muted">No devices with a location</p>
            )}
            {data.truncated && <p className="absolute bottom-1 left-1 z-[1000] rounded bg-surface/80 px-1 text-xs text-fg-muted">Showing the first 5,000 devices</p>}
          </div>
        )}
      </WidgetStatus>
    );
  },
};

