// DeepSleepSensor — battery ESP32: wake, connect, send one reading, deep-sleep 5 minutes.
// Use a "sleepy" device profile so disconnects are not reported as offline.
// Define PERSPICE_BUFFER_FLASH before including the library to keep unsent readings in LittleFS.
#include <PerspiceClient.h>
#include <WiFi.h>

const char* WIFI_SSID = "your-ssid";
const char* WIFI_PASS = "your-password";
const uint32_t SLEEP_SECONDS = 300;

WiFiClient net;
PerspiceClient perspice(net);

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);

  PerspiceConfig cfg;
  cfg.host = "mqtt.iot.example.com";
  cfg.port = 1883;
  cfg.deviceId = "YOUR-DEVICE-ID";
  cfg.token = "pdt_YOUR_DEVICE_TOKEN";
  perspice.begin(cfg);

  // Connect (or give up after ~10 s and keep the reading buffered).
  for (int i = 0; i < 100 && !perspice.isConnected(); i++) {
    perspice.loop();
    delay(100);
  }

  JsonDocument values;
  values["humidity"] = 40 + (esp_random() % 200) / 10.0;  // replace with a real sensor
  values["batt_v"] = analogReadMilliVolts(34) * 2 / 1000.0;
  perspice.sendTelemetry(values);
  perspice.loop();

  perspice.sleepCycle(SLEEP_SECONDS);  // does not return
}

void loop() {}
