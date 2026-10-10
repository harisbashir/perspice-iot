import { DEFAULT_MAP_TILES, type GeofenceDto, type MapTiles, type RouteDto, type TripDto } from '@perspice/shared';
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

export const loadRoute = (deviceId: string, from: number, to: number) =>
  api<RouteDto>(`/devices/${deviceId}/route?from=${Math.floor(from)}&to=${Math.ceil(to)}`);

/** Trips overlap the range; the API allows at most 30 days per request. */
export const loadTrips = (deviceId: string, from: number, to: number) =>
  api<TripDto[]>(`/devices/${deviceId}/trips?from=${Math.floor(Math.max(from, to - 30 * 86_400_000))}&to=${Math.ceil(to)}`);

/** Tests and sign-out. */
export function resetMapServices(): void {
  tiles = null;
  geofences = null;
}
