// OtaUpdate — an ESP32 that takes firmware updates from the platform.
// 1. Set FIRMWARE_VERSION, build, and flash it over USB once.
// 2. For the next version, raise FIRMWARE_VERSION, build (Sketch → Export compiled binary) and
//    upload the .bin under Firmware in the platform for this device's profile.
// 3. Deploy it: the device downloads it over HTTPS, checks its SHA-256, restarts into it, and
//    reports the new version, which completes the update.
// Use a partition scheme with two app slots (the default does).
#include <PerspiceClient.h>
#include <WiFi.h>

#define FIRMWARE_VERSION "1.0.0"

// Keep a new image on probation until it reaches the platform (PerspiceClient confirms it on
// connect); one that never does is rolled back at the next restart. Without this the Arduino core
// confirms every image at boot. extern "C": the core's default is a C function.
extern "C" bool verifyRollbackLater() { return true; }

const char* WIFI_SSID = "your-ssid";
const char* WIFI_PASS = "your-password";

WiFiClient net;
PerspiceClient perspice(net);
unsigned long lastSend = 0;

void setup() {
  Serial.begin(115200);
  Serial.printf("Firmware %s\n", FIRMWARE_VERSION);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  PerspiceConfig cfg;
  cfg.host = "mqtt.iot.example.com";
  cfg.port = 1883;
  cfg.deviceId = "YOUR-DEVICE-ID";
  cfg.token = "pdt_YOUR_DEVICE_TOKEN";
  cfg.firmwareVersion = FIRMWARE_VERSION;
  // cfg.otaCaCert = "-----BEGIN CERTIFICATE-----\n…";  // to verify the download server too
  perspice.begin(cfg);
}

void loop() {
  perspice.loop();  // runs a pending update (the device restarts when it succeeds)
  if (perspice.otaInProgress()) return;
  if (millis() - lastSend >= 30000) {
    lastSend = millis();
    JsonDocument values;
    values["uptime_s"] = millis() / 1000;
    values["rssi"] = WiFi.RSSI();
    perspice.sendTelemetry(values);
  }
}
