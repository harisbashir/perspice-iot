# Phase 8a: Modbus maps on profiles (platform)

**Goal:** much of the equipment at a site speaks Modbus RTU over RS-485: generator controllers, energy
meters, rectifiers, battery monitors, air conditioners. A profile describes which registers to read and
what they mean, the device fetches that map and polls the equipment (8b), and the values arrive as
ordinary telemetry. No custom firmware per controller.

**Ships as:** platform minor. **Size:** M.

## Model

Profile gains `modbus` (null when unused). The addresses and values below are **illustrative only**, not
any real controller's map (real maps come from vendor documents; see 8c):

```json
{
  "port": { "baud": 9600, "parity": "none", "stopBits": 1 },
  "slaves": [
    {
      "unit": 1, "name": "Genset controller", "pollS": 10, "timeoutMs": 300,
      "points": [
        { "key": "gen.oil_kpa", "fn": 4, "address": 1024, "type": "u16", "scale": 1, "unit": "kPa" },
        { "key": "gen.fuel_pct", "fn": 4, "address": 1027, "type": "u16", "unit": "%" },
        { "key": "gen.hours", "fn": 4, "address": 1798, "type": "u32", "wordOrder": "big", "scale": 0.0002778, "decimals": 1, "unit": "h" },
        { "key": "gen.running", "fn": 2, "address": 0, "type": "bool" }
      ]
    }
  ],
  "writes": [
    { "command": "gen_start", "unit": 1, "fn": 6, "address": 4104, "value": 35700 }
  ]
}
```

| Item | Decision |
|---|---|
| Functions | Read: 1 (coils), 2 (discrete inputs), 3 (holding), 4 (input). Write: 5, 6, 16, used by `writes`. |
| Types | `bool`, `u16`, `i16`, `u32`, `i32`, `f32`, `u64`/`i64` (as numbers, precision noted), `bitfield` (with `bit`), `string` (`length` in registers). `wordOrder` `big`/`little` for 32/64-bit; `byteSwap` optional. |
| Conversion | `value = raw * scale + offset`, then `decimals`. Done on the device (8b), so telemetry carries engineering values. |
| Keys | Each point's `key` becomes a telemetry key definition on the profile automatically (label from `label` or the key, unit, decimals), so dashboards and alarms work as for any key. Editing a point updates its key definition. |
| Limits | ≤ 16 slaves, ≤ 200 points per profile (the protocol's 200 keys per message), polls ≥ 1 s. Contiguous points are grouped into one request by the device (8b); the editor shows the number of requests per poll. |
| Writes | Each `writes` entry binds a profile command (existing command mechanism) to a register write, so "Start generator" can be a Modbus write with no firmware code. A command's parameters may supply the value (`"valueFrom": "params.value"`). |
| Delivery | Device fetches `GET /api/v1/device/modbus` (device token auth; JSON as above, with an `ETag`/`rev`). The `config` message (shared attributes) carries a reserved key `perspice.modbusRev`; when it changes the device fetches the map again. Over HTTP, not MQTT (a map can be several KB; the device MQTT buffer is 1 KB). |

## Compatibility

- Additive: profile column `modbus jsonb null`; new device endpoint; reserved shared attribute
  `perspice.modbusRev` (old libraries pass it to the product's `onConfig` handler, which ignores unknown
  keys; mention it in the release notes for products that iterate all config keys).
- The map editor works before any library supports it (devices just don't poll yet).

## Tasks

- [ ] 1. Shared: Modbus map schema (zod) with all validation (unit ranges, address 0–65535, register
      counts per type, key pattern, limits), request grouping function (shared with the library's host
      tests as test vectors), auto-generated key definitions. Unit tests.
- [ ] 2. Server: profile `modbus` storage, revision, device endpoint, `perspice.modbusRev` in config,
      command → write binding. Integration tests including tenancy and a device of another profile.
- [ ] 3. Web: Modbus section in the profile editor (port settings; slaves; points table with type,
      scale, unit; a "requests per poll" hint; import/export JSON). Wide table: scrolls sideways on
      phones per `apps/web/CLAUDE.md`. Demo data; screenshots.
- [ ] 4. Docs: `docs/modbus.md` (new), `docs/device-protocol.md` (endpoint, reserved key), help article;
      CHANGELOG; platform release when asked.

## Done when

A profile can describe a genset controller's registers and commands, and a device can download that
description.
