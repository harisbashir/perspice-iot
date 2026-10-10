import { describe, expect, it } from 'vitest';
import {
  GeofenceShapeSchema,
  LocationKeysSchema,
  TripSettingsSchema,
  bboxOf,
  distanceToBoundaryM,
  extractFix,
  haversineM,
  isValidFix,
  isInside,
  pointInPolygon,
} from '../src/index.js';

const LONDON = { lat: 51.5074, lng: -0.1278 };
const PARIS = { lat: 48.8566, lng: 2.3522 };

describe('haversineM', () => {
  it('measures known distances within 0.5%', () => {
    expect(haversineM(LONDON, PARIS) / 1000).toBeCloseTo(343.5, -1);
    expect(Math.abs(haversineM(LONDON, PARIS) - 343_500) / 343_500).toBeLessThan(0.005);
    expect(haversineM(LONDON, LONDON)).toBe(0);
    // One degree of latitude is about 111.2 km.
    expect(haversineM({ lat: 0, lng: 0.5 }, { lat: 1, lng: 0.5 })).toBeCloseTo(111_195, -2);
  });
});

describe('isValidFix', () => {
  it('accepts real coordinates and rejects out-of-range, non-finite and 0,0', () => {
    expect(isValidFix(LONDON)).toBe(true);
    expect(isValidFix({ lat: -33.86, lng: 151.21 })).toBe(true);
    expect(isValidFix({ lat: 0, lng: 0 })).toBe(false);
    expect(isValidFix({ lat: 91, lng: 0.1 })).toBe(false);
    expect(isValidFix({ lat: 10, lng: -180.5 })).toBe(false);
    expect(isValidFix({ lat: Number.NaN, lng: 1 })).toBe(false);
  });
});

describe('extractFix', () => {
  const keys = LocationKeysSchema.parse({});
  it('reads the profile keys, with optional speed, heading, altitude and accuracy', () => {
    expect(extractFix({ lat: 51.5, lng: -0.12, speed: 42, heading: 90, acc: 5, temp: 20 }, keys)).toEqual({
      lat: 51.5,
      lng: -0.12,
      speed: 42,
      heading: 90,
      accuracy: 5,
    });
    expect(extractFix({ latitude: 1.5, longitude: 2.5 }, LocationKeysSchema.parse({ lat: 'latitude', lng: 'longitude' }))).toEqual({ lat: 1.5, lng: 2.5 });
  });
  it('needs both coordinates as valid numbers', () => {
    expect(extractFix({ lat: 51.5 }, keys)).toBeNull();
    expect(extractFix({ lat: '51.5', lng: -0.12 }, keys)).toBeNull();
    expect(extractFix({ lat: 0, lng: 0 }, keys)).toBeNull();
    expect(extractFix({ lat: 51.5, lng: -0.12, speed: 'fast' }, keys)).toEqual({ lat: 51.5, lng: -0.12 });
  });
});

describe('geofence shapes', () => {
  // A concave "U" around (0.5..3.5, 0.5..3.5) with the notch at the top middle.
  const u = GeofenceShapeSchema.parse({
    type: 'polygon',
    coordinates: [
      [1, 1], [4, 1], [4, 4], [3, 4], [3, 2], [2, 2], [2, 4], [1, 4], [1, 1],
    ].map(([lng, lat]) => [lng, lat]),
  });

  it('decides inside/outside for concave polygons, including the notch', () => {
    if (u.type !== 'polygon') throw new Error('expected polygon');
    expect(pointInPolygon({ lat: 1.5, lng: 1.5 }, u.coordinates)).toBe(true);
    expect(pointInPolygon({ lat: 3, lng: 2.5 }, u.coordinates)).toBe(false); // in the notch
    expect(pointInPolygon({ lat: 3, lng: 3.5 }, u.coordinates)).toBe(true);
    expect(pointInPolygon({ lat: 5, lng: 2 }, u.coordinates)).toBe(false);
    expect(isInside({ lat: 1.5, lng: 1.5 }, u)).toBe(true);
  });

  it('circles use metres from the centre', () => {
    const c = GeofenceShapeSchema.parse({ type: 'circle', center: LONDON, radiusM: 1000 });
    expect(isInside({ lat: 51.5074 + 0.005, lng: -0.1278 }, c)).toBe(true); // ~556 m north
    expect(isInside({ lat: 51.5074 + 0.01, lng: -0.1278 }, c)).toBe(false); // ~1.1 km north
    expect(distanceToBoundaryM({ lat: 51.5074 + 0.005, lng: -0.1278 }, c)).toBeCloseTo(444, -1);
  });

  it('measures the distance to a polygon edge in metres', () => {
    if (u.type !== 'polygon') throw new Error('expected polygon');
    // 0.1° south of the bottom edge at latitude 1 ≈ 11.1 km.
    expect(distanceToBoundaryM({ lat: 0.9, lng: 2.5 }, u)).toBeCloseTo(11_120, -2);
  });

  it('validates shapes: closed rings, at most 200 vertices, positive radius, valid coordinates', () => {
    expect(GeofenceShapeSchema.safeParse({ type: 'polygon', coordinates: [[0.1, 0.1], [1, 0.1], [1, 1]] }).success).toBe(false); // not closed
    expect(GeofenceShapeSchema.safeParse({ type: 'polygon', coordinates: [[0.1, 0.1], [1, 0.1], [0.1, 0.1]] }).success).toBe(false); // too few
    const many = Array.from({ length: 201 }, (_, i) => [Math.cos(i / 32), Math.sin(i / 32)]);
    expect(GeofenceShapeSchema.safeParse({ type: 'polygon', coordinates: [...many, many[0]] }).success).toBe(false);
    expect(GeofenceShapeSchema.safeParse({ type: 'circle', center: LONDON, radiusM: 0 }).success).toBe(false);
    expect(GeofenceShapeSchema.safeParse({ type: 'circle', center: { lat: 95, lng: 0 }, radiusM: 10 }).success).toBe(false);
  });

  it('computes bounding boxes', () => {
    expect(bboxOf(u)).toEqual({ minLat: 1, minLng: 1, maxLat: 4, maxLng: 4 });
    const c = GeofenceShapeSchema.parse({ type: 'circle', center: { lat: 0.5, lng: 0.5 }, radiusM: 111_195 });
    const b = bboxOf(c);
    expect(b.maxLat).toBeCloseTo(1.5, 2);
    expect(b.minLng).toBeCloseTo(-0.5, 2);
  });
});

describe('trip settings', () => {
  it('has sensible defaults and bounds', () => {
    expect(TripSettingsSchema.parse({})).toEqual({ enabled: false, minSpeedKmh: 5, minMoveM: 50, stopAfterS: 300 });
    expect(TripSettingsSchema.safeParse({ stopAfterS: 10 }).success).toBe(false);
  });
});

describe('map tiles', () => {
  it('checks tile hosts against the CSP source list', async () => {
    const { tileHostAllowed } = await import('../src/index.js');
    const sources = 'https://tile.openstreetmap.org https://*.tile.openstreetmap.org';
    expect(tileHostAllowed('https://tile.openstreetmap.org/{z}/{x}/{y}.png', sources)).toBe(true);
    expect(tileHostAllowed('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', sources)).toBe(true);
    expect(tileHostAllowed('https://evil.example/{z}/{x}/{y}.png', sources)).toBe(false);
    expect(tileHostAllowed('https://tile.openstreetmap.org.evil.example/{z}/{x}/{y}.png', sources)).toBe(false);
  });
});
