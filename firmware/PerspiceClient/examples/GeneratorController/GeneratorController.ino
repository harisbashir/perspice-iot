// GeneratorController — ESP32 on Wi-Fi with TLS. Drives a relay from the platform's
// gen_start / gen_stop commands (Telecom RMS profile) and reports gen_running.
#include <PerspiceClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

const char* WIFI_SSID = "your-ssid";
const char* WIFI_PASS = "your-password";
const int RELAY_PIN = 26;

WiFiClientSecure net;
PerspiceClient perspice(net);
bool running = false;
unsigned long lastReport = 0;

void report() {
  JsonDocument values;
  values["gen_running"] = running;
  perspice.sendTelemetry(values);
}

bool genStart(JsonVariantConst, JsonDocument& result) {
  digitalWrite(RELAY_PIN, HIGH);
  running = true;
  result["running"] = true;
  report();
  return true;
}

bool genStop(JsonVariantConst, JsonDocument& result) {
  digitalWrite(RELAY_PIN, LOW);
  running = false;
  result["running"] = false;
  report();
  return true;
}

void onConfig(JsonVariantConst config) {
  Serial.printf("Report interval from platform: %d s\n", config["interval"] | 60);
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);

  // For production, pin the CA instead: net.setCACert(ISRG_ROOT_X1_PEM);
  net.setInsecure();

  PerspiceConfig cfg;
  cfg.host = "mqtt.iot.example.com";
  cfg.port = 8883;
  cfg.useTls = true;
  cfg.deviceId = "YOUR-DEVICE-ID";
  cfg.token = "pdt_YOUR_DEVICE_TOKEN";
  perspice.begin(cfg);
  perspice.onCommand("gen_start", genStart);
  perspice.onCommand("gen_stop", genStop);
  perspice.onConfig(onConfig);
}

void loop() {
  perspice.loop();
  if (millis() - lastReport >= 60000) {
    lastReport = millis();
    report();
  }
}
