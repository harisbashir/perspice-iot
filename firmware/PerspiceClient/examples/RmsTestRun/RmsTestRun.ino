// RmsTestRun — an ESP32 on Wi-Fi pretending to be a telecom site, for trying the platform out
// without any hardware attached. It sends random but believable values for every key of the
// Telecom RMS profile:
//   mains_v      mains voltage, around 230 V, with occasional outages (0 V)
//   gen_running  the generator starts by itself during an outage, or on gen_start / gen_stop
//   fuel_level   falls while the generator runs; refuelled to 100 % when it gets low
//   batt_v       48 V battery bank: charges on mains or generator, drains otherwise
//   door_open    opens now and then and closes again a little later
// so the dashboard, alarms (low fuel, mains failure, door open) and commands can all be tested.
//
// 1. Create a device with the Telecom RMS profile and copy its id and token (Credentials tab).
// 2. Fill in the Wi-Fi network, the broker and the credentials below, then flash.
// 3. Open the Serial Monitor at 115200 baud to follow what is sent.
// Shared configuration {"interval": 5} on the device or profile changes the send interval (s).
#include <PerspiceClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#define FIRMWARE_VERSION "rms-test-1.0.0"
// 1 = MQTT over TLS on 8883 (as in production), 0 = plain MQTT on 1883 (a local broker).
#define USE_TLS 1

const char* WIFI_SSID = "your-ssid";
const char* WIFI_PASS = "your-password";
const char* MQTT_HOST = "mqtt.iot.example.com";
const char* DEVICE_ID = "YOUR-DEVICE-ID";
const char* DEVICE_TOKEN = "pdt_YOUR_DEVICE_TOKEN";

#if USE_TLS
WiFiClientSecure net;
#else
WiFiClient net;
#endif
PerspiceClient perspice(net);

uint32_t intervalMs = 10000;
unsigned long lastSend = 0;
unsigned long lastWifiLog = 0;

// The simulated site.
float mainsV = 230;
bool mainsOut = false;
bool genRunning = false;
bool genManual = false;  // started or stopped from the platform: automatic control waits for a mains change
float fuelLevel = 80;
float battV = 52.0;
bool doorOpen = false;
uint8_t doorCloseIn = 0;  // sends until the door closes again

// A uniform random number in [lo, hi), from the ESP32's hardware generator.
float randomBetween(float lo, float hi) { return lo + (hi - lo) * (esp_random() / 4294967296.0f); }

// True with the given probability (0..1).
bool chance(float p) { return randomBetween(0, 1) < p; }

float clampTo(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

// One step of the simulation per send.
void simulate() {
  // Mains: a 3 % chance of an outage each step; an outage ends with a 25 % chance per step.
  bool wasOut = mainsOut;
  if (!mainsOut && chance(0.03f)) mainsOut = true;
  else if (mainsOut && chance(0.25f)) mainsOut = false;
  if (mainsOut != wasOut) genManual = false;  // a mains change hands the generator back to automatic
  mainsV = mainsOut ? 0 : clampTo(mainsV + randomBetween(-4, 4), 205, 250);

  // The generator covers an outage unless the platform took control of it.
  if (!genManual) genRunning = mainsOut && fuelLevel > 1;

  // Fuel: 0.3–0.8 % per step while running; a refuel visit when it drops under 15 %.
  if (genRunning) fuelLevel = clampTo(fuelLevel - randomBetween(0.3f, 0.8f), 0, 100);
  if (fuelLevel <= 0) {
    genRunning = false;  // ran dry
    genManual = false;
  }
  if (fuelLevel < 15 && chance(0.1f)) fuelLevel = 100;

  // Battery: charges towards 54 V with power available, drains towards 44 V without.
  bool powered = !mainsOut || genRunning;
  battV += powered ? randomBetween(0.0f, 0.15f) : -randomBetween(0.1f, 0.4f);
  battV = clampTo(battV + randomBetween(-0.05f, 0.05f), 44.0f, 54.0f);

  // Door: opened for 2–6 sends, a 5 % chance each step.
  if (doorOpen) {
    if (doorCloseIn == 0 || --doorCloseIn == 0) doorOpen = false;
  } else if (chance(0.05f)) {
    doorOpen = true;
    doorCloseIn = 2 + esp_random() % 5;
  }
}

void report() {
  JsonDocument values;
  values["mains_v"] = roundf(mainsV);
  values["gen_running"] = genRunning;
  values["fuel_level"] = roundf(fuelLevel * 10) / 10;
  values["batt_v"] = roundf(battV * 100) / 100;
  values["door_open"] = doorOpen;
  bool sent = perspice.sendTelemetry(values);
  Serial.printf("%s mains=%.0fV gen=%s fuel=%.1f%% batt=%.2fV door=%s (buffered: %u)\n", sent ? "sent" : "NOT SENT", mainsV,
                genRunning ? "on" : "off", fuelLevel, battV, doorOpen ? "open" : "closed", perspice.pending());
}

bool genStart(JsonVariantConst, JsonDocument& result) {
  if (fuelLevel <= 1) {
    result["error"] = "out of fuel";
    return false;
  }
  genRunning = true;
  genManual = true;
  Serial.println("command: gen_start");
  result["running"] = true;
  report();
  return true;
}

bool genStop(JsonVariantConst, JsonDocument& result) {
  genRunning = false;
  genManual = true;
  Serial.println("command: gen_stop");
  result["running"] = false;
  report();
  return true;
}

void onConfig(JsonVariantConst config) {
  uint32_t s = config["interval"] | intervalMs / 1000;
  if (s < 1) s = 1;
  intervalMs = s * 1000;
  Serial.printf("config: sending every %lu s\n", static_cast<unsigned long>(s));
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nPerspice RMS test run " FIRMWARE_VERSION);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("connecting to %s", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.printf("\nWi-Fi connected, IP %s\n", WiFi.localIP().toString().c_str());

  PerspiceConfig cfg;
  cfg.host = MQTT_HOST;
  cfg.deviceId = DEVICE_ID;
  cfg.token = DEVICE_TOKEN;
  cfg.firmwareVersion = FIRMWARE_VERSION;
#if USE_TLS
  // For production, pin the CA instead: net.setCACert(ISRG_ROOT_X1_PEM);
  net.setInsecure();
  cfg.port = 8883;
  cfg.useTls = true;
#else
  cfg.port = 1883;
#endif
  if (!perspice.begin(cfg)) Serial.println("begin() failed: check the host, device id and token");
  perspice.onCommand("gen_start", genStart);
  perspice.onCommand("gen_stop", genStop);
  perspice.onConfig(onConfig);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiLog > 5000) {
      lastWifiLog = millis();
      Serial.println("Wi-Fi lost, waiting to reconnect (telemetry is buffered)");
    }
  } else {
    bool was = perspice.isConnected();
    perspice.loop();
    if (perspice.isConnected() != was) Serial.println(was ? "MQTT disconnected" : "MQTT connected");
  }

  // Keeps sending while offline too: the library buffers and flushes on reconnect.
  if (millis() - lastSend >= intervalMs) {
    lastSend = millis();
    simulate();
    report();
  }
}
