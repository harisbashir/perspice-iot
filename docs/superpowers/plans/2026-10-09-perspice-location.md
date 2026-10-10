# Perspice IoT — Sub-project 5a: Location & Fleet Implementation Plan

> **For agentic workers:** execute task by task. Each task is test-first (write the failing test, see it fail, implement, see it pass) and ends with one conventional commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.5.0: device locations (fixed, set by hand; or reported by the device), a Leaflet map widget with status-coloured clustered markers, the overview map and location column, route playback, trip detection with distance per day, customer geofences (circle and polygon) with a `geofence` alarm rule, and a `GpsTracker` firmware example.

**Architecture:** builds on v0.4.0. Sub-project 5 (spec §13 row 5, "v0.5.0 → v1.0.0") is split into three releases: **5a location & fleet (v0.5.0, this plan)**, 5b fleet operations (OTA, claim codes, CSV import/export, bulk operations; v0.6.0), 5c assets and derived data (assets, calculated telemetry, energy, generator run-hours and `maintenance_due`; v0.7.0 → v1.0.0). New server module `location` (location service, trips, geofences). Reported locations ride on ordinary telemetry (so history and route playback come from the existing hypertable); the device's current location lives in Redis and is written back to `device.location` coarsely, like `last_seen`. Trip detection runs in the `rules` role on the telemetry stream. Geofences are evaluated by the alarm engine.

**Tech additions:** `leaflet` and `leaflet.markercluster` (web/widgets); no server dependencies (haversine and point-in-polygon are small pure functions in `packages/shared`).

**Spec:** §1.1 R12, §4 (`device.location`, `device_profile.location_mode`, `geofence`, `trip`), §7.3 maps, §7.5 overview map, §11 fleet, §13 row 5.

## Scope decisions

| Item | Decision |
|---|---|
| Reported location format | Telemetry keys named by the profile: `locationKeys { lat, lng, alt?, speed?, heading?, accuracy? }`, default `lat`/`lng`/`alt`/`speed`/`heading`/`acc`. A message counts as a location fix only with both lat and lng, numeric and in range (|lat| ≤ 90, |lng| ≤ 180, not 0,0). Fixes are stored as normal telemetry. |
| Current location | Redis hash `loc:{deviceId}` (exact, newest fix by ts); `device.location` refreshed by the presence flush once it is 1 minute behind or moved more than 25 m. Fixed-location devices are set through the API and stored directly. |
| Location mode | `none` hides location UI; `fixed` lets users with `device.write` set lat/lng (map click or fields); `reported` takes fixes from telemetry and shows the route. A fixed location set by hand on a `reported` device is overwritten by the next fix (documented). |
| Trips | Per profile `trips { enabled, minSpeedKmh = 5, minMoveM = 50, stopAfterS = 300, ignitionKey? }`. A trip starts at the first fix that moves ≥ `minMoveM` from the parked point (or speed ≥ `minSpeedKmh`, or ignition true), ends after `stopAfterS` without movement (or ignition false), and stores start/end time and location, distance (haversine sum of fixes, ignoring jumps implying > 300 km/h), max and average speed. Open trips are kept in Redis and closed by a scheduler sweep for devices that stop reporting. |
| Distance per day | Computed from trips (split at midnight in the customer's timezone) — a query, not stored. |
| Geofences | Customer-scoped (platform admins may create platform-wide ones that apply to all customers' devices); circle (centre + radius m) or polygon (≤ 200 vertices, GeoJSON). Permission `geofence.manage` (customer admin, platform admin). |
| Geofence alarm rule | Rule type `geofence`, condition `{ geofenceId, trigger: 'outside' \| 'inside' }` — raises when the device's fix is on the triggering side, clears when back (with a margin of `clearMarginM`, default 20 m, against GPS jitter). Enter/exit events are visible as alarm raise/clear. |
| Map tiles | Tile URL template and attribution in system settings (default OpenStreetMap); the Caddy CSP `img-src` follows the configured tile host. |
| Route playback | Map widget mode `route`: a device's fixes over the dashboard time window as a polyline with a time slider and play/pause; trips listed beside it. |
| Firmware | `GpsTracker` example (ESP32 + TinyGPS++) sending `lat`, `lng`, `speed`, `heading`, `acc`, `sats`. |

## Global Constraints

- Location, trips and geofences follow tenancy exactly like devices: every query goes through the viewer's scope; a geofence of customer A is invisible to customer B and can't be referenced by B's rules (Review Focus 1).
- Location fixes are validated; an out-of-range or 0,0 fix is rejected into the debug log and never moves the device or a trip (Review Focus 2).
- Map widgets render at most 5,000 markers (clustered) and route playback at most 10,000 fixes per request (downsampled by time bucket beyond that).
- No new external requests from the server; tiles are fetched by browsers only.

## Review Focus

1. **Tenant isolation of locations, trips and geofences** — a customer reading another customer's device route, listing their geofences, or creating a rule on a foreign geofence id. Expect 404 everywhere. Tests in Tasks 2, 5, 6.
2. **Bad fixes** — GPS jitter while parked, 0,0, a teleport, out-of-order timestamps. Expect: no phantom trips, no distance from jumps, the newest fix by timestamp wins. Tests in Tasks 2, 4.
3. **Geofence correctness** — polygon edges, antimeridian-free assumption documented, jitter at the boundary. Expect: correct inside/outside, no alarm flapping inside the clear margin. Tests in Tasks 5, 6.
4. **Load** — location handling must not undo the criterion-8 work: Redis-only on the hot path, coarse database write-back. The load test is re-run with a mobile profile (Task 11).

---

## File Structure (new or substantially changed)

```
packages/shared/src/geo.ts               haversine, point-in-polygon/circle, distance-to-boundary, fix validation
packages/shared/src/location.ts          LocationDto, TripDto, GeofenceDto, profile locationKeys/trips schemas
apps/server/src/location/                location.service.ts (current location, fixes), trips.ts (detector),
                                         trips.service.ts, geofences.service.ts, location.controller.ts, geofences.controller.ts
apps/server/src/db/schema/location.ts    geofence, trip tables (+ migration)
packages/widgets/src/library/maps/       MapWidget (markers, clustering, popups, geofence overlay, route playback)
apps/web/src/pages/devices/LocationPanel.tsx, TripsPanel.tsx
apps/web/src/pages/geofences/            list + editor (circle / polygon drawing)
firmware/PerspiceClient/examples/GpsTracker/
docs/location.md
```

---

## Task 1: Shared geo contracts

**Files:** `packages/shared/src/geo.ts`, `packages/shared/src/location.ts`, tests.
- [ ] `haversineM`, `isValidFix`, `pointInPolygon` (ray casting), `pointInCircle`, `distanceToBoundaryM`, `bboxOf`; schemas `LocationKeysSchema`, `TripSettingsSchema`, `GeofenceShapeSchema` (circle | polygon ≤ 200 vertices, closed ring), DTOs.
- [ ] Profile DTO gains `locationKeys`, `trips`; alarm rule `geofence` moves from reserved to real (`{ geofenceId, trigger, clearMarginM }`).
- [ ] Unit tests: known distances, polygon edge/vertex cases, concave polygons, invalid fixes.
- [ ] Commit `feat(shared): location, trip and geofence contracts`.

## Task 2: Current location (fixed and reported)

**Files:** `location.service.ts`, ingest hook, presence flush, controller, migration (profile `location_keys`, `trip_settings` columns).
- [ ] Ingest: when the profile is `reported`, extract a fix from the normalised rows (newest by ts per message), validate, `HSET loc:{id}` if newer, publish `ws:location:{id}`, push a debug entry for rejected fixes.
- [ ] `PUT /devices/:id/location` (fixed; `device.write`), `GET /devices/:id/location`, `GET /devices/:id/route?from&to` (fixes from telemetry, downsampled ≤ 10,000).
- [ ] Coarse write-back of `device.location` in the presence flush (1 min / 25 m).
- [ ] Integration tests: reported fix updates Redis and later the row; out-of-order fix ignored; 0,0 rejected to debug; fixed location API; cross-tenant 404 on location and route.
- [ ] Commit `feat(location): fixed and reported device locations`.

## Task 3: Map tiles setting and live location over websockets

**Files:** settings key `map.tiles`, Caddy CSP from setting (Caddyfile placeholder filled by the web image entrypoint at start from `MAP_TILE_HOSTS`), realtime `location` event on `subscribe:device`.
- [ ] Tests: setting validation (https URL template with `{z}/{x}/{y}`), websocket `location` event delivered only to scoped subscribers.
- [ ] Commit `feat(location): map tile settings and live location events`.

## Task 4: Trip detection

**Files:** `trips.ts` (pure state machine), `trips.service.ts` (rules role consumer on the telemetry stream, Redis state `trip:{id}`, scheduler close sweep), `trip` table, `GET /devices/:id/trips`, `GET /devices/:id/distance?from&to&bucket=day`.
- [ ] Unit tests for the state machine: parked jitter (no trip), drive and park, ignition-driven trips, teleport ignored in distance, gaps, out-of-order fixes.
- [ ] Integration: simulated drive produces one trip with expected distance (±1%); sweep closes a trip when the device goes silent; distance per day splits at local midnight; tenant isolation.
- [ ] Commit `feat(location): trip detection and distance per day`.

## Task 5: Geofences

**Files:** `geofence` table, `geofences.service.ts`, `geofences.controller.ts`, permission `geofence.manage` (seeded for platform_admin and customer_admin).
- [ ] CRUD with scope rules (customer geofences; platform-wide only for platform scope); validation of shapes; `GET /geofences?bbox=`.
- [ ] Tests: CRUD, validation, isolation (customer B can't read/update/delete A's), platform-wide geofence visible read-only to customers.
- [ ] Commit `feat(location): geofences`.

## Task 6: Geofence alarm rule

**Files:** alarm engine (`geofence` evaluator using the device's fix), rule validation (geofence must be visible to the rule's scope), rule UI form.
- [ ] Tests: leaving a circle raises, returning clears; jitter within the clear margin doesn't flap; polygon; rule referencing a foreign geofence is refused (404); deleting a geofence disables its rules with a visible reason.
- [ ] Commit `feat(alarms): geofence rule`.

## Task 7: Map widget

**Files:** `packages/widgets/src/library/maps/MapWidget.tsx` (Leaflet + markercluster), data source support for locations (`devicesOfProfile`, `entityList`, `currentDevice`, `device`), settings (status colours, popup keys, show geofences, fit bounds, mode markers/route).
- [ ] Widget tests (jsdom with Leaflet): markers per located device coloured by status, clustering above threshold, popup shows chosen keys and a link, live location update moves a marker, geofence overlay drawn.
- [ ] Commit `feat(widgets): map widget`.

## Task 8: Route playback

**Files:** map widget `route` mode (polyline, time slider, play/pause/speed, current-position marker), trips list beside the map.
- [ ] Tests: route drawn from fixes in the time window, slider moves the marker, selecting a trip zooms to it.
- [ ] Commit `feat(widgets): route playback`.

## Task 9: Device location, trips and geofence pages in the web app

**Files:** device detail `Location` tab (map, set fixed location by click or fields, current fix and accuracy), `Trips` tab (table with export to XLSX/CSV, distance per day chart), Geofences page (list, circle/polygon editor on a map), overview template gains a map and a location column; profile form gains location keys and trip settings.
- [ ] Web tests for each page; export of trips.
- [ ] Commit `feat(web): locations, trips and geofences`.

## Task 10: Firmware and simulator

**Files:** `firmware/PerspiceClient/examples/GpsTracker/`, simulator `--mobile` (devices drive routes around a centre with stops), CI compile target.
- [ ] Simulator unit tests (routes stay within radius, stops long enough to end trips).
- [ ] Commit `feat(firmware): GpsTracker example; simulator mobile devices`.

## Task 11: End-to-end, load check, docs, release v0.5.0

- [ ] E2E (`e2e/location.spec.ts`): a tracker device drives out of a geofence → marker moves live on the map, an alarm is raised, the trip appears with its distance, route playback shows it; the customer can't see another customer's geofence.
- [ ] Load: re-run `scripts/test.sh --load` with 10% of devices on a mobile profile; record in `docs/load-test.md` (criterion 8 still met).
- [ ] Docs: `docs/location.md` (modes, keys, trips, geofences, tiles); update `device-protocol.md`, `dashboards.md`, `alarms.md`, `firmware.md`.
- [ ] `VERSION` 0.5.0, CHANGELOG, commit `chore(release): v0.5.0`, tag `v0.5.0` (local; the user pushes).
