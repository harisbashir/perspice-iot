# firmware/: the PerspiceClient library

@PerspiceClient/CLAUDE.md

The guide above is shipped inside the library (zip and PlatformIO package) for product firmware.
This file adds what's needed to work on the library itself, in this repository.

## Layout

- `PerspiceClient/`: the Arduino library (`library.properties` for Arduino, `library.json` for
  PlatformIO; keep both versions equal). `src/` is the library, `examples/` are compiled in CI.
- `test/buffer_test.cpp`: host unit test of `PerspiceBuffer` (no Arduino dependencies).
- Platform-side counterparts: `docs/device-protocol.md`, `docs/firmware.md` (user docs for the
  library), `docs/provisioning.md`, `docs/fleet.md`, ingest in `apps/server/src/ingest/`.

## Build and test

CI (`.github/workflows/firmware.yml`) compiles every example for `esp32:esp32:esp32` and
`esp32:esp32:esp32s3` with the core pinned to **3.3.12**, `BasicSensor` for `arduino:avr:mega`, and
runs the buffer test. Locally:

```bash
arduino-cli core install esp32:esp32@3.3.12 arduino:avr \
  --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install PubSubClient ArduinoJson Ethernet TinyGPSPlus
arduino-cli compile -b esp32:esp32:esp32s3 --library firmware/PerspiceClient \
  --warnings all firmware/PerspiceClient/examples/ProductTemplate
g++ -std=c++17 -Wall -Wextra -Werror -I firmware/PerspiceClient/src firmware/test/buffer_test.cpp \
  firmware/PerspiceClient/src/PerspiceBuffer.cpp -o /tmp/bt && /tmp/bt
```

PlatformIO check (the way products consume it): a project with the `platformio.ini` from the
guide and `lib_deps = symlink://<path>/firmware/PerspiceClient`, then `pio run`.

Nothing here runs on hardware in CI. Changes to `PerspiceNetwork` (failover, DNS), OTA and
provisioning need a bench test on a real ESP32 / ESP32-S3 with a W5500; say so in the PR.

## Conventions

- Match the existing style: comments explain why, in full sentences; fixed buffers on the
  telemetry and MQTT paths; everything ESP32-only behind `#if defined(ESP32)`.
- Anything callable from another task must be documented as such in the header and must not touch
  NVS, Wi-Fi or the MQTT client directly (queue it for `loop()`, as `PerspiceNetwork` does).
- New compile-time options: `#ifndef` guards in `PerspiceConfig.h`, documented as build flags.
- Flash budget: the Ethernet examples use ~88% of the default 1.25 MB app slot; check the size
  printed by `arduino-cli compile` when adding code.
- Any change to the protocol must be made in the platform too (`packages/shared/src/protocol.ts`,
  `apps/server/src/ingest/`) and in `docs/device-protocol.md`.

## Releasing the library

1. Bump `version` in `PerspiceClient/library.properties` **and** `PerspiceClient/library.json`;
   update the guide's `lib_deps` URL and add a CHANGELOG entry.
2. Merge to `master`, then tag `firmware-vX.Y.Z` (not `vX.Y.Z`: `v*` tags start the platform's
   release workflow).
3. Build the zip from the tag and publish a GitHub release that is **not** marked latest:

   ```bash
   git archive --format=zip --prefix=PerspiceClient/ -o PerspiceClient-X.Y.Z.zip firmware-vX.Y.Z:firmware/PerspiceClient
   gh release create firmware-vX.Y.Z PerspiceClient-X.Y.Z.zip --verify-tag --latest=false --title "PerspiceClient X.Y.Z (firmware library)"
   ```

Products pin that zip URL in `lib_deps`, so a published release must never be replaced.
