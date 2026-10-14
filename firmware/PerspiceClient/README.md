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

## Provisioning: one image for every unit (ESP32)

For devices made in quantity, don't flash credentials into each unit. Create a provisioning key on
the device profile (**Device profiles → Provisioning**), build it into the firmware, and flash the
same image everywhere:

```cpp
PerspiceConfig cfg;
cfg.apiHost = "iot.example.com";            // the platform's web address
cfg.provisionKey = "pps_…";                 // the same in every unit
cfg.apiCaCert = rootCaPem;                  // PEM root (ISRG Root X1 for Let's Encrypt): recommended
cfg.port = 8883;                            // with a WiFiClientSecure
cfg.firmwareVersion = "1.0.0";
perspice.begin(cfg);                        // no deviceId/token/host
```

On first boot the unit sends the key and its serial (its MAC address unless `cfg.serial` is set)
to `POST https://<apiHost>/api/v1/device/provision` and receives its own device id, token and
broker host, which it keeps in NVS. Restarts and OTA updates keep them, so the same image can be
updated over the air. `hasCredentials()`, `deviceId()`, `claimCode()` and
`lastProvisionStatus()` report progress (a factory jig can print the id or claim code on a label);
`clearCredentials()` forgets them. If the broker keeps refusing the stored credentials, the
device asks again, which the platform only answers when the key allows re-provisioning. HTTPS goes
through the ESP32's own network stack (Wi-Fi, or Ethernet through lwIP). See
`docs/provisioning.md` in the platform's source.

## TLS

Pass a `WiFiClientSecure` (ESP32) and port 8883. Pin the CA certificate with
`setCACert()` in production; `setInsecure()` is only for testing.

## Examples

- `BasicSensor` — W5500/W5100 Ethernet on ESP32 or Arduino Mega
- `GeneratorController` — relay control with `gen_start` / `gen_stop` over TLS
- `DeepSleepSensor` — wake, send, deep sleep (use a *sleepy* profile)
- `OtaUpdate` — ESP32 taking firmware updates from the platform (set `firmwareVersion`)
- `MassProduction` — one image for every unit: provisions itself with a provisioning key, stores its credentials, and forgets them on a long press of BOOT
- `GpsTracker` — ESP32 with a serial GPS (TinyGPS++): position every 10 s, optional ignition input for trips; needs the `TinyGPSPlus` library
