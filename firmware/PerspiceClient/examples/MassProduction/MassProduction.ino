// MassProduction — one firmware image for every unit: no per-device credentials.
// 1. In the platform, open the device profile → Provisioning → New provisioning key.
// 2. Put the key below, build once, and flash the same image on every unit (or ship it by OTA).
// 3. On first boot each unit sends the key with its MAC address over HTTPS and receives its own
//    device id and token, kept in NVS: they survive restarts and firmware updates.
// The serial port prints the device id (and claim code, for keys that issue them) for the label.
// Hold the BOOT button for 5 s to forget the credentials (the unit provisions again if allowed).
#include <PerspiceClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#define FIRMWARE_VERSION "1.0.0"
#define RESET_PIN 0  // BOOT button

const char* WIFI_SSID = "your-ssid";
const char* WIFI_PASS = "your-password";

WiFiClientSecure net;  // MQTT over TLS on 8883
PerspiceClient perspice(net);
unsigned long lastSend = 0;
unsigned long pressedSince = 0;
unsigned long lastLog = 0;
bool announced = false;

void setup() {
  Serial.begin(115200);
  pinMode(RESET_PIN, INPUT_PULLUP);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  net.setInsecure();  // or net.setCACert(...) with the broker's root certificate

  PerspiceConfig cfg;
  cfg.apiHost = "iot.example.com";
  cfg.provisionKey = "pps_YOUR_PROVISIONING_KEY";
  // cfg.apiCaCert = "-----BEGIN CERTIFICATE-----\n…";  // verify the platform (recommended)
  cfg.port = 8883;
  cfg.useTls = true;
  cfg.firmwareVersion = FIRMWARE_VERSION;
  perspice.begin(cfg);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) return;
  perspice.loop();  // provisions on first boot, then connects

  if (perspice.hasCredentials() && !announced) {
    announced = true;
    Serial.printf("device id: %s\n", perspice.deviceId());
    if (*perspice.claimCode()) Serial.printf("claim code: %s\n", perspice.claimCode());
  } else if (!perspice.hasCredentials() && perspice.lastProvisionStatus() != 0 && millis() - lastLog > 10000) {
    lastLog = millis();
    Serial.printf("provisioning: HTTP %d\n", perspice.lastProvisionStatus());
  }

  if (digitalRead(RESET_PIN) == LOW) {
    if (!pressedSince) pressedSince = millis();
    if (millis() - pressedSince > 5000) {
      Serial.println("forgetting credentials");
      perspice.clearCredentials();
      announced = false;
      pressedSince = 0;
    }
  } else {
    pressedSince = 0;
  }

  if (perspice.isConnected() && millis() - lastSend >= 30000) {
    lastSend = millis();
    JsonDocument values;
    values["uptime_s"] = millis() / 1000;
    values["rssi"] = WiFi.RSSI();
    perspice.sendTelemetry(values);
  }
}
