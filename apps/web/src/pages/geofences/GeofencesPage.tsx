import type { GeofenceDto } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { selectClass } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { resetMapServices } from '@/dashboards/map-services';
import { useLeafletMap } from '@/maps/useLeafletMap';

type Shape = GeofenceDto['shape'];
interface Draft {
  id?: string;
  name: string;
  color: string;
  kind: 'circle' | 'polygon';
  center: { lat: number; lng: number } | null;
  radiusM: number;
  /** Polygon corners as [lng, lat], not yet closed. */
  points: [number, number][];
  /** Platform users: '' = every customer (platform-wide). */
  customerId: string;
}

const EMPTY: Draft = { name: '', color: '#2563eb', kind: 'circle', center: null, radiusM: 200, points: [], customerId: '' };

const shapeOf = (d: Draft): Shape | null => {
  if (d.kind === 'circle') return d.center ? { type: 'circle', center: d.center, radiusM: d.radiusM } : null;
  return d.points.length >= 3 ? { type: 'polygon', coordinates: [...d.points, d.points[0]!] } : null;
};

const draftOf = (g: GeofenceDto): Draft =>
  g.shape.type === 'circle'
    ? { ...EMPTY, id: g.id, name: g.name, color: g.color, kind: 'circle', center: g.shape.center, radiusM: g.shape.radiusM, customerId: g.customerId ?? '' }
    : { ...EMPTY, id: g.id, name: g.name, color: g.color, kind: 'polygon', points: g.shape.coordinates.slice(0, -1), customerId: g.customerId ?? '' };

function layerFor(shape: Shape, color: string, className: string): L.Path {
  if (shape.type === 'circle') return L.circle([shape.center.lat, shape.center.lng], { radius: shape.radiusM, color, weight: 2, fillOpacity: 0.1, className });
  return L.polygon(
    shape.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    { color, weight: 2, fillOpacity: 0.1, className },
  );
}

/** Customer and platform-wide geofences on a map: draw circles and polygons, edit, delete. */
export function GeofencesPage() {
  const { user, hasPerm } = useAuth();
  const platform = user?.scopeType === 'platform';
  const canManage = hasPerm('geofence.manage');
  const qc = useQueryClient();
  const el = useRef<HTMLDivElement>(null);
  const map = useLeafletMap(el);
  const geofences = useQuery({ queryKey: ['geofences'], queryFn: () => api<GeofenceDto[]>('/geofences') });
  const customers = useQuery({ queryKey: ['customers', 'names'], queryFn: () => api<{ id: string; name: string }[]>('/customers'), enabled: platform && canManage });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fitted = useRef(false);

  // Saved geofences (the one being edited is drawn by the draft layer instead).
  useEffect(() => {
    if (!map || !geofences.data) return;
    const group = L.featureGroup();
    for (const g of geofences.data) {
      if (g.id === draft?.id) continue;
      layerFor(g.shape, g.color, 'perspice-geofence').bindTooltip(g.name).addTo(group);
    }
    group.addTo(map);
    if (!fitted.current && geofences.data.length) {
      fitted.current = true;
      map.fitBounds(group.getBounds(), { padding: [24, 24], maxZoom: 16 });
    }
    return () => {
      group.remove();
    };
  }, [map, geofences.data, draft?.id]);

  // The draft: drawn live, and map clicks place the centre or add corners.
  useEffect(() => {
    if (!map || !draft) return;
    const shape = shapeOf(draft);
    const layers: L.Layer[] = [];
    if (shape) layers.push(layerFor(shape, draft.color, 'perspice-geofence-draft').addTo(map));
    if (draft.kind === 'polygon') {
      for (const [lng, lat] of draft.points) layers.push(L.circleMarker([lat, lng], { radius: 4, color: draft.color, className: 'perspice-geofence-corner' }).addTo(map));
    }
    const onClick = (e: L.LeafletMouseEvent) => {
      const p = { lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) };
      setDraft((d) => (d ? (d.kind === 'circle' ? { ...d, center: p } : { ...d, points: [...d.points, [p.lng, p.lat]] }) : d));
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
      for (const l of layers) l.remove();
    };
  }, [map, draft]);

  const refresh = async () => {
    resetMapServices(); // map widgets pick up the change
    await qc.invalidateQueries({ queryKey: ['geofences'] });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    const shape = shapeOf(draft);
    try {
      if (draft.id) {
        await api(`/geofences/${draft.id}`, { method: 'PATCH', body: { name: draft.name, color: draft.color, shape } });
      } else {
        await api('/geofences', { body: { name: draft.name, color: draft.color, shape, ...(platform ? { customerId: draft.customerId || null } : {}) } });
      }
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function remove(g: GeofenceDto) {
    setError(null);
    try {
      await api(`/geofences/${g.id}`, { method: 'DELETE' });
      if (draft?.id === g.id) setDraft(null);
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  const writable = (g: GeofenceDto) => canManage && (platform || g.customerId !== null);
  const shape = draft ? shapeOf(draft) : null;

  return (
    <div>
      <PageHeader
        title="Geofences"
        description="Areas for location alarms (a device leaving or entering) and for maps."
        actions={
          canManage && !draft ? (
            <Button
              onClick={() => {
                setError(null);
                setDraft({ ...EMPTY });
              }}
            >
              New geofence
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-3">
          {draft && (
            <form aria-label="Geofence" className="space-y-3 rounded-md border border-line p-3" onSubmit={(e) => void save(e)}>
              <Field label="Name">{(id) => <Input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
              <Field label="Colour">{(id) => <Input id={id} type="color" className="h-9 w-16 p-1" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />}</Field>
              {platform && !draft.id && (
                <Field label="Applies to">
                  {(id) => (
                    <select id={id} className={selectClass} value={draft.customerId} onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}>
                      <option value="">Every customer (platform-wide)</option>
                      {(customers.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              <fieldset className="flex gap-4 text-sm">
                <legend className="mb-1 font-medium">Shape</legend>
                {(['circle', 'polygon'] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input type="radio" name="shape" checked={draft.kind === k} onChange={() => setDraft({ ...draft, kind: k })} />
                    {k === 'circle' ? 'Circle' : 'Polygon'}
                  </label>
                ))}
              </fieldset>
              {draft.kind === 'circle' ? (
                <>
                  <p className="text-xs text-fg-muted">{draft.center ? 'Click the map to move the centre.' : 'Click the map to place the centre.'}</p>
                  <Field label="Radius (m)">
                    {(id) => <Input id={id} type="number" min={1} value={String(draft.radiusM)} onChange={(e) => setDraft({ ...draft, radiusM: Number(e.target.value) || 0 })} />}
                  </Field>
                </>
              ) : (
                <div className="flex items-center justify-between text-xs text-fg-muted">
                  <span>
                    {draft.points.length} corner{draft.points.length === 1 ? '' : 's'}: click the map to add{draft.points.length < 3 ? ' (at least 3)' : ''}.
                  </span>
                  <Button type="button" variant="outline" size="sm" disabled={!draft.points.length} onClick={() => setDraft({ ...draft, points: draft.points.slice(0, -1) })}>
                    Undo corner
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={!shape || !draft.name.trim()}>
                  {draft.id ? 'Save' : 'Create geofence'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          <ErrorText error={error ?? geofences.error} />
          <ul className="space-y-1" aria-label="Geofence list">
            {(geofences.data ?? []).map((g) => (
              <li key={g.id} className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-sm">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                <span className="min-w-0 flex-1 truncate">
                  {g.name}
                  {g.customerId === null && <span className="ml-1 text-xs text-fg-muted">(platform-wide)</span>}
                </span>
                {writable(g) && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Edit ${g.name}`}
                      onClick={() => {
                        setError(null);
                        setDraft(draftOf(g));
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" aria-label={`Delete ${g.name}`} onClick={() => void remove(g)}>
                      Delete
                    </Button>
                  </>
                )}
              </li>
            ))}
            {geofences.data?.length === 0 && <li className="text-sm text-fg-muted">No geofences yet.</li>}
          </ul>
        </div>
        <div ref={el} className="h-[32rem] rounded-md border border-line" data-testid="geofence-map" />
      </div>
    </div>
  );
}
