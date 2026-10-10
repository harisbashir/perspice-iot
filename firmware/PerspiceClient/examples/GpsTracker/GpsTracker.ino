// GpsTracker — ESP32 with a serial GPS module (NEO-6M/7M/8M) reporting its position every
// 10 seconds while it has a fix. Use a device profile with "Reported by the device" location
// (keys lat, lng, speed, heading, acc) and, for trips, "Detect trips".
// Wiring: GPS TX → GPIO 16 (RX2), GPS RX → GPIO 17 (TX2), 9600 baud. Optional ignition sense on
// GPIO 27 (through a divider/opto-coupler; HIGH = ignition on): set the profile's ignition key to
// "ignition" so trips follow it.
#include <PerspiceClient.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>

const char* WIFI_SSID = "your-ssid";
const char* WIFI_PASS = "your-password";
const int GPS_RX = 16;
const int GPS_TX = 17;
const int IGNITION_PIN = 27;  // -1 when not wired
const unsigned long INTERVAL_MS = 10000;
// A GPS module's horizontal accuracy is roughly HDOP × this many metres.
const double METRES_PER_HDOP = 5.0;

WiFiClient net;
PerspiceClient perspice(net);
TinyGPSPlus gps;
unsigned long lastSend = 0;
int lastIgnition = -1;

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);
  if (IGNITION_PIN >= 0) pinMode(IGNITION_PIN, INPUT);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  PerspiceConfig cfg;
  cfg.host = "mqtt.iot.example.com";
  cfg.port = 1883;
  cfg.deviceId = "YOUR-DEVICE-ID";
  cfg.token = "pdt_YOUR_DEVICE_TOKEN";
  cfg.bufferCapacity = 64;  // positions are kept while out of coverage and sent on reconnect
  perspice.begin(cfg);
}

void loop() {
  while (Serial2.available()) gps.encode(Serial2.read());
  perspice.loop();

  // Report an ignition change at once, so a trip starts or ends on time.
  if (IGNITION_PIN >= 0) {
    int ignition = digitalRead(IGNITION_PIN);
    if (ignition != lastIgnition) {
      lastIgnition = ignition;
      JsonDocument values;
      values["ignition"] = ignition == HIGH;
      perspice.sendTelemetry(values);
    }
  }

  if (millis() - lastSend < INTERVAL_MS) return;
  lastSend = millis();
  // Only a current fix: an old one would draw the route in the wrong place.
  if (!gps.location.isValid() || gps.location.age() > 2000) {
    Serial.println(F("waiting for a GPS fix"));
    return;
  }
  JsonDocument values;
  values["lat"] = serialized(String(gps.location.lat(), 6));
  values["lng"] = serialized(String(gps.location.lng(), 6));
  if (gps.speed.isValid()) values["speed"] = gps.speed.kmph();
  if (gps.course.isValid()) values["heading"] = gps.course.deg();
  if (gps.hdop.isValid()) values["acc"] = gps.hdop.hdop() * METRES_PER_HDOP;
  if (gps.altitude.isValid()) values["alt"] = gps.altitude.meters();
  if (gps.satellites.isValid()) values["sats"] = gps.satellites.value();
  perspice.sendTelemetry(values);
}
