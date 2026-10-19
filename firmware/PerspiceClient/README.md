# PerspiceClient

Arduino / ESP32 library for the Perspice IoT platform (MQTT protocol `perspice/v1`).

- Telemetry with automatic timestamps (NTP on ESP32; the server stamps AVR messages)
- Offline ring buffer, flushed oldest-first in batches of up to 10 on reconnect
  (RAM; on ESP32 also LittleFS across deep sleep with `PERSPICE_BUFFER_FLASH`)
- Remote commands with acknowledgement, shared configuration, client attributes
- Reconnect with exponential back-off (1 s → 60 s) and an `offline` last-will message
- Any Arduino `Client`: Wi-Fi, Ethernet, `WiFiClientSecure` for TLS
- ESP32 / ESP32-S3: Wi-Fi and W5500 Ethernet together with `PerspiceNetwork`: failover, and a
  priority (Ethernet first, Wi-Fi first, either only) that an HMI can change at run time

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

## Wi-Fi and W5500 Ethernet (ESP32, ESP32-S3)

```cpp
WiFiClientSecure net;
PerspiceNetwork network;
PerspiceClient perspice(net);

void setup() {
  PerspiceNetworkConfig netCfg;
  netCfg.wifiSsid = "ssid";
  netCfg.wifiPass = "password";
  netCfg.priority = PerspicePriority::EthernetFirst;  // WiFiFirst, EthernetOnly, WiFiOnly
  network.begin(netCfg);         // W5500 on the default pins; see netCfg.eth*
  // … PerspiceConfig cfg as above, port 8883 …
  perspice.begin(cfg);
  perspice.useNetwork(network);  // perspice.loop() runs the network and follows its changes
}

// From an HMI button: takes effect at once and is kept in NVS.
network.setPriority(PerspicePriority::WiFiOnly);
network.setWifi("other-ssid", "password");
```

The W5500 runs on the ESP32's own network stack (the core's `ETH` driver, Espressif core 3.0 or
later), so TLS, provisioning, OTA and NTP work over either connection. The device switches when
the connection in use goes down, or when the broker can't be reached over it, and returns to the
preferred one when it recovers. Pins, standby and failback are described in `docs/firmware.md`.

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

## Memory

`PERSPICE_MQTT_BUFFER_BYTES` (1024 on ESP32, 384 on AVR) sets PubSubClient's packet buffer; it must
hold the largest message plus its topic. Override it, like the other `PERSPICE_*` sizes in
`PerspiceConfig.h`, with a `-D` build flag.

## TLS

Pass a `WiFiClientSecure` (ESP32) and port 8883. Pin the CA certificate with
`setCACert()` in production; `setInsecure()` is only for testing.

## Examples

- `BasicSensor` — Arduino Mega with an Ethernet shield (Arduino Ethernet library)
- `EthernetW5500` — ESP32 / ESP32-S3 on W5500 Ethernet with TLS
- `DualNetwork` — Wi-Fi and W5500 with failover; the priority set from a serial menu (standing in
  for an HMI) or the `set_network` command
- `GeneratorController` — relay control with `gen_start` / `gen_stop` over TLS
- `DeepSleepSensor` — wake, send, deep sleep (use a *sleepy* profile)
- `OtaUpdate` — ESP32 taking firmware updates from the platform (set `firmwareVersion`)
- `MassProduction` — one image for every unit: provisions itself with a provisioning key, stores its credentials, and forgets them on a long press of BOOT
- `RmsTestRun` — no sensors needed: an ESP32 on Wi-Fi and/or W5500 sends random but believable values for every
  Telecom RMS key (mains outages, generator, fuel, battery, door) and answers `gen_start` / `gen_stop`,
  for trying out dashboards, alarms and commands
- `GpsTracker` — ESP32 with a serial GPS (TinyGPS++): position every 10 s, optional ignition input for trips; needs the `TinyGPSPlus` library
