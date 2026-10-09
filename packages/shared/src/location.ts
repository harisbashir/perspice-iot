import { z } from 'zod';
import { type GeofenceShape, isValidFix } from './geo.js';
import { KEY_PATTERN } from './protocol.js';

const Key = z.string().regex(KEY_PATTERN, 'Use letters, digits, ".", "_" or "-" (max 64)');
const Lat = z.number().min(-90).max(90);
const Lng = z.number().min(-180).max(180);

/** Which telemetry keys carry a reported location (device profile, `location_mode = reported`). */
export const LocationKeysSchema = z
  .object({
    lat: Key.default('lat'),
    lng: Key.default('lng'),
    alt: Key.default('alt'),
    speed: Key.default('speed'),
    heading: Key.default('heading'),
    accuracy: Key.default('acc'),
  })
  .strict();
export type LocationKeys = z.infer<typeof LocationKeysSchema>;

export interface Fix {
  lat: number;
  lng: number;
  alt?: number;
  /** km/h */
  speed?: number;
  /** degrees from north */
  heading?: number;
  /** metres */
  accuracy?: number;
}

/** A location fix from one message's values, or null when it has none (or an invalid one). */
export function extractFix(values: Record<string, unknown>, keys: LocationKeys): Fix | null {
  const lat = values[keys.lat];
  const lng = values[keys.lng];
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isValidFix({ lat, lng })) return null;
  const fix: Fix = { lat, lng };
  const num = (k: string) => (typeof values[k] === 'number' && Number.isFinite(values[k]) ? (values[k] as number) : undefined);
  const extras = { alt: num(keys.alt), speed: num(keys.speed), heading: num(keys.heading), accuracy: num(keys.accuracy) };
  for (const [k, v] of Object.entries(extras)) if (v !== undefined) (fix as unknown as Record<string, number>)[k] = v;
  return fix;
}

/** Trip detection per device profile. */
export const TripSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** A trip starts when speed reaches this… */
    minSpeedKmh: z.number().min(0.5).max(100).default(5),
    /** …or the device moves this far from where it was parked. */
    minMoveM: z.number().min(10).max(5000).default(50),
    /** The trip ends after this long without moving. */
    stopAfterS: z.number().int().min(60).max(86_400).default(300),
    /** Optional boolean key (e.g. `ignition`): true starts a trip, false ends it. */
    ignitionKey: Key.optional(),
  })
  .strict();
export type TripSettings = z.infer<typeof TripSettingsSchema>;

export const LatLngSchema = z.object({ lat: Lat, lng: Lng }).refine((p) => isValidFix(p), 'Not a valid location');

export const GeofenceShapeSchema: z.ZodType<GeofenceShape, z.ZodTypeDef, unknown> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('circle'), center: z.object({ lat: Lat, lng: Lng }), radiusM: z.number().positive().max(1_000_000) }),
  z.object({
    type: z.literal('polygon'),
    /** A closed ring of `[lng, lat]` pairs: the first point repeated at the end. */
    coordinates: z
      .array(z.tuple([Lng, Lat]))
      .min(4, 'A polygon needs at least 3 corners')
      .max(201, 'At most 200 corners')
      .refine((ring) => {
        const [a, b] = [ring[0]!, ring[ring.length - 1]!];
        return a[0] === b[0] && a[1] === b[1];
      }, 'The ring must end where it starts'),
  }),
]);

export const GeofenceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  shape: GeofenceShapeSchema,
  /** Platform scope only: null = applies to every customer's devices. */
  customerId: z.string().uuid().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2563eb'),
});
export type GeofenceInput = z.infer<typeof GeofenceInputSchema>;

export interface GeofenceDto {
  id: string;
  name: string;
  customerId: string | null;
  shape: GeofenceShape;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface DeviceLocationDto extends Fix {
  ts: number;
  source: 'fixed' | 'reported';
}

export interface TripDto {
  id: string;
  deviceId: string;
  startTs: number;
  /** null while the trip is under way. */
  endTs: number | null;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number } | null;
  distanceM: number;
  maxSpeedKmh: number | null;
  avgSpeedKmh: number | null;
}
