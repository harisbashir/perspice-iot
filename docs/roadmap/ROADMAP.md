# Roadmap: device features after v1.1.0

Planned 2026-10-19 with the maintainer. Nothing here is built yet. Each phase below is one PR
and one release, and the system works fully between any two phases (see Compatibility).

| # | Phase | Plan | Ships as | Size | Status |
|---|---|---|---|---|---|
| 1 | Alarm snooze for site visits | [01](01-alarm-snooze.md) | platform | S | planned |
| 2 | Update windows and device veto | [02](02-update-windows.md) | platform, then library | S | planned |
| 3 | Device health readings | [03](03-device-health.md) | library, then platform | S–M | planned |
| 4 | Remote logs and crash reports | [04](04-logs-and-crash-reports.md) | platform, then library | M | planned |
| 5 | Wi-Fi setup portal | [05](05-wifi-setup-portal.md) | library | M | planned |
| 6a | Firmware components (platform) | [06a](06a-firmware-components-platform.md) | platform | M | planned |
| 6b | Large, resumable downloads | [06b](06b-large-downloads.md) | platform | S | planned |
| 6c | Component updates in the library (Nextion, ATmega) | [06c](06c-library-component-updates.md) | library | L | planned |
| 6d | Releases: matching sets of components | [06d](06d-releases-matching-sets.md) | platform, then library | M–L | planned |
| 7a | Cellular link (SIM800) in the library | [07a](07a-cellular-library.md) | library | M | planned |
| 7b | Cellular on the platform (SIM info, data use) | [07b](07b-cellular-platform.md) | platform | S | planned |
| 8a | Modbus maps on profiles | [08a](08a-modbus-platform.md) | platform | M | planned |
| 8b | Modbus polling in the library | [08b](08b-modbus-library.md) | library | M | planned |
| 8c | Modbus presets for common equipment | [08c](08c-modbus-presets.md) | platform | S | planned |

Sizes: S a day or two, M about a week, L more. "Platform, then library" means the platform part
merges and releases first; the library release follows and only then uses it.

## Order

The table is the suggested order: quick wins that need no hardware first (1, 2), then the
fault-finding tools (3, 4) that make the bigger firmware work (6, 7, 8) easier to debug in the field.
Phase 5 can move anywhere. Within 6, 7 and 8 the letters are in dependency order; across them the
numbers aren't dependent: 7 can come before 6, and 8 before either.

Hard dependencies:
- 6b before 6c is useful (Nextion files are large), but not required for small components.
- 6c before 6d (releases install components through the library's component handlers).
- 6a before 6c ships to devices (the platform must know components before a library uses them).
- 3 before 7b (7b shows the `sys.*` cellular readings that 3 defines).
- 2's veto is reused by 6c/6d and 7a (defer large downloads while on cellular).

## Compatibility contract (every phase)

The rule the maintainer set: **no two upgrades may depend on each other for the system to work.**
Concretely, for every phase:

1. **Database migrations are additive**: new tables, new nullable columns or columns with defaults.
   Never rename or drop in the same release that stops using something.
2. **Protocol changes are optional fields and new topics/endpoints.** An old library ignores
   fields it doesn't know (ArduinoJson does), and an old platform ignores keys it doesn't use.
3. **New device behaviour is opted into by the device.** A library that supports a feature says so
   in its `caps` client attribute (introduced in phase 2, a JSON array such as
   `["defer","health","logs","components","releases"]`). The platform only sends feature-specific
   messages to devices whose `caps` include the feature. A device with an old library is treated
   exactly as today.
4. **New platform behaviour is announced to the device per message** (for example `"deferAllowed":
   true` in an OTA message), so a new library talking to an old platform simply never uses it.
5. **Library releases are additive too**: new classes and opt-in calls; existing sketches compile
   and behave the same. Flash use matters (Ethernet sketches use ~88% of the default 1.25 MB app
   slot), so heavy features (web server, Modbus, PPP, SD) live in separate headers that are only
   linked when a sketch includes them.
6. Platform version N works with every library version, older or newer. This is what lets the
   platform update and the device fleet update happen weeks apart.

## Versions

Platform phases ship as the next minor version (`v1.2.0`, `v1.3.0`…) through a release PR like
#14 (`VERSION`, CHANGELOG, the upgrade matrix in `release.yml`). Library phases ship as the next
PerspiceClient minor (`firmware-v0.4.0`…), per `firmware/CLAUDE.md` › Releasing. Phases that touch
both ship the platform first.

## Hardware the maintainer will bench-test

ESP32 (WROOM/WROVER) and ESP32-S3 with a W5500; Nextion **Basic (T series) and Enhanced (K
series)** displays; an **ATmega on UART** (Optiboot, or the Mega 2560's STK500v2 bootloader: see
06c); **external SPI NOR flash or an SD card** for staging large files (never the ESP32's own
flash); **SIM800** modules for cellular; RS-485 for Modbus. CI compiles everything; only the bench
proves the hardware paths. Each plan ends with a bench checklist.

## Decisions already made

- Component firmware uses **matching sets** (releases): a device runs one release, and all its
  components belong to it (06d).
- Large component files are staged on **external flash or SD**, both supported.
- Nextion: Basic and Enhanced; upload over UART from the ESP32.
- ATmega: over UART.
- Cellular: SIM800 first (2G; see the caveats in 07a), with the same code path ready for 4G modules.
