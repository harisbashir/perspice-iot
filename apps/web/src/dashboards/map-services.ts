import { DEFAULT_MAP_TILES, type GeofenceDto, type MapTiles } from '@perspice/shared';
import { api } from '@/api/client';

let tiles: Promise<MapTiles> | null = null;
let geofences: { at: number; value: Promise<GeofenceDto[]> } | null = null;
const GEOFENCES_TTL_MS = 60_000;

/** The configured tile server (once per session; OpenStreetMap if it can't be read). */
export function loadMapTiles(): Promise<MapTiles> {
  tiles ??= api<MapTiles>('/settings/map').catch(() => DEFAULT_MAP_TILES);
  return tiles;
}

/** Geofences the viewer can see, shared by the map widgets on screen (cached for a minute). */
export function loadGeofences(): Promise<GeofenceDto[]> {
  if (!geofences || Date.now() - geofences.at > GEOFENCES_TTL_MS) {
    geofences = { at: Date.now(), value: api<GeofenceDto[]>('/geofences').catch(() => []) };
  }
  return geofences.value;
}

/** Tests and sign-out. */
export function resetMapServices(): void {
  tiles = null;
  geofences = null;
}
