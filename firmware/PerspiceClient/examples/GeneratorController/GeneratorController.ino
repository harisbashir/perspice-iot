// GeneratorController — ESP32 on Wi-Fi with TLS. Drives a relay from the platform's
// gen_start / gen_stop commands (Telecom RMS profile) and reports gen_running and an energy
// counter (energy_kwh). In the profile, a runtime calculated key on gen_running counts run hours
// for maintenance reminders, and a counter_delta key on energy_kwh gives consumption and cost.
#include <PerspiceClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

const char* WIFI_SSID = "your-ssid";
const char* WIFI_PASS = "your-password";
const int RELAY_PIN = 26;
const float RATED_KW = 20.0;  // replace with a real meter reading where there is one

WiFiClientSecure net;
PerspiceClient perspice(net);
bool running = false;
unsigned long lastReport = 0;
unsigned long lastEnergyMs = 0;
double energyKwh = 0;  // a real meter keeps this across restarts

void report() {
  unsigned long now = millis();
  if (running) energyKwh += RATED_KW * (now - lastEnergyMs) / 3600000.0;
  lastEnergyMs = now;
  JsonDocument values;
  values["gen_running"] = running;
  values["energy_kwh"] = energyKwh;
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
