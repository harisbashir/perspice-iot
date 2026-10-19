Devices talk to the platform with a small JSON protocol over **MQTT** (recommended) or **HTTP**. A ready-made Arduino library implements it for ESP32 and AVR boards.

## Credentials

Each device has an **id** (a UUID) and a **token** (`pdt_…`), on its **Credentials** tab. The token is shown only when the device is created or the token regenerated; the platform stores only a hash. **Regenerate token** disconnects the device and invalidates the old one.

## Devices made in quantity

Typing an id and token into each unit doesn't scale, and a different image per unit rules out over-the-air updates. Instead, put one **provisioning key** in the firmware of every unit:

1. On the device profile, **Provisioning → New provisioning key**. Choose what it accepts:
   - **Any serial**: a unit with an unknown serial becomes a new device;
   - **Only registered serials**: register serials first (New device with a serial, or a CSV import with a `serial` column). Safest: a leaked key can't create devices.
   Optionally: the customer (and group) new devices go to, tags, a device limit, an expiry date, claim codes for unassigned devices (returned to the unit, e.g. for the test jig to print on the label), and re-provisioning.
2. Build the key into the firmware. With the library:

```cpp
PerspiceConfig cfg;
cfg.apiHost = "iot.example.com";   // the platform's web address
cfg.provisionKey = "pps_…";        // the same in every unit
cfg.apiCaCert = rootCa;            // verify the platform (ISRG Root X1 for Let's Encrypt)
cfg.port = 8883;                   // with a WiFiClientSecure
cfg.firmwareVersion = "1.0.0";
perspice.begin(cfg);               // no deviceId, token or host
```

3. On first boot the unit calls `POST /api/v1/device/provision` with `{"key", "serial"}` and gets `{"deviceId", "token", "mqtt": {"host"}, "claimCode"}`. It keeps them in NVS, which firmware updates don't touch, so the same image can later be updated over the air.

A serial that already has credentials is refused (`409`) unless the key allows re-provisioning: with it on, anyone holding the key and a unit's serial could take that unit's identity. Failed attempts are limited per address; successful ones aren't, so a factory behind one internet connection can provision any number. **Revoke** a key to stop it (its devices keep working), and give each batch its own key so a leak stays contained. The **Credentials** tab shows each device's serial and whether it provisioned itself; the audit log records each provisioning.

## MQTT

| Setting | Value |
|---|---|
| Host | `mqtt.<your domain>` |
| Port | **8883** (TLS) or **1883** (plain, if enabled at install) |
| Client id and username | the device id |
| Password | the token |

A device may only publish and subscribe under its own `perspice/v1/<id>/` topics; anything else is refused. Payloads are JSON, at most 64 KB.

| Topic | Direction | Payload |
|---|---|---|
| `perspice/v1/<id>/telemetry` | device → platform | `{"ts":<ms>,"values":{…}}` or an array of up to 500 |
| `perspice/v1/<id>/attributes` | device → platform | client attributes, e.g. `{"fw":"1.2.0"}` |
| `perspice/v1/<id>/status` | device → platform | `"online"` (retained); set `"offline"` as the last will |
| `perspice/v1/<id>/cmd` | platform → device | `{"cid":"…","name":"gen_start","params":{}}` |
| `perspice/v1/<id>/cmd/ack` | device → platform | `{"cid":"…","status":"success","result":{}}` |
| `perspice/v1/<id>/config` | platform → device | shared attributes (retained) |
| `perspice/v1/<id>/ota`, `…/ota/progress` | both | firmware updates; see [Firmware updates](/help/firmware) |

### Telemetry

```json
{"ts": 1791494400000, "values": {"fuel_level": 64.5, "door_open": false, "state": "ok"}}
```

- Keys: letters, digits, `_ . -`, up to 64 characters, at most 200 per message. Values: numbers, strings, booleans or objects.
- `ts` (milliseconds) is optional; without it the receive time is used. Values below 10¹¹ are treated as seconds. Timestamps before 2020 or more than an hour ahead are replaced by the receive time and flagged in the Debug tab.
- A repeat of the same device, key and timestamp is ignored, so re-sending after a reconnect is safe.

### Commands

The platform publishes to `cmd`; the device answers on `cmd/ack` with the same `cid` within the command's time-to-live (30 s by default), or it is marked *timeout*. Commands sent with *hold until online* are delivered when the device reconnects.

## HTTP

Header `X-Device-Token: <token>`; 60 requests a minute per device; bodies up to 64 KB.

| Request | Purpose |
|---|---|
| `POST /api/v1/device/telemetry` | the same body as MQTT telemetry |
| `POST /api/v1/device/attributes` | client attributes |
| `GET /api/v1/device/config` | shared attributes |
| `GET /api/v1/device/commands?wait=0..30` | long-poll the next command (`204` when none) |
| `POST /api/v1/device/commands/<cid>/ack` | answer a command |
| `GET /api/v1/device/ota`, `POST /api/v1/device/ota/progress` | firmware updates |

## Presence

Any accepted message marks a device online; with MQTT, connecting and disconnecting also change its status at once (except for *sleepy* profiles). The offline and dead timeouts come from the profile.

## The Arduino library

`firmware/PerspiceClient` (in the source) wraps all of this for ESP32 (Wi-Fi or Ethernet, TLS) and Arduino Mega with an Ethernet shield: reconnect with back-off, an offline last will, NTP timestamps, buffering while offline, command handlers and over-the-air updates on ESP32.

```cpp
PerspiceConfig cfg;
cfg.host = "mqtt.iot.example.com";
cfg.port = 8883;
cfg.deviceId = "…";           // Credentials tab
cfg.token = "pdt_…";
cfg.firmwareVersion = "1.0.0"; // reported as fw; needed for OTA
perspice.begin(cfg);
perspice.onCommand("gen_start", genStart);
```

Examples: `BasicSensor`, `GeneratorController`, `DeepSleepSensor`, `OtaUpdate`, `GpsTracker`. Without hardware, the simulator `perspice-sim` creates and drives many devices against a running installation.

## When values don't appear

1. Is the device **online**? If not, check the host, port, id and token (MQTT reason codes: bad credentials → not authorised).
2. Open its **Debug** tab: rejected messages say why (bad JSON, invalid key, too large, wrong topic).
3. Do the keys match the profile exactly (case matters)? Unlisted keys are stored but not offered on dashboards.
4. `perspice logs ingest` and `perspice logs emqx` on the server.
