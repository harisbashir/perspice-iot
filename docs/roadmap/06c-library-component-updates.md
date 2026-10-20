# Phase 6c: Component updates in the library (Nextion, ATmega, storage)

**Goal:** an ESP32 product can update its other parts over the air: download the component's image to
external storage (SPI NOR flash or an SD card, never the ESP32's own flash), check it, and flash it into
a Nextion display or an ATmega over UART, then report the new version.

**Ships as:** PerspiceClient minor. Needs 6a on the platform to receive component rollouts; 6b for
resumable large downloads (without 6b it still works, restarting interrupted downloads from zero).
**Size:** L.

## Library design

```
PerspiceClient ── OTA message (component, kind, url, sha256, size, meta)
      │
      ├── main      → today's path (ESP32 Update to the other app partition)
      └── other     → PerspiceDownloader → PerspiceStore (SD or SPI flash) → component handler
                                                                   ├── PerspiceNextion  (UART)
                                                                   ├── PerspiceOptiboot (UART, STK500v1)
                                                                   ├── PerspiceStk500v2 (UART, Mega 2560)
                                                                   └── your own PerspiceComponent
```

- `client.addComponent("hmi", hmi)` registers a handler; registered components are reported in the
  `components` attribute with their kind, version and model/MCU, and `caps` gains `"components"`.
- `PerspiceComponent` (interface): `kind()`, `version()` (string), `describe(JsonObject)` (model, MCU),
  `apply(PerspiceStoreFile&, PerspiceProgress&) → bool`, and optional `readVersion()` from the part
  itself.
- Versions: after a successful `apply` the library stores the version in NVS (`perspice_comp`
  namespace) and reports it. Handlers may override with a value read from the part (a Nextion variable,
  a version command on the ATmega's own protocol) so a part flashed by hand is reported correctly.

## Storage (`PerspiceStore`)

| Backend | Header | Notes |
|---|---|---|
| SD card | `PerspiceSdStore.h` | `SD` (SPI) or `SD_MMC`; files in `/perspice/<component>-<version>.bin`; FAT is fine for 64 MB files. |
| SPI NOR flash | `PerspiceFlashStore.h` | W25Q64/128-class chips through the ESP-IDF `esp_flash` external-chip API (verify in core 3.3.x: `spi_bus_add_flash_device` + `esp_flash_init`). No file system: a simple slot layout (header with name, size, SHA-256, state; data in 64 KB-aligned extents). Needs space for the staged image plus, for 6d, the current one. |

- Bus: the W5500 uses one SPI host (`SPI2_HOST` on ESP32, `SPI3_HOST` on the ESP32-S3 by the library's
  defaults); put the SD card or flash chip **on the other host**, not sharing the W5500's bus (the IDF
  Ethernet driver and Arduino `SPI` on one host is a known source of trouble). Default pins per board go
  in the README table next to the W5500 pins.
- `PerspiceDownloader`: HTTPS GET into the store with SHA-256 as it goes; resumes with `Range` from the
  stored offset after a drop (offset + URL hash in NVS); progress to the platform as today; works on
  any link. Large downloads respect the phase 2 veto (e.g. the product defers a 20 MB `.tft` while on
  cellular).

## Nextion (`PerspiceNextion.h`)

- Supports **Basic (T) and Enhanced (K)** series over a hardware UART (`Serial2`), at the display's
  current baud (default 9600, probed: 9600, 115200, 38400, 57600, 19200…).
- Detect: wake string, then `connect` + `0xFF 0xFF 0xFF`; reply
  `comok <touch>,<reserved>,<model>,<fw>,<mcu>,<serial>,<flashSize>`. The model must be in the image's
  `meta.models` (from 6a), else `failed: model mismatch`.
- Upload protocol v1.1 (both series): `whmi-wri <size>,<baud>,0` (+ terminator), wait for `0x05`, then
  4096-byte chunks, each acknowledged with `0x05`. The command sets the upload baud: 115200 is safe;
  higher rates (many models accept up to 921600) cut the time a lot if the wiring proves reliable on
  the bench. Protocol v1.2 (`whmi-wris`, acks `0x08` with a skip
  offset) is optional and only for Enhanced/Intelligent; verify support per firmware before using.
- After the upload the display reboots into the new project; the handler waits for it to answer
  `connect` again before reporting success. A failed upload leaves the display in its upload state;
  the handler retries from the start (the display accepts a new `whmi-wri` after a power cycle or
  timeout; verify the exact recovery on the bench and document it).
- File sizes: at 115200 baud (~11 KB/s) a 5 MB file takes about 7 minutes and a 30 MB file about 45;
  at 921600 about 1 and 6. Progress reporting covers it, and the product's UI should show "Updating
  display".

## ATmega (`PerspiceOptiboot.h`, `PerspiceStk500v2.h`)

- **Optiboot / STK500v1** (ATmega328P, 1284P…): reset the ATmega (a GPIO driving RESET low for ~1 ms,
  or the DTR-style capacitor circuit), sync with `0x30 0x20` → `0x14 0x10`, check the signature
  (`0x75`) against `meta.mcu`, then per page: load address (`0x55`, word address), program page
  (`0x64`, size, `'F'`, data), read back (`0x74`) and compare, leave programming mode (`0x51`).
  Typical baud 115200 (Optiboot) or 57600 (older bootloaders): configurable.
- **STK500v2** (ATmega2560 with its stock bootloader): framed messages with sequence numbers and
  checksums; same flow (sign-on, load address, program flash, read back, leave). Implemented only if
  the products use a Mega 2560 coprocessor; confirm with the maintainer before building it.
- Intel HEX parsed as a stream from the store (records 00, 01, 02, 04); the image's page buffer is
  filled across records. Host-tested with real HEX files.
- The coprocessor's own firmware keeps working as before: the UART is shared, so the product must stop
  talking to the ATmega during the update (`apply` is called from the comms task; the product gets
  `onComponentUpdate("coproc", started|finished)` to pause its own traffic).

## Compatibility

- Additive: new headers, opt-in `addComponent`. Sketches without components behave exactly as today.
- New library + old platform: `components` attribute is stored but unused; no component rollouts
  arrive.
- Flash: each handler is its own header; SD/esp_flash/handlers only link when used.

## Tasks

- [ ] 1. Host-tested building blocks: Intel HEX streaming parser, STK500v1 framing (against a fake
      serial), Nextion protocol state machine (against a fake serial with recorded replies), store slot
      layout logic. `firmware/test/` gets these alongside `buffer_test.cpp`; CI runs them.
- [ ] 2. `PerspiceStore` + `PerspiceSdStore` + `PerspiceFlashStore`; `PerspiceDownloader` with resume.
- [ ] 3. Component plumbing in `PerspiceClient`: registry, `components` attribute, `caps`, OTA dispatch
      by component, progress, NVS versions, `onComponentUpdate`.
- [ ] 4. `PerspiceNextion` (detect, model check, v1.1 upload, reboot wait).
- [ ] 5. `PerspiceOptiboot`; `PerspiceStk500v2` only if confirmed needed.
- [ ] 6. Examples: `HmiUpdate` (ESP32 + Nextion + SD), `CoprocessorUpdate` (ESP32 + ATmega328P
      Optiboot + SPI flash); `ProductTemplate` adds an `hmi` component. CI compiles all for ESP32 and
      ESP32-S3; record flash use.
- [ ] 7. Docs: `PerspiceClient/CLAUDE.md` (components API, storage wiring, bus rules, timings),
      README pin tables, `docs/fleet.md`, CHANGELOG. Library release when asked.

## Bench checklist

- Nextion Basic (e.g. NX4832T035) and Enhanced (e.g. NX4832K035): rollout of a new `.tft` from SD and
  from SPI flash; wrong-model image refused before touching the display; power cut mid-upload, then
  recovery on the next attempt.
- ATmega328P with Optiboot: new HEX flashed and verified; wrong signature refused; the coprocessor's
  normal UART traffic resumes after the update.
- Download resume: pull the network cable mid-download; it continues from the offset (with 6b).
- W5500 and SD on separate SPI hosts both work under load during an update.

## Done when

A rollout of `hmi` or `coproc` from the platform updates the display or the ATmega in the field and the
device reports the new version, with the ESP32 itself untouched.
