# Phase 4: Remote logs and crash reports

**Goal:** find out what a device in the field was doing without visiting it. (1) "Get logs" uploads
the device's recent log lines. (2) After a crash, the ESP32's core dump summary (exception, PC,
backtrace, task) and the dump itself are uploaded with the firmware version, and crashes are grouped
across the fleet ("this crash happened on 14 devices running 2.3.0").

**Ships as:** platform minor first (endpoints and UI), then PerspiceClient minor. **Size:** M.

## Scope decisions

| Item | Decision |
|---|---|
| Log buffer | RAM ring buffer, default 8 KB (`PERSPICE_LOG_BYTES` build flag), filled by `perspice.log(level, fmt, ...)` (printf-style, with a millisecond timestamp). Optionally also captures ESP-IDF/Arduino logs (`esp_log_set_vprintf`) when enabled with `client.captureSystemLog(true)`. Survives a software restart in RTC slow memory when it fits (a 2 KB tail); otherwise lost on reboot, which is fine since crashes are covered by the core dump. |
| Upload | Over HTTPS, not MQTT (the MQTT buffer is 1 KB on ESP32): `POST /api/v1/device/logs` (device token auth like the other `/api/v1/device` routes), `text/plain`, ≤ 64 KB. |
| Trigger | A built-in command `perspice.logs` from the device page ("Get logs" button), and optionally automatically after a crash. Built-in commands use the reserved `perspice.` prefix and don't need declaring on the profile. |
| Crash dumps | ESP32 core dump to the `coredump` partition (present in the core's default partition tables, e.g. `default.csv` has a 64 KB `coredump` partition; products with custom tables must keep one). Enabled through the sdkconfig the Arduino core ships (verify it writes ELF dumps to flash in core 3.3.x; if not, document the PlatformIO `board_build` option that does). On the next boot the library reads the summary with `esp_core_dump_get_summary()` and uploads it as JSON, then the dump with `POST /api/v1/device/crash` (≤ 128 KB), then erases it. |
| Decoding | The platform does not symbolicate (no Xtensa/RISC-V toolchain on the server). It shows the raw PC and backtrace, groups crashes by a signature (hash of firmware version + PC + top 4 backtrace frames), and offers the dump for download plus the exact `esp-coredump` / `addr2line` command to run against the build's `.elf`. Firmware uploads may optionally include the `.elf` so the command can reference the right file. |
| Storage | Logs and dumps in object storage under `devicelogs/` and `crashes/`; the last 20 log uploads and 50 crashes per device; 30-day expiry (scheduler job). |
| Who | Platform users with `firmware.manage` see crashes; logs need `device.write` (logs may contain internals). Customers don't see either by default. |
| Health link | When phase 3 exists, a crash also shows on the Health tab (restarts with reason `panic`, linked to the crash report). |

## Compatibility

- Additive tables `device_log (id, device_id, size, file_key, created_at)` and `crash_report (id,
  device_id, firmware_version, signature, summary jsonb, file_key null, created_at)`.
- Old library: never uploads; the "Get logs" button only appears when the device's `caps` includes
  `"logs"`.
- New library + old platform: the upload endpoints 404; the library gives up quietly (logs stay in
  RAM, the core dump stays in its partition until a later successful upload).

## Tasks

- [ ] 1. Shared: crash summary schema, signature function (unit tests), `perspice.` built-in command
      names.
- [ ] 2. Server: upload endpoints (size limits, rate limit per device, auth), storage, retention job,
      list/download APIs with tenancy and permission checks. Integration tests including oversize and
      foreign-device access.
- [ ] 3. Server: built-in `perspice.logs` command (sent like other commands; acknowledged by the
      device when the upload finished).
- [ ] 4. Web: device Debug tab gains "Device logs" (Get logs, list, view with level colouring,
      download) and "Crashes" (list, summary, decode instructions); a fleet "Crashes" page grouped by
      signature and firmware version. Demo data; screenshots.
- [ ] 5. Platform release.
- [ ] 6. Library: `PerspiceLog` ring buffer (host-tested), `perspice.log()`, system log capture,
      upload over the existing HTTPS client, the built-in command, core dump read/upload/erase,
      `caps` `"logs"`, `"crash"`. CI compile; flash cost in the PR.
- [ ] 7. Library docs (`PerspiceClient/CLAUDE.md`: logging API, partition requirement), protocol
      docs, CHANGELOG; library release when asked.

## Bench checklist

- "Get logs" on a running device returns lines within seconds over Wi-Fi and Ethernet.
- A deliberate crash (null pointer in a test sketch) shows a crash report after reboot with the right
  firmware version; the downloaded dump decodes with `esp-coredump` against the sketch's `.elf`.
- Three crashes from two devices with the same bug group under one signature.

## Done when

A crash in the field can be diagnosed from the platform: what crashed, on which version, how often,
and with the dump to decode.
