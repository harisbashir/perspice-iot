# Provisioning devices made in quantity

Entering a device id and token into every unit doesn't scale: units without a screen can't take
them, and flashing a different image per unit rules out over-the-air updates. **Provisioning keys**
solve this: one secret per device profile goes into the shared firmware image, and each unit fetches
its own credentials on first boot.

```
factory: flash the same image          first boot                           afterwards
┌────────────────────────┐   POST /api/v1/device/provision    ┌──────────────────────────────┐
│ firmware + key pps_…   │ ─────────────────────────────────▶ │ device id + token (its own)  │
│ (no per-unit secrets)  │   {key, serial: "AA:BB:…:01"}      │ kept in NVS; survives OTA    │
└────────────────────────┘ ◀───────────────────────────────── └──────────────────────────────┘
                              {deviceId, token, mqtt.host}       connects to MQTT as usual
```

## Keys

**Device profiles → (profile) → Provisioning → New provisioning key** (platform users with
`profile.write`). The secret (`pps_…`) is shown once and stored only as a hash.

| Setting | |
|---|---|
| Accept | **Any serial**: a unit with a serial the platform hasn't seen becomes a new device. **Only registered serials**: the serial must already exist (New device with a serial, or a CSV import with a `serial` column); safest, as a leaked key can't create devices. |
| New devices go to | A customer (and group), or unassigned stock. |
| Tags | Added to new devices (e.g. the batch). |
| Claim codes | Unassigned new devices get a claim code, returned to the unit: a factory test jig can print it on the label, and the customer adds the device with **Add with claim code**. |
| At most | A cap on devices created with the key. |
| Expires | The last day the key works. |
| Allow re-provisioning | A unit that provisioned before may fetch new credentials (its old token stops working), e.g. after its storage was wiped. Off by default: with it on, anyone holding the key and a unit's serial can take that unit's identity. |

**Revoke** stops a key at once; devices it created keep working. One key per production batch or
firmware line keeps a leak contained.

## The request

```
POST /api/v1/device/provision
{"key": "pps_…", "serial": "AA:BB:CC:DD:EE:FF", "name": "optional", "attributes": {"fw": "1.0.0"}}
```

- `serial`: the unit's own identifier, unique within the profile: letters, digits and `. _ : -`,
  up to 64 (the library uses the ESP32's MAC address).
- `201` → `{"deviceId", "token", "mqtt": {"host", "port": 8883, "tls": true}, "claimCode"}`.
- `401` the key is unknown, revoked or expired (all look the same); `403` the serial isn't
  registered (registered-only keys) or the key reached its device limit; `409` the serial already
  has credentials and the key doesn't allow re-provisioning; `429` after 30 failed attempts from one
  address in a minute (successful ones aren't limited, so a factory behind one address can
  provision any number).

Every provisioning is in the audit log (`device.provision`, with the serial and key name). AWS IoT
Core profiles use certificates instead; use AWS IoT fleet provisioning for those.

## Firmware

The PerspiceClient library (ESP32) does all of this: set `apiHost` and `provisionKey` instead of
`deviceId`, `token` and `host`. See the `MassProduction` example and
[firmware.md](firmware.md). Units keep their credentials in NVS (namespace `perspice`), which OTA
updates don't touch, so the same image can be updated over the air. If the broker keeps refusing
the stored credentials (the device was deleted or its token regenerated), the unit asks again,
which only succeeds when the key allows re-provisioning or the device was re-registered.
`clearCredentials()` makes a unit forget them (e.g. a long press on a button).

Set `apiCaCert` to the platform's root certificate (ISRG Root X1 for Let's Encrypt) so units verify
the server before sending the key.

## Security notes

- The key is in every unit's flash. Anyone who reads one unit's flash learns it. Limit the damage:
  prefer **Only registered serials**, set **At most**, give each batch its own key, turn on ESP32
  flash encryption in production, and revoke a key you suspect has leaked (then ship a new one by
  OTA).
- Tokens are per device and stored hashed; revoking a key never disconnects existing devices.
  Disable or delete a device to cut it off.
