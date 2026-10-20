# Phase 6a: Firmware components (platform)

**Part of item 1, firmware for each part of a device.** The full design spans 6a–6d:
- **6a, the platform:** a device has components, and each component has its own images and versions.
- **6b:** large, resumable downloads.
- **6c, the library:** stages, flashes and reports components (Nextion, ATmega, custom).
- **6d:** releases, which deploy a matching set of component versions together.

**Goal of 6a:** the platform knows that a device consists of components (for example the ESP32 app
`main`, a Nextion HMI `hmi`, an ATmega `coproc`). It stores images per component, shows each
device's component versions, and can roll out one component on its own.

**Ships as:** platform minor. **Size:** M.

## Model

| Concept | Where | Notes |
|---|---|---|
| Component declaration | Device profile: `components: [{ key, label, kind, maxBytes?, meta? }]` | `key` matches `^[a-z][a-z0-9_]{0,31}$`; `main` always exists (the ESP32 app, kind `esp32-app`) and can't be removed. Kinds: `esp32-app`, `nextion-tft`, `avr-hex`, `fs-image`, `custom`. `meta` for Nextion: allowed `models` (e.g. `NX4832T035`, `NX4832K035`); for AVR: `mcu` (`atmega328p`, `atmega2560`…) and `bootloader` (`optiboot` / `stk500v2`). |
| Image | `firmware` table gains `component text not null default 'main'` and `meta jsonb null`; unique key becomes `(profile_id, component, version)`. | Existing rows are `main`, so nothing changes for them. |
| Device's versions | Client attribute `components`, reported by the library: `{"main":{"version":"2.3.0"},"hmi":{"kind":"nextion-tft","version":"1.8","model":"NX4832T035"},"coproc":{"kind":"avr-hex","version":"3.1","mcu":"atmega328p"}}`. `fw` stays as the main version for older code paths. | The device is the source of truth for what it has and what it supports. |
| Rollout | Unchanged job model; the job's firmware row now implies the component. | A device is *updated* when `components[<component>].version` equals the target (for `main`, `fw` as today). |

## Safety rules (the compatibility contract applied)

- A rollout of a non-`main` component only targets devices that **report that component with the
  same kind** in `components` (and, for Nextion, a model in the image's `meta.models`; for AVR, the
  same `mcu`). Devices that don't qualify are listed as *skipped: doesn't report component hmi* /
  *model NX4832K035 not supported by this image*.
- Old libraries never report `components`, so they're never sent a non-`main` image (which they'd
  otherwise try to flash as the ESP32 app).
- The OTA message gains `"component":"hmi","kind":"nextion-tft","meta":{...}`. For `main` the
  platform keeps sending today's message (component omitted), so old libraries keep working.

## Scope decisions

| Item | Decision |
|---|---|
| Size limits | Per kind, platform-wide maximums: `esp32-app` 16 MB (as today), `nextion-tft` 64 MB, `avr-hex` 1 MB, `fs-image` 16 MB, `custom` 64 MB; a profile may set lower `maxBytes`. Files over 16 MB need 6b's streaming upload; until 6b ships, keep the 16 MB cap for every kind. |
| Upload checks | `avr-hex`: valid Intel HEX, fits the MCU's flash. `nextion-tft`: size and, if possible, model from the file header (verify: the .tft header holds the model string; if not reliable, the uploader picks the model). |
| UI | Profile editor: Components section. Firmware page: images grouped by component, upload asks for the component (and model/MCU when relevant). Deploy: choose component and version. Device Firmware tab: a row per component with version, kind, model, and the last update. |
| Permissions | Unchanged (`firmware.manage`). |

## Tasks

- [ ] 1. Shared: component schemas, kinds, `components` attribute schema, size limits. Unit tests.
- [ ] 2. Migration: profile `components jsonb not null default '[{"key":"main","label":"Main firmware","kind":"esp32-app"}]'`,
      firmware `component`, `meta`, new unique index (drop the old one in the same migration: it's a
      replacement, not a rename of something code depends on). Integration test on a v1.1.0 copy.
- [ ] 3. Firmware service: upload per component with kind checks (HEX parser in shared, unit-tested).
- [ ] 4. Rollout: target filtering by reported components, model and MCU; skip reasons; *updated*
      detection per component; OTA message fields. Integration tests, including an old-library
      device (no `components`) being skipped for `hmi` and still updated for `main`.
- [ ] 5. Web: profile Components editor, Firmware page grouping, Deploy dialog, device Firmware tab.
      Demo data (an RMS profile with `main` + `hmi`); screenshots.
- [ ] 6. Docs: `docs/fleet.md` (components), `docs/device-protocol.md` (`components` attribute, OTA
      fields), help; CHANGELOG; platform release when asked.

## Done when

A profile can declare `hmi` and `coproc`, images upload per component, devices show their component
versions, and a rollout of `hmi` only reaches devices that say they have a compatible HMI.
