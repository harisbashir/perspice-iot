# Device protocol (Perspice v1)

Devices connect over MQTT (recommended) or HTTP. Each device has an **id** (UUID) and a
**token** (`pdt_…`, shown once when the device is created or its token regenerated).

## MQTT

- Host `mqtt.<domain>`, port **8883** (TLS) or **1883** (plain, if enabled)
- Client id **and** username: the device id. Password: the token.
- A device may only publish and subscribe under its own `perspice/v1/<id>/` subtree;
  anything else is refused (MQTT 5 reason code 0x87) and dropped.
- Payloads are JSON, at most 64 KB.

| Topic | Direction | Payload |
|---|---|---|
| `perspice/v1/<id>/telemetry` | device → platform | `{"ts":<ms>?,"values":{…}}` or an array of up to 500 such objects |
| `perspice/v1/<id>/attributes` | device → platform | `{"fw":"1.2.0","serial":"…"}` (merged into client attributes) |
| `perspice/v1/<id>/status` | device → platform | `"online"` (retained); set `"offline"` as the last will |
| `perspice/v1/<id>/cmd` | platform → device | `{"cid":"<uuid>","name":"gen_start","params":{}}` |
| `perspice/v1/<id>/cmd/ack` | device → platform | `{"cid":"<uuid>","status":"success"\|"failed","result":{}}` |
| `perspice/v1/<id>/config` | platform → device | shared attributes (retained) |
| `perspice/v1/<id>/ota` | platform → device | `{"jobId":"<uuid>","version":"1.2.0","url":"https://…","sha256":"…","size":524288}` |
| `perspice/v1/<id>/ota/progress` | device → platform | `{"version":"1.2.0","state":"downloading"\|"verifying"\|"applied"\|"failed","pct":40,"error":"…"}` |

### Telemetry

```json
{"ts": 1791494400000, "values": {"temperature": 21.5, "door_open": false, "state": "ok"}}
```

- Values may be numbers, strings, booleans or objects. Keys: `^[A-Za-z0-9_.-]{1,64}$`,
  at most 200 per message.
- `ts` is optional (milliseconds since the epoch). Without it the server uses the receive time.
  Timestamps below 10¹¹ are treated as seconds. Timestamps before 2020 or more than an hour in
  the future (an unsynchronised clock) are replaced by the receive time and flagged in the
  device's **Debug** tab.
- A message with the same device, key and timestamp as a stored one is ignored.
- Rejected messages (bad JSON, bad keys, too large) appear in the **Debug** tab.
- **Positions** are telemetry too: for a profile with reported locations, a message with `lat` and
  `lng` (plus optional `speed` km/h, `heading`, `acc` m, `alt`; key names set per profile) moves
  the device on maps and feeds trips and geofence alarms. See [location.md](location.md).

### Commands

Commands must be declared on the device profile (name, label, optional JSON-Schema for params,
whether the UI asks for confirmation). Reply on `cmd/ack` with the same `cid` within the
command's time-to-live (default 30 s), or it is marked `timeout`. Only the target device's ack
is accepted. Commands sent with *hold until online* are delivered when the device reconnects.

### Firmware updates

Report the running version as the `fw` attribute after every start. An update is complete when
the new version is reported; check the image's SHA-256 before using it. See [fleet.md](fleet.md).

## HTTP

Header `X-Device-Token: <token>`; 60 requests per minute per device; bodies up to 64 KB.

| Method and path | Purpose |
|---|---|
| `POST /api/v1/device/telemetry` | same body as MQTT telemetry → `202` |
| `POST /api/v1/device/attributes` | client attributes → `202` |
| `GET /api/v1/device/config` | shared attributes |
| `GET /api/v1/device/commands?wait=0..30` | long-poll the next command; `204` when none |
| `POST /api/v1/device/commands/<cid>/ack` | `{"status":"success","result":{}}` → `202` |
| `GET /api/v1/device/ota` | the pending firmware update (as on MQTT); `204` when none |
| `POST /api/v1/device/ota/progress` | same body as MQTT `ota/progress` → `202` |

## Presence

Any accepted message marks a device **online**. With MQTT, connecting and disconnecting also
change status immediately (unless the profile is *sleepy*). Without activity a device becomes
**offline** after the profile's offline timeout (default 300 s) and **dead** after the dead
timeout (default 24 h); both can be overridden per device. Profiles can notify customer and
platform admins by email and in-app when devices go offline, dead or come back.
