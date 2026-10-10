import type { DeviceDto, DeviceLocationDto, DeviceProfileDto } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useLeafletMap } from '@/maps/useLeafletMap';
import { patchDevice } from '@/realtime/hooks';
import { timeAgo } from './format';

const fmt = (n: number) => n.toFixed(6);

/**
 * The device's location on a map. Users who can edit devices set a fixed location by clicking
 * the map or typing coordinates (a reported location is replaced by the next fix).
 */
export function LocationPanel({ device, profile }: { device: DeviceDto; profile: DeviceProfileDto }) {
  const { hasPerm } = useAuth();
  const qc = useQueryClient();
  const el = useRef<HTMLDivElement>(null);
  const map = useLeafletMap(el);
  const marker = useRef<L.CircleMarker | null>(null);
  const draftMarker = useRef<L.Marker | null>(null);
  const [draft, setDraft] = useState<{ lat: string; lng: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loc = device.location;
  const canEdit = hasPerm('device.write');

  // The current location, kept in view.
  useEffect(() => {
    if (!map) return;
    marker.current?.remove();
    marker.current = null;
    if (!loc) return;
    marker.current = L.circleMarker([loc.lat, loc.lng], { radius: 8, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.9, className: 'perspice-current-location' }).addTo(map);
    if (loc.accuracy) L.circle([loc.lat, loc.lng], { radius: loc.accuracy, weight: 1, fillOpacity: 0.05, interactive: false }).addTo(map);
    map.setView([loc.lat, loc.lng], Math.max(map.getZoom(), 15));
  }, [map, loc]);

  // Clicking the map while editing moves the draft pin.
  useEffect(() => {
    if (!map || !draft) return;
    const onClick = (e: L.LeafletMouseEvent) => setDraft({ lat: fmt(e.latlng.lat), lng: fmt(e.latlng.lng) });
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map, draft]);
  useEffect(() => {
    draftMarker.current?.remove();
    draftMarker.current = null;
    const lat = Number(draft?.lat);
    const lng = Number(draft?.lng);
    if (map && draft && Number.isFinite(lat) && Number.isFinite(lng) && draft.lat !== '' && draft.lng !== '') {
      draftMarker.current = L.marker([lat, lng], { icon: L.divIcon({ className: 'perspice-draft-location', html: '', iconSize: [14, 14] }) }).addTo(map);
    }
  }, [map, draft]);

  const update = (location: DeviceLocationDto | null) => patchDevice(qc, device.id, (d) => ({ ...d, location }));

  async function save() {
    setError(null);
    try {
      const res = await api<{ location: DeviceLocationDto }>(`/devices/${device.id}/location`, { method: 'PUT', body: { lat: Number(draft!.lat), lng: Number(draft!.lng) } });
      update(res.location);
      setDraft(null);
    } catch (e) {
      setError(e);
    }
  }

  async function clear() {
    setError(null);
    try {
      await api(`/devices/${device.id}/location`, { method: 'DELETE' });
      update(null);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-3">
      <div ref={el} className="h-80 rounded-md border border-slate-200 dark:border-slate-800" data-testid="location-map" />
      <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
        {loc ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-slate-500">Position</dt>
            <dd className="font-mono" data-testid="location-position">
              {fmt(loc.lat)}, {fmt(loc.lng)}
            </dd>
            {loc.accuracy !== undefined && (
              <>
                <dt className="text-slate-500">Accuracy</dt>
                <dd>± {Math.round(loc.accuracy)} m</dd>
              </>
            )}
            {loc.speed !== undefined && (
              <>
                <dt className="text-slate-500">Speed</dt>
                <dd>{Math.round(loc.speed)} km/h</dd>
              </>
            )}
            <dt className="text-slate-500">{loc.source === 'fixed' ? 'Set' : 'Reported'}</dt>
            <dd>{timeAgo(loc.ts)}</dd>
          </dl>
        ) : (
          <p className="text-slate-500">{profile.locationMode === 'reported' ? 'No location reported yet.' : 'No location set.'}</p>
        )}
        {canEdit && !draft && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft(loc ? { lat: fmt(loc.lat), lng: fmt(loc.lng) } : { lat: '', lng: '' })}>
              Set location
            </Button>
            {loc && (
              <Button variant="outline" size="sm" onClick={() => void clear()}>
                Clear
              </Button>
            )}
          </div>
        )}
      </div>
      {draft && (
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <p className="text-sm text-slate-500">
            Click the map, or enter coordinates.{profile.locationMode === 'reported' ? ' The device’s next reported position replaces it.' : ''}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Latitude">{(id) => <Input id={id} className="w-36" value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: e.target.value })} />}</Field>
            <Field label="Longitude">{(id) => <Input id={id} className="w-36" value={draft.lng} onChange={(e) => setDraft({ ...draft, lng: e.target.value })} />}</Field>
            <Button size="sm" onClick={() => void save()} disabled={draft.lat === '' || draft.lng === ''}>
              Save location
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
