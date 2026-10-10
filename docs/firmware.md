# Firmware: the PerspiceClient library

`firmware/PerspiceClient` is an Arduino library for ESP32 and AVR boards (Mega with a
W5100/W5500 shield). It wraps the [device protocol](device-protocol.md).

## Install

Copy `firmware/PerspiceClient` into your Arduino `libraries` folder (or pass
`--library firmware/PerspiceClient` to `arduino-cli`) and install its dependencies,
**PubSubClient** and **ArduinoJson 7** (plus **Ethernet** for wired boards).

## Use

```cpp
PerspiceConfig cfg;
cfg.host = "mqtt.iot.example.com";
cfg.port = 8883;            // with WiFiClientSecure; 1883 for plain MQTT
cfg.deviceId = "…";         // device page → Credentials
cfg.token = "pdt_…";
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
  oldest-first in batches of up to 10. Define `PERSPICE_BUFFER_FLASH` on ESP32 to keep the buffer
  in LittleFS across `sleepCycle()` deep sleeps.
- Unknown commands are answered with `failed` and `{"error":"unknown_command"}`.

## Examples

| Example | Board | Shows |
|---|---|---|
| `BasicSensor` | ESP32 + W5500, or Arduino Mega + Ethernet shield | periodic telemetry over Ethernet |
| `GeneratorController` | ESP32 (Wi-Fi, TLS) | `gen_start` / `gen_stop` commands driving a relay, shared config |
| `DeepSleepSensor` | ESP32 (Wi-Fi) | wake → send → deep sleep (use a *sleepy* profile) |
| `OtaUpdate` | ESP32 (Wi-Fi) | firmware updates from the platform: HTTPS download, SHA-256 check, restart, version reported ([fleet.md](fleet.md)) |
| `GpsTracker` | ESP32 + serial GPS (NEO-6M/7M/8M), library `TinyGPSPlus` | position every 10 s, ignition input for trips ([location.md](location.md)) |

CI compiles every example for `esp32:esp32:esp32` and `BasicSensor` for `arduino:avr:mega`,
and runs the buffer's host unit test (`firmware/test/buffer_test.cpp`).

## Testing without hardware

`apps/simulator` (`perspice-sim`) simulates many devices against a running installation:

```bash
perspice-sim --url https://iot.example.com --api-key pk_… --mqtt mqtt://mqtt.iot.example.com:1883 \
  --profile "Telecom RMS" --create --count 50 --interval 10 --duration 300 --measure-latency
```
