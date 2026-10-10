import L from 'leaflet';
import { type RefObject, useEffect, useState } from 'react';
import { loadMapTiles } from '@/dashboards/map-services';

/** A Leaflet map in `ref` with the configured tiles; null until mounted. Removed on unmount. */
export function useLeafletMap(ref: RefObject<HTMLDivElement | null>, view: { center: [number, number]; zoom: number } = { center: [20, 0], zoom: 2 }): L.Map | null {
  const [map, setMap] = useState<L.Map | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const m = L.map(ref.current, { maxZoom: 19 }).setView(view.center, view.zoom);
    let alive = true;
    void loadMapTiles().then((t) => {
      if (!alive) return;
      m.setMaxZoom(t.maxZoom);
      L.tileLayer(t.urlTemplate, { attribution: t.attribution, maxZoom: t.maxZoom }).addTo(m);
    });
    setMap(m);
    return () => {
      alive = false;
      m.remove();
      setMap(null);
    };
    // Once per mount; later view changes go through the map itself.
  }, [ref]);
  return map;
}
