/**
 * Small geodesy helpers for locations, trips and geofences. Distances are on a sphere
 * (R = 6,371 km), accurate to well under 1% at the scales used here. Polygons are GeoJSON-style
 * rings of `[lng, lat]` pairs and are assumed not to cross the antimeridian.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
/** Metres per degree of latitude. */
export const M_PER_DEG = (Math.PI * R) / 180;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Finite, in range, and not the 0,0 "no fix" that many GPS modules report. */
export function isValidFix(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

/** Ray casting on a closed `[lng, lat]` ring (points exactly on an edge may go either way). */
export function pointInPolygon(p: LatLng, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from `p` to the segment a–b in metres, in a local flat projection around `p`. */
function segmentDistanceM(p: LatLng, a: readonly [number, number], b: readonly [number, number]): number {
  const kx = Math.cos(rad(p.lat)) * M_PER_DEG;
  const ax = (a[0] - p.lng) * kx;
  const ay = (a[1] - p.lat) * M_PER_DEG;
  const bx = (b[0] - p.lng) * kx;
  const by = (b[1] - p.lat) * M_PER_DEG;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export type CircleShape = { type: 'circle'; center: LatLng; radiusM: number };
export type PolygonShape = { type: 'polygon'; coordinates: [number, number][] };
export type GeofenceShape = CircleShape | PolygonShape;

export function isInside(p: LatLng, shape: GeofenceShape): boolean {
  return shape.type === 'circle' ? haversineM(p, shape.center) <= shape.radiusM : pointInPolygon(p, shape.coordinates);
}

/** Distance from `p` to the shape's boundary in metres (whichever side `p` is on). */
export function distanceToBoundaryM(p: LatLng, shape: GeofenceShape): number {
  if (shape.type === 'circle') return Math.abs(haversineM(p, shape.center) - shape.radiusM);
  let min = Infinity;
  const ring = shape.coordinates;
  for (let i = 1; i < ring.length; i++) min = Math.min(min, segmentDistanceM(p, ring[i - 1]!, ring[i]!));
  return min;
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export function bboxOf(shape: GeofenceShape): BBox {
  if (shape.type === 'circle') {
    const dLat = shape.radiusM / M_PER_DEG;
    const dLng = dLat / Math.max(1e-6, Math.cos(rad(shape.center.lat)));
    return { minLat: shape.center.lat - dLat, minLng: shape.center.lng - dLng, maxLat: shape.center.lat + dLat, maxLng: shape.center.lng + dLng };
  }
  const lngs = shape.coordinates.map((c) => c[0]);
  const lats = shape.coordinates.map((c) => c[1]);
  return { minLat: Math.min(...lats), minLng: Math.min(...lngs), maxLat: Math.max(...lats), maxLng: Math.max(...lngs) };
}
