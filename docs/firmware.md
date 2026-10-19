# Firmware: the PerspiceClient library

`firmware/PerspiceClient` is an Arduino library for the ESP32 and ESP32-S3 on Wi-Fi and/or W5500
Ethernet, and for AVR boards (Mega with an Ethernet shield). It wraps the
[device protocol](device-protocol.md). ESP32 boards need the Espressif core 3.0 or later.

## Install

Copy `firmware/PerspiceClient` into your Arduino `libraries` folder (or pass
`--library firmware/PerspiceClient` to `arduino-cli`) and install its dependencies,
**PubSubClient** and **ArduinoJson 7** (plus **Ethernet** for AVR boards; the ESP32's W5500
driver is part of its core).

## Use

```cpp
PerspiceConfig cfg;
cfg.host = "mqtt.iot.example.com";
cfg.port = 8883;            // with WiFiClientSecure; 1883 for plain MQTT
cfg.deviceId = "…";         // device page → Credentials
cfg.token = "pdt_…";
cfg.firmwareVersion = "1.0.0";  // reported as fw; needed for OTA updates
perspice.begin(cfg);
perspice.onCommand("gen_start", genStart);

void loop() {
  perspice.loop();           // reconnects, flushes buffered telemetry
  JsonDocument values;
  values["fuel_level"] = 64.5;
  perspice.sendTelemetry(values);
}
```

- Reconnects with back-off from 1 s to 60 s and sets an `offline` last will.
- ESP32 syncs time over NTP and stamps telemetry; AVR boards leave stamping to the server.
- Telemetry is buffered while offline (64 messages on ESP32, 8 on AVR by default) and sent
  oldest-first in batches of up to 10. Build with `-DPERSPICE_BUFFER_FLASH` on ESP32 (a build flag; a `#define` in the sketch doesn't reach the library) to keep the buffer
  in LittleFS across `sleepCycle()` deep sleeps.
- With `cfg.apiHost` and `cfg.provisionKey` instead of an id, token and host, an ESP32 fetches its
  own credentials on first boot and keeps them in NVS ([provisioning.md](provisioning.md)).
- Unknown commands are answered with `failed` and `{"error":"unknown_command"}`.
- On ESP32, firmware updates from the platform are applied from `loop()` (`otaEnabled`, on by
  default): HTTPS download into the inactive partition, SHA-256 check, progress reports, restart.
  `otaInProgress()` is true meanwhile. See [fleet.md](fleet.md).

## Product firmware

Start from the `ProductTemplate` example and `firmware/PerspiceClient/CLAUDE.md`, which ships
with the library. It covers the toolchain (Espressif core 3.3.x; with PlatformIO the pioarduino
platform), partition layouts with room for OTA, the task layout (the client is not thread-safe
and `loop()` blocks), TLS pinning with `PERSPICE_LETSENCRYPT_ROOTS`, OTA rollback
(`extern "C" bool verifyRollbackLater() { return true; }`), build flags and known pitfalls.

With PlatformIO, a product pins a release of the library:

```ini
platform = https://github.com/pioarduino/platform-espressif32/releases/download/55.03.312-1/platform-espressif32.zip
framework = arduino
lib_deps = https://github.com/harisbashir/perspice-iot/releases/download/firmware-v0.3.0/PerspiceClient-0.3.0.zip
```

## Wi-Fi and W5500 Ethernet (ESP32, ESP32-S3)

`PerspiceNetwork` brings up Wi-Fi and a W5500 on SPI and decides which one carries the traffic.
Both run on the ESP32's own network stack (the core's `ETH` driver, not the Arduino Ethernet
library), so TLS, provisioning, OTA updates and NTP work the same on either.

```cpp
WiFiClientSecure net;
PerspiceNetwork network;
PerspiceClient perspice(net);

PerspiceNetworkConfig netCfg;
netCfg.wifiSsid = "site-wifi";
netCfg.wifiPass = "…";
netCfg.priority = PerspicePriority::EthernetFirst;
network.begin(netCfg);          // W5500 pins: netCfg.ethCs, ethIrq, ethRst, ethSck, ethMiso, ethMosi
perspice.begin(cfg);
perspice.useNetwork(network);   // perspice.loop() now runs the network as well

network.setPriority(PerspicePriority::WiFiOnly);  // e.g. from an HMI; kept in NVS
```

| Priority | Uses |
|---|---|
| `EthernetFirst` | Ethernet; Wi-Fi while Ethernet is down or can't reach the broker |
| `WiFiFirst` | Wi-Fi; Ethernet while Wi-Fi is down or can't reach the broker |
| `EthernetOnly` / `WiFiOnly` | that one alone (the other is not used; Wi-Fi is switched off) |

- **Switching.** A connection counts as up with a cable link (or Wi-Fi association) and an
  address. When the one in use goes down, the other takes over; when the preferred one comes back,
  the device returns to it. The MQTT session is restarted over the new connection; telemetry sent
  meanwhile is buffered.
- **No route out.** After 3 failed broker connections in a row over a connection that is up
  (a cable in, but the router has no uplink), the other connection is used for `failbackMs`
  (5 minutes), then the preferred one is tried again. Refused credentials don't count.
- **Standby.** With `keepStandby` (default) the backup connection stays up for an instant switch;
  without it, Wi-Fi is only started while it is needed.
- **From an HMI.** `setPriority()`, `setWifi()` and `forgetSettings()` are safe to call from any
  task; the change is applied (and saved) by the next `loop()`.
- **Remembered settings.** `setPriority()` and `setWifi()` are kept in NVS (namespace
  `perspice_net`) and win over the values compiled in, so an HMI choice survives restarts and OTA
  updates. `forgetSettings()` clears them; `remember = false` turns this off.
- **Reporting.** The connection in use is sent as the `net` attribute (`ethernet` / `wifi`) on
  every connect. `active()`, `ethernetUp()`, `ethernetCable()`, `wifiUp()`, `wifiRssi()`,
  `localIP()` and `onChange()` are there for a display.
- **DNS.** The ESP32 keeps one set of DNS servers, which the last DHCP lease overwrites; each
  connection's servers are remembered and restored when it becomes the active one.
- **Without a W5500** (no chip answering on the configured pins) the same firmware runs on Wi-Fi.

Default W5500 pins (change them in `PerspiceNetworkConfig`):

| W5500 | ESP32 devkit | ESP32-S3 (Waveshare ESP32-S3-ETH) |
|---|---|---|
| SCK / MISO / MOSI | 18 / 19 / 23 | 13 / 12 / 11 |
| CS | 5 | 14 |
| INT | 4 (`-1`: polled) | 10 |
| RST | not connected (`-1`) | 9 |

The W5500 gets an SPI bus of its own (not the one the Arduino `SPI` object uses), so a display on
`SPI` keeps working; to put both on one bus, call `SPI.begin(sck, miso, mosi)` and pass
`netCfg.ethSpi = &SPI`. On the ESP32, keep GPIO12 free: it selects the flash voltage at boot.

## Examples

| Example | Board | Shows |
|---|---|---|
| `BasicSensor` | Arduino Mega + Ethernet shield | periodic telemetry over Ethernet (Arduino Ethernet library) |
| `ProductTemplate` | ESP32 / ESP32-S3, Wi-Fi and/or W5500 | product skeleton: comms task + app task with queues, provisioning, pinned TLS, OTA with rollback, factory reset |
| `EthernetW5500` | ESP32 / ESP32-S3 + W5500 | MQTT over TLS on wired Ethernet, cable status |
| `DualNetwork` | ESP32 / ESP32-S3, Wi-Fi + W5500 | failover with a priority changed at run time (serial menu standing in for an HMI, `set_network` command) |
| `RmsTestRun` | ESP32 / ESP32-S3, Wi-Fi and/or W5500 | no sensors needed: random Telecom RMS values, `gen_start` / `gen_stop` |
| `GeneratorController` | ESP32 (Wi-Fi, TLS) | `gen_start` / `gen_stop` commands driving a relay, shared config |
| `DeepSleepSensor` | ESP32 (Wi-Fi) | wake → send → deep sleep (use a *sleepy* profile) |
| `OtaUpdate` | ESP32 (Wi-Fi) | firmware updates from the platform: HTTPS download, SHA-256 check, restart, version reported ([fleet.md](fleet.md)) |
| `MassProduction` | ESP32 (Wi-Fi, TLS) | one image for every unit: provisions itself with a provisioning key ([provisioning.md](provisioning.md)) |
| `GpsTracker` | ESP32 + serial GPS (NEO-6M/7M/8M), library `TinyGPSPlus` | position every 10 s, ignition input for trips ([location.md](location.md)) |

CI compiles every ESP32 example for `esp32:esp32:esp32` and `esp32:esp32:esp32s3`, and
`BasicSensor` for `arduino:avr:mega`,
and runs the buffer's host unit test (`firmware/test/buffer_test.cpp`).

## Testing without hardware

`apps/simulator` (`perspice-sim`) simulates many devices against a running installation:

```bash
perspice-sim --url https://iot.example.com --api-key pk_… --mqtt mqtt://mqtt.iot.example.com:1883 \
  --profile "Telecom RMS" --create --count 50 --interval 10 --duration 300 --measure-latency
```
