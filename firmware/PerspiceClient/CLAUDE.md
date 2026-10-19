# PerspiceClient: guide for product firmware

PerspiceClient is the Arduino library that connects ESP32 / ESP32-S3 devices (and AVR boards, in a
reduced form) to the Perspice IoT platform over MQTT. This file is what a product needs to build on
it without rediscovering the details. Start new product firmware from
`examples/ProductTemplate/`.

Platform side: the device protocol is `docs/device-protocol.md` in the Perspice repository
(github.com/harisbashir/perspice-iot); provisioning `docs/provisioning.md`; OTA `docs/fleet.md`.

## Toolchain (the versions matter)

- **Espressif Arduino core 3.x is required** on ESP32 (`Network.h`, the native W5500 driver,
  `NetworkClientSecure`). Tested with **3.3.12** (ESP-IDF 5.5). Core 4.x (ESP-IDF 6) is untested:
  stay on 3.3.x until it has been checked.
- Libraries: **PubSubClient** ^2.8 and **ArduinoJson 7** (not 6: the code uses `JsonDocument`
  without a size and `is<T>()`).
- **PlatformIO**: the official `espressif32` platform still ships Arduino core 2.x and does **not**
  build this library. Use the pioarduino platform, pinned:

  ```ini
  [env]
  platform = https://github.com/pioarduino/platform-espressif32/releases/download/55.03.312-1/platform-espressif32.zip
  framework = arduino
  monitor_speed = 115200
  ; a release of the library (pinned), or a local checkout while developing it:
  lib_deps = https://github.com/harisbashir/perspice-iot/releases/download/firmware-v0.3.0/PerspiceClient-0.3.0.zip
  ; lib_deps = symlink://../perspice-iot/firmware/PerspiceClient
  build_flags = -DCORE_DEBUG_LEVEL=1

  [env:esp32s3]
  board = esp32-s3-devkitc-1
  board_upload.flash_size = 8MB
  board_build.partitions = default_8MB.csv

  [env:esp32dev]
  board = esp32dev
  board_build.partitions = min_spiffs.csv
  ```

  pioarduino 55.03.312-1 = Arduino core 3.3.12. `library.json` declares the PubSubClient and
  ArduinoJson dependencies, so PlatformIO installs them.
- **arduino-cli / Arduino IDE**: board package `esp32:esp32@3.3.12` from
  `https://espressif.github.io/arduino-esp32/package_esp32_index.json`; install the release zip
  with *Sketch → Include Library → Add .ZIP Library*.

## Flash layout

OTA needs two app slots of the same size. A sketch with Wi-Fi, TLS and the W5500 driver is already
~1.15 MB, 88% of the default 4 MB layout's 1.25 MB slot, so a product with an HMI needs more:

| Flash | Partitions (PlatformIO `board_build.partitions`) | Each app slot |
|---|---|---|
| 4 MB | `min_spiffs.csv` | 1.9 MB |
| 8 MB | `default_8MB.csv` | 3.2 MB |
| 16 MB | `default_16MB.csv` (or `app3M_fat9M_16MB.csv` for a 9.9 MB FAT data area) | 6.25 MB |

Never use a "No OTA" or "Huge APP" layout: updates from the platform would fail ("not enough space
for the image"). `-DPERSPICE_BUFFER_FLASH` needs a SPIFFS/LittleFS data partition too.

## Architecture of the library

| File | What it does |
|---|---|
| `src/PerspiceClient.{h,cpp}` | MQTT session, telemetry (+ offline buffer), attributes, commands, config, deep sleep |
| `src/PerspiceNetwork.{h,cpp}` | ESP32 only: Wi-Fi + W5500 (core `ETH` driver), priority, failover, DNS per connection |
| `src/PerspiceProvision.cpp` | ESP32 only: `POST /api/v1/device/provision`, credentials in NVS |
| `src/PerspiceOta.cpp` | ESP32 only: OTA download, SHA-256 check, `Update`, progress reports |
| `src/PerspiceBuffer.{h,cpp}` | Ring buffer of telemetry messages (plain C++, host-tested) |
| `src/PerspiceConfig.h` | `PerspiceConfig` and the compile-time sizes |
| `src/PerspiceCerts.h` | `PERSPICE_LETSENCRYPT_ROOTS` (ISRG Root X1 + X2) for TLS pinning |

MQTT topics: `perspice/v1/<deviceId>/{telemetry,attributes,status,cmd,cmd/ack,config,ota,ota/progress}`.
Client id and username = device id, password = token. Last will: `status` = `"offline"` (retained);
`"online"` is published on connect.

## Threading: one task owns the client

**PerspiceClient and PubSubClient are not thread-safe.** Call `perspice.*` (and `network.loop()`)
from one task only. `perspice.loop()` blocks that task for seconds at a time: TCP/TLS connect
(several seconds when the broker is unreachable), provisioning (HTTPS, 15 s timeout) and a whole
OTA download (until the restart). So:

- Run the client in its own FreeRTOS task (ProductTemplate: `commsTask`, pinned to core 0, **12 KB
  stack** for TLS, HTTPS and OTA). Run the HMI / sensors elsewhere (`loop()` on core 1).
- Pass data through queues: readings to send (app → comms), platform commands/config (comms → app),
  control requests such as factory reset (app → comms), and a status struct copied under a lock for
  the display. ProductTemplate has all four.
- Safe from **any** task: `network.setPriority()`, `network.priority()`, `network.setWifi()`,
  `network.wifiSsid(out, n)`, `network.forgetSettings()` (applied by the next `loop()`, which also
  writes NVS), and the network status getters (`active()`, `isUp()`, `ethernetUp()`,
  `ethernetCable()`, `wifiUp()`, `wifiRssi()`, `localIP()`, `generation()`).
- Not safe from another task: everything on `PerspiceClient`, `network.wifiSsid()` without
  arguments, `network.begin()`/`loop()`.
- Command and config handlers run **inside** `perspice.loop()` (comms task). They may call
  `perspice.sendTelemetry()`; anything that touches app-owned hardware should be posted to the app
  task, and the handler should answer at once (platform TTL: 30 s by default).
- Don't subscribe the comms task to the task watchdog with a short timeout: blocking calls above
  would trip it.

## Using PerspiceClient

```cpp
WiFiClientSecure net;            // NetworkClient for plain MQTT on 1883
PerspiceNetwork network;         // ESP32: Wi-Fi and/or W5500
PerspiceClient perspice(net);    // one instance per firmware (it registers a static callback)

PerspiceConfig cfg;              // copied by begin(); pointed-to strings must stay valid (literals)
cfg.apiHost = "iot.example.com"; cfg.provisionKey = "pps_…";   // or: host + deviceId + token
cfg.apiCaCert = cfg.otaCaCert = PERSPICE_LETSENCRYPT_ROOTS;
cfg.port = 8883; cfg.useTls = true;                            // useTls is informational
cfg.firmwareVersion = "1.0.0";                                 // reported as "fw"; needed for OTA
net.setCACert(PERSPICE_LETSENCRYPT_ROOTS);
perspice.begin(cfg);             // false: neither credentials nor a provisioning key
perspice.useNetwork(network);    // after network.begin(netCfg)
perspice.onCommand("set_output", handler);   // up to 16 (PERSPICE_MAX_COMMANDS)
perspice.onConfig(configHandler);
// in the comms task's loop:
perspice.loop();
```

- **Telemetry** `sendTelemetry(JsonDocument& values, uint64_t tsMs = 0)`: values are numbers,
  strings, booleans or objects; keys match `^[A-Za-z0-9_.-]{1,64}$`, at most 200 per message, and
  should match the **device profile's telemetry keys** (that's where labels, units and dashboards
  come from). The whole message (`{"ts":…,"values":{…}}`) must fit `PERSPICE_BUFFER_ITEM_BYTES`
  (512 on ESP32): `false` means too large. `ts` = now from NTP; before NTP sync it's left out and
  the server stamps the receive time.
- **Delivery is at most once**: telemetry is published with QoS 0. Messages sent while
  disconnected are buffered (64 on ESP32, oldest dropped when full) and flushed oldest-first in
  batches of 10 on reconnect; one published just before a silent connection drop can be lost. The
  server ignores duplicates with the same key and timestamp.
- **Attributes** `setAttribute(key, value)`: retained, merged into the device's client attributes.
  Only while connected (`false` otherwise, nothing is queued); at most 256 bytes. The library sets
  `fw` and, with `useNetwork()`, `net` (`ethernet`/`wifi`) on every connect.
- **Commands**: declare them on the device profile (name, params schema, confirm). Handler
  `bool (*)(JsonVariantConst params, JsonDocument& result)`: return `true` for success, fill
  `result` (the ack must fit 512 bytes). Unregistered names are answered `failed` with
  `unknown_command`. Commands sent with "hold until online" arrive after a reconnect.
- **Config**: shared attributes arrive retained on `config` on **every** connect (and on change);
  the handler must be idempotent.
- **Time**: `nowMs()` (0 before NTP sync). The library calls `configTime(0, 0, …)`, i.e. UTC. For
  local time on a display call `setenv("TZ", "…", 1); tzset();` after `perspice.begin()`.
- **Deep sleep**: `sleepCycle(seconds)` flushes, disconnects cleanly and sleeps; use a *sleepy*
  device profile so the disconnects aren't reported as offline.

## Provisioning (ESP32)

One provisioning key in every unit's firmware. On first boot `perspice.loop()` posts the key and
the unit's serial (its MAC, `AA:BB:…`, unless `cfg.serial`) and stores the returned device id,
token, broker host and claim code in **NVS namespace `perspice`**. Restarts and OTA updates keep
them. `hasCredentials()`, `deviceId()`, `claimCode()`, `lastProvisionStatus()` (201 ok, 401 bad
key, 403/409 refused, < 0 network) report progress; `clearCredentials()` forgets them (factory
reset). Refused attempts are retried hourly, network errors with back-off up to 10 minutes. If the
broker refuses the stored credentials three times, the unit provisions again (only succeeds when
the key allows re-provisioning).

## Networking (ESP32 / ESP32-S3): Wi-Fi and W5500

`PerspiceNetwork` runs Wi-Fi and a W5500 through the ESP32's own lwIP stack (`ETH.h`, **not** the
Arduino `Ethernet` library), so TLS, provisioning, OTA and NTP work over either.

- Priority: `EthernetFirst` (Wi-Fi as backup), `WiFiFirst`, `EthernetOnly`, `WiFiOnly`. Set from the
  HMI with `setPriority()`; the Wi-Fi network with `setWifi(ssid, pass)`. With `remember` (default)
  both are stored in **NVS namespace `perspice_net`** and override the compiled-in values;
  `forgetSettings()` clears them.
- Failover: a connection is "up" with link + address. When the active one drops the other takes
  over; the preferred one is taken back when it returns. 3 failed broker connections in a row over
  an up connection (no route out) switch to the other for `failbackMs` (5 min). The client restarts
  its MQTT session on every switch (telemetry is buffered meanwhile).
- `keepStandby` (default `true`) keeps the backup connected for an instant switch; `false` starts
  Wi-Fi only when needed.
- The W5500 is optional at run time: if none answers, `begin()` carries on with Wi-Fi.
- lwIP has one global DNS server list; the class restores the active connection's DNS on a switch.
- W5500 defaults: ESP32 devkit SCK 18, MISO 19, MOSI 23, CS 5, INT 4, RST not connected;
  ESP32-S3 (Waveshare ESP32-S3-ETH) SCK 13, MISO 12, MOSI 11, CS 14, INT 10, RST 9. `ethIrq = -1`
  polls instead of using INT. The W5500 gets its own SPI host (SPI2 on the ESP32, SPI3 on the S3)
  so a display on the Arduino `SPI` object keeps working; to share one bus set `netCfg.ethSpi =
  &SPI` after `SPI.begin(sck, miso, mosi)`.
- Pins to avoid: **GPIO12 on the ESP32** (selects flash voltage at boot: can brick 3.3 V modules),
  GPIO 6–11 (flash), 34–39 input-only; on the S3, GPIO 26–32 (flash) and 33–37 on octal-PSRAM
  modules (N8R8, N16R8), and the strapping pins 0, 3, 45, 46. ADC2 can't be used while Wi-Fi is on.

## TLS

Never ship `setInsecure()`. Platforms installed with public DNS use Let's Encrypt for the web API,
the broker (`mqtt.<domain>:8883`) and firmware downloads: pin `PERSPICE_LETSENCRYPT_ROOTS` on
`net` (MQTT), `cfg.apiCaCert` (provisioning) and `cfg.otaCaCert` (OTA). A platform installed with
`--local-certs` uses its own CA: get its `root.crt` (docs/install.md, "Local certificates") and pin
that instead. The core's mbedTLS is built without `MBEDTLS_HAVE_TIME_DATE`, so certificate
validity dates are not checked: TLS works before NTP has set the clock (and an expired server
certificate is not caught on the device).

## OTA updates

Set `cfg.firmwareVersion` and raise it for every release. The platform sends `{jobId, version, url,
sha256, size}`; `loop()` downloads into the inactive slot, checks the SHA-256 before committing,
reports `ota/progress`, and restarts; the new image reports its version as `fw`, which completes
the job. **Rollback** only works if the sketch defines

```cpp
extern "C" bool verifyRollbackLater() { return true; }
```

(otherwise the Arduino core confirms every image at boot). With it, the library confirms the image
on its first broker connection and an image that never connects is rolled back at the next restart.
`extern "C"` is required: without it the override silently doesn't link. Build the `.bin` with the
same partition layout as the units in the field.

## Build flags (sizes and options)

`#define` in the sketch does **not** reach the library's `.cpp` files. Set these as global build
flags only (PlatformIO `build_flags`, arduino-cli `--build-property compiler.cpp.extra_flags=…`).
`PERSPICE_MAX_COMMANDS` sizes the `PerspiceClient` class, so a mismatch between sketch and library
corrupts memory.

| Flag | Default (ESP32 / AVR) | Meaning |
|---|---|---|
| `PERSPICE_BUFFER_FLASH` | off | Keep the offline buffer in LittleFS across `sleepCycle()` |
| `PERSPICE_DEFAULT_BUFFER` | 64 / 8 | Default `cfg.bufferCapacity` |
| `PERSPICE_BUFFER_ITEM_BYTES` | 512 / 96 | Largest telemetry message |
| `PERSPICE_MQTT_BUFFER_BYTES` | 1024 / 384 | PubSubClient packet buffer (message + topic ~70 B) |
| `PERSPICE_MAX_COMMANDS` | 16 | Command handlers |

## Testing without the product hardware

- `examples/RmsTestRun`: random Telecom RMS values over Wi-Fi or Ethernet, with `gen_start` /
  `gen_stop`.
- `examples/DualNetwork`: failover with a serial menu standing in for the HMI.
- Platform: the device's **Debug** tab shows every message, rejected ones with the reason;
  `perspice-sim` (apps/simulator) simulates many devices.
- `firmware/test/buffer_test.cpp` is the host unit test of the ring buffer.

## Gotchas collected so far

- One `PerspiceClient` per firmware (a static callback pointer); one unit per set of credentials
  (the client id is the device id, a second unit kicks the first off).
- `PerspiceConfig` stores pointers: pass string literals or buffers that outlive the client.
- `perspice.loop()` must run often (keep-alive 30 s); a blocked comms task looks offline.
- AVR (Mega + Ethernet shield): plain MQTT only, no TLS, provisioning, OTA or `PerspiceNetwork`;
  timestamps come from the server.
- Don't store product data in the NVS namespaces `perspice` and `perspice_net`: factory reset
  clears them.
- `PerspicePriority`/`PerspiceLink` names for commands and displays: `PerspiceNetwork::priorityName()`,
  `parsePriority()`, `linkName()`.
- The W5100 is not supported by the ESP32 network stack; only the W5500.
- `.ino` files: the Arduino builder inserts prototypes of all the sketch's functions just above
  its **first function definition**, so put every type (`struct`, `enum`) a function signature
  uses above the first function, or move code into `.h`/`.cpp` files. PlatformIO converts `.ino`
  differently and may not show the error; arduino-cli does.
