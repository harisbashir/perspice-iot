# Phase 6d: Releases (matching sets of components)

**Goal:** the maintainer's choice: a device always runs a **matching set**. A *release* (e.g. `2.3.0`)
pins one version of every component of a profile (`main` 2.3.0, `hmi` 1.8, `coproc` 3.1). Rolling out a
release updates whatever differs, in a safe order, and the device either ends on the whole new release or
returns to the whole old one.

**Ships as:** platform minor first, then PerspiceClient minor. Requires 6a (platform) and 6c (library).
**Size:** M–L.

## Model

| Concept | Decision |
|---|---|
| Release | `release (id, profile_id, version, notes, created_by, created_at)` + `release_part (release_id, component, firmware_id)`. Must pin **every** component declared on the profile (the matching set); may reuse the previous release's image for unchanged parts. Version unique per profile. Immutable once deployed. |
| Device state | Reported `components` (6a) compared to releases: a device is *on release 2.3.0* when every component matches it; otherwise *mixed versions* (shown in amber on the device and in the fleet). |
| Rollout | A release job: same batching, windows, veto, halt threshold and timeouts as component jobs; targets devices whose `caps` include `"releases"`. A device already on the release is skipped. |
| Single-component jobs | Still possible (6a) for development, but marked "breaks the matching set" in the UI and hidden behind an "advanced" option once releases exist. |

## Protocol

OTA message for a release:

```json
{"jobId":"…","release":"2.3.0","parts":[
  {"component":"coproc","kind":"avr-hex","version":"3.1","url":"…","sha256":"…","size":32768,"meta":{"mcu":"atmega328p"}},
  {"component":"hmi","kind":"nextion-tft","version":"1.8","url":"…","sha256":"…","size":9437184,"meta":{"models":["NX4832T035"]}},
  {"component":"main","kind":"esp32-app","version":"2.3.0","url":"…","sha256":"…","size":1310720}
]}
```

Only parts that differ from what the device reports are included; order is the apply order (below).
Progress messages carry `release` and the current `component`.

## Device-side sequence (library)

1. **Stage everything first:** download each part (non-main parts into the store; `main` straight into
   the inactive app partition with `Update`, not yet marked bootable). Verify every SHA-256. Any failure
   here → `failed`, nothing has been changed on the device.
2. **Keep the current images:** the store keeps the currently installed image of each non-main
   component (from the previous install), so it can go back. Storage must hold, per component, the
   current and the staged image (document the sizing: ≥ 2 × largest `.tft` + 2 × HEX).
3. **Apply in order:** `coproc` and other small parts first, then `hmi`, then switch `main` (mark the
   new partition bootable, restart). Each non-main apply is retried twice.
4. **If a non-main apply fails:** re-apply the previous images of the components already changed
   (reverse order), don't switch `main`, report `failed` with the reason. The device stays on the old
   release.
5. **After the restart:** the new `main` connects and confirms itself (the existing
   `verifyRollbackLater` mechanism), records the release in NVS, and reports `components`. If it can't
   connect, the bootloader rolls back to the old `main`.
6. **Self-heal on boot:** every `main` build knows its own release (a build flag, `PERSPICE_RELEASE`).
   On boot, the library compares the installed components with the manifest stored for that release;
   if they don't match (for example after a `main` rollback, which left the new HMI in place), it
   re-applies the stored images of that release and reports what it did. The device therefore always
   returns to *a* matching set.

## Compatibility

- Additive tables; release jobs only target `caps: ["releases"]` devices; component jobs (6a) and
  plain `main` jobs keep working for everything else.
- An old platform never sends release messages, so a new library behaves as in 6c.

## Tasks

- [ ] 1. Shared: release schemas, OTA release message and progress schemas. Unit tests.
- [ ] 2. Server: releases API (create with validation that every component is pinned, list, notes),
      release jobs (targeting, part selection per device, progress per part, *updated* when all parts
      match), mixed-version detection. Integration tests, including a device that already has some
      parts and a device without `releases` in `caps`.
- [ ] 3. Web: Releases on the Firmware page (create from component versions, compare to previous),
      Deploy release, device Firmware tab with release + component matrix and a "Mixed versions"
      warning, fleet filter. Demo data; screenshots.
- [ ] 4. Platform release.
- [ ] 5. Library: release message handling, staging all parts, keeping current images, ordered apply
      with roll-back of applied parts, `PERSPICE_RELEASE` + NVS manifest, boot-time self-heal, `caps`
      `"releases"`. Host tests for the sequencing (a fake store and fake handlers that fail at each
      step).
- [ ] 6. `ProductTemplate` as a release-based product (main + hmi); docs (`PerspiceClient/CLAUDE.md`,
      `docs/fleet.md`, protocol), CHANGELOG; library release when asked.

## Bench checklist

- Release with all three parts: device ends on the new release; order observed in the logs.
- Fail the HMI upload on purpose (unplug the display mid-upload): ATmega goes back to its previous
  image, `main` isn't switched, the job shows the failure.
- New `main` that can't reach the broker (wrong host build): bootloader rollback, then self-heal puts
  the old HMI and ATmega images back; the device reports the old release.
- Release where only `hmi` changed: only the `.tft` is downloaded.

## Done when

A device is always on one complete release, and the platform can tell exactly which, including after
failed or interrupted updates.
