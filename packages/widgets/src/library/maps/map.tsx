import type { DeviceProfileDto, GeofenceDto, LocationsData } from '@perspice/shared';
import { Map as MapIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
  status.className = 'text-xs text-slate-500';
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

  // The map, tiles and geofences: once.
  useEffect(() => {
    const m = L.map(el.current!, { worldCopyJump: true, maxZoom: 19 }).setView([20, 0], 2);
    map.current = m;
    let alive = true;
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
      else m.fitBounds(L.latLngBounds(data.devices.map((d) => [d.location.lat, d.location.lng] as [number, number])), { padding: [24, 24], maxZoom: 16 });
    }
  }, [data, settings.cluster, settings.fit]);

  return <div ref={el} className="h-full w-full rounded" data-testid="map" />;
}

export const mapWidget: WidgetDefinition<Settings> = {
  type: 'map',
  name: 'Map',
  description: 'Devices on a map, coloured by status, with geofences.',
  icon: MapIcon,
  category: 'map',
  settingsSchema: schema,
  data: { mode: 'locations', sources: ['currentDevice', 'device', 'devicesOfProfile', 'entityList'], keys: { min: 0, max: 5 } },
  defaultSize: { w: 8, h: 8 },
  Component: ({ config, settings, result, profile, actions }) => {
    const data = dataOf(result);
    const ds = config.datasource;
    const keys = 'keys' in ds ? ds.keys : ds.kind === 'entityList' ? ds.columns : [];
    return (
      <WidgetStatus result={result}>
        {isLocations(data) && (
          <div className="relative h-full">
            <MapView data={data} keys={keys} settings={settings} profile={profile} actions={actions} />
            {data.devices.length === 0 && (
              <p className="pointer-events-none absolute inset-x-0 top-2 z-[1000] text-center text-xs text-slate-500">No devices with a location</p>
            )}
            {data.truncated && <p className="absolute bottom-1 left-1 z-[1000] rounded bg-white/80 px-1 text-xs text-slate-600">Showing the first 5,000 devices</p>}
          </div>
        )}
      </WidgetStatus>
    );
  },
};

