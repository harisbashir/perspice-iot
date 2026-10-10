# PerspiceClient

Arduino / ESP32 library for the Perspice IoT platform (MQTT protocol `perspice/v1`).

- Telemetry with automatic timestamps (NTP on ESP32; the server stamps AVR messages)
- Offline ring buffer, flushed oldest-first in batches of up to 10 on reconnect
  (RAM; on ESP32 also LittleFS across deep sleep with `PERSPICE_BUFFER_FLASH`)
- Remote commands with acknowledgement, shared configuration, client attributes
- Reconnect with exponential back-off (1 s → 60 s) and an `offline` last-will message
- Any Arduino `Client`: Wi-Fi, W5100/W5500 Ethernet, `WiFiClientSecure` for TLS

Dependencies: [PubSubClient](https://github.com/knolleary/pubsubclient) and
[ArduinoJson](https://arduinojson.org) 7.

## Quick start

```cpp
#include <PerspiceClient.h>
#include <WiFi.h>

WiFiClient net;
PerspiceClient perspice(net);

void setup() {
  WiFi.begin("ssid", "password");
  while (WiFi.status() != WL_CONNECTED) delay(250);

  PerspiceConfig cfg;
  cfg.host = "mqtt.iot.example.com";   // from the device's Credentials tab
  cfg.deviceId = "…";
  cfg.token = "pdt_…";
  perspice.begin(cfg);
}

void loop() {
  perspice.loop();
  static unsigned long last = 0;
  if (millis() - last > 10000) {
    last = millis();
    JsonDocument values;
    values["temperature"] = 21.5;
    perspice.sendTelemetry(values);
  }
}
```

## Commands

```cpp
bool genStart(JsonVariantConst params, JsonDocument& result) {
  digitalWrite(RELAY, HIGH);
  result["running"] = true;
  return true;            // false reports the command as failed
}
perspice.onCommand("gen_start", genStart);
```

Commands not registered are answered with `failed` and `{"error":"unknown_command"}`.

## TLS

Pass a `WiFiClientSecure` (ESP32) and port 8883. Pin the CA certificate with
`setCACert()` in production; `setInsecure()` is only for testing.

## Examples

- `BasicSensor` — W5500/W5100 Ethernet on ESP32 or Arduino Mega
- `GeneratorController` — relay control with `gen_start` / `gen_stop` over TLS
- `DeepSleepSensor` — wake, send, deep sleep (use a *sleepy* profile)
- `GpsTracker` — ESP32 with a serial GPS (TinyGPS++): position every 10 s, optional ignition input for trips; needs the `TinyGPSPlus` library
