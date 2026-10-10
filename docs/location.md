# Locations, trips and geofences

## Location modes

Each device profile has a **location** setting:

| Mode | Where the position comes from |
| --- | --- |
| None | No location (the Location tab is hidden). |
| Fixed, set by hand | Users with *device.write* set it on the device's **Location** tab: click the map, or type coordinates. |
| Reported by the device | The device sends its position as telemetry. |

### Reported positions

A message is a position fix when it has both a latitude and a longitude, as numbers in range. `0, 0` (what many GPS modules report without a fix) is not a fix. The keys are set per profile; the defaults are:

| Key | Meaning |
| --- | --- |
| `lat`, `lng` | latitude and longitude, degrees (required) |
| `speed` | km/h |
| `heading` | degrees from north |
| `acc` | accuracy, metres |
| `alt` | altitude, metres |

```json
{ "values": { "lat": 51.507412, "lng": -0.127758, "speed": 42.5, "heading": 87, "acc": 6 } }
```

Fixes are stored as ordinary telemetry, so they have history and can be charted or exported like any key. The newest fix (by its timestamp; an older message arriving late doesn't move the device) becomes the device's location immediately. Invalid fixes are listed in the device's **Debug** tab and ignored.

Setting a location by hand on a *reported* device works, but the device's next fix replaces it.

## Maps

Add a **Map** widget to a dashboard:

- **Markers**: every device of the source with a location (up to 5,000), coloured by status (green online, amber offline, red dead, grey never connected), grouped into clusters when there are more than 100. A marker's popup shows the device, up to five chosen values, and a link to it. Markers move live.
- **Route**: one device's path over the dashboard's time window, with a time slider, play/pause (1× to 300×) and the device's trips beside the map.

Geofences the viewer can see are drawn on both. The built-in overview has a map of all devices.

### Tiles

Maps use OpenStreetMap tiles by default. To use another tile server, set its URL template (with `{z}`, `{x}`, `{y}`; `{s}` for subdomains), attribution and maximum zoom in **Settings → Maps** (`PUT /api/settings/map`, system admins). Browsers only load tiles from hosts listed in `MAP_TILE_HOSTS` in `/opt/perspice/.env` (the Content-Security-Policy `img-src`); add the host there first and restart Caddy (`perspice restart caddy`).

Please respect the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/): for heavy use, run or rent a tile server.

## Trips

Turn on **Detect trips** in a profile with reported locations. A trip:

- **starts** when the device moves more than *after moving* metres (default 50) from where it was parked, or reports a speed of at least *starts at* km/h (default 5);
- **ends** at its last movement, once it has stood still for *ends after standing* seconds (default 300), or when the device stops reporting for that long.

With an **ignition key** (a true/false telemetry key, e.g. `ignition`), trips follow the ignition instead: on starts one, off ends it, and idling doesn't end it.

Distances are the sum of the fix-to-fix distances; a jump implying more than 300 km/h is a bad fix and doesn't count. A trip's figures are computed from every stored fix, so a tracker that buffers positions offline and sends them later still gets its full distance (about 30 seconds after the trip ends). GPS jitter while parked never adds distance.

The device's **Trips** tab lists trips over a period, the distance per day (in the customer's timezone), and exports them to Excel, CSV or PDF. API: `GET /api/devices/:id/trips?from&to`, `GET /api/devices/:id/distance?from&to`.

## Geofences

**Geofences** in the menu: circles (centre and radius) or polygons (up to 200 corners), drawn on the map.

- Customer admins (permission *geofence.manage*) manage their customer's geofences.
- Platform admins manage any, and can make one **platform-wide**: every customer sees it (read-only) and can use it in rules.

### Geofence alarms

An alarm rule of type **Device leaves (or enters) a geofence** raises when a device's position is on the chosen side, and clears once the device is back by the **clear margin** (default 20 m), so GPS jitter at the edge doesn't raise and clear repeatedly. A rule for a whole profile (every customer) needs a platform-wide geofence. A geofence that rules use can't be deleted until the rules are changed or removed.

## Firmware

The `GpsTracker` example (ESP32 with a serial GPS module, TinyGPS++) sends `lat`, `lng`, `speed`, `heading`, `acc`, `alt` and `sats` every 10 seconds while it has a current fix, keeps positions while out of coverage, and can report an `ignition` input for trips. See [firmware.md](firmware.md).

## Simulator

`perspice-sim --mobile-share 0.2 --center 51.5,-0.12 --radius-km 10 …` makes a fifth of the simulated devices drive and park around London (use a profile with reported locations).
