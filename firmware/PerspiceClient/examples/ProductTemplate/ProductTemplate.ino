// ProductTemplate — a starting point for product firmware on ESP32 / ESP32-S3: provisioning,
// Wi-Fi + W5500 Ethernet with a priority set from the HMI, pinned TLS, OTA updates, commands and
// configuration from the platform, and a factory reset.
//
// Task layout (the part to keep when adapting it):
//   comms task, core 0   owns `network` and `perspice`: nothing else calls them, apart from the
//                        calls PerspiceNetwork documents as safe from any task (setPriority,
//                        setWifi, wifiSsid(out, n), forgetSettings, the status getters).
//                        Connecting, TLS handshakes, provisioning and OTA downloads block it for
//                        seconds at a time, which is why it is not the HMI's task.
//   app (loop()), core 1 sensors and the HMI. It talks to the comms task through queues:
//                        telemetryQueue  app → comms   readings to send (buffered while offline)
//                        controlQueue    app → comms   factory reset
//                        eventQueue      comms → app   commands and configuration from the platform
//                        and reads a status snapshot (statusSnapshot()) for its display.
//
// Settings: product_config.h. Platform side: a device profile with the telemetry keys sent below
// (temperature, uptime_s, output_on), the commands set_output {"on": bool}, set_network
// {"priority": "..."} and restart, and a provisioning key.
#include <PerspiceClient.h>
#include <WiFiClientSecure.h>

#include "product_config.h"

// ── Shared between the tasks ─────────────────────────────────────────────────────────────────
struct TelemetryItem {
  char json[256];  // {"key": value, …}
};

enum class Control : uint8_t { FactoryReset };

enum class EventType : uint8_t { SetOutput, Config };
struct AppEvent {
  EventType type;
  bool on;          // SetOutput
  uint32_t number;  // Config: the reporting interval in seconds (0 = unchanged)
};

struct CommsStatus {
  PerspiceLink link = PerspiceLink::None;
  bool broker = false;      // connected to the platform
  bool provisioned = false;
  bool otaRunning = false;
  uint16_t pending = 0;     // readings waiting while offline
  int provisionHttp = 0;    // last provisioning answer (201 ok, 401 bad key, 403/409 refused)
  char deviceId[40] = "";
  char claimCode[20] = "";
};

QueueHandle_t telemetryQueue;
QueueHandle_t controlQueue;
QueueHandle_t eventQueue;
CommsStatus status;
portMUX_TYPE statusLock = portMUX_INITIALIZER_UNLOCKED;

// Keep a new image on probation until it reaches the platform (PerspiceClient confirms it on
// connect); one that never does is rolled back at the next restart. Without this the Arduino core
// confirms every image at boot. extern "C": the core's default is a C function.
// (Below the types above: the Arduino builder inserts prototypes before the first function.)
extern "C" bool verifyRollbackLater() { return true; }

// ── Comms task: the only user of these three ─────────────────────────────────────────────────
WiFiClientSecure net;
PerspiceNetwork network;
PerspiceClient perspice(net);
uint32_t restartAtMs = 0;

bool postEvent(const AppEvent& e) { return xQueueSend(eventQueue, &e, 0) == pdTRUE; }

// Command handlers run in the comms task, inside perspice.loop(). Hand hardware work to the app
// task and answer straight away: the platform waits at most the command's TTL (30 s by default).
bool onSetOutput(JsonVariantConst params, JsonDocument& result) {
  if (!params["on"].is<bool>()) {
    result["error"] = "params.on must be true or false";
    return false;
  }
  AppEvent e{EventType::SetOutput, params["on"].as<bool>(), 0};
  if (!postEvent(e)) {
    result["error"] = "busy";
    return false;
  }
  result["on"] = e.on;
  return true;
}

bool onSetNetwork(JsonVariantConst params, JsonDocument& result) {
  PerspicePriority p;
  if (!PerspiceNetwork::parsePriority(params["priority"] | "", p)) {
    result["error"] = "priority must be ethernet_first, wifi_first, ethernet_only or wifi_only";
    return false;
  }
  network.setPriority(p);
  result["priority"] = PerspiceNetwork::priorityName(p);
  return true;
}

bool onRestart(JsonVariantConst, JsonDocument&) {
  restartAtMs = millis() + 2000;  // after the ack has gone out
  return true;
}

void onConfig(JsonVariantConst config) {
  // Shared attributes set on the device or profile, e.g. {"interval": 60}.
  AppEvent e{EventType::Config, false, config["interval"] | 0u};
  postEvent(e);
}

void publishStatus() {
  CommsStatus s;
  s.link = network.active();
  s.broker = perspice.isConnected();
  s.provisioned = perspice.hasCredentials();
  s.otaRunning = perspice.otaInProgress();
  s.pending = perspice.pending();
  s.provisionHttp = perspice.lastProvisionStatus();
  strncpy(s.deviceId, perspice.deviceId(), sizeof(s.deviceId) - 1);
  strncpy(s.claimCode, perspice.claimCode(), sizeof(s.claimCode) - 1);
  portENTER_CRITICAL(&statusLock);
  status = s;
  portEXIT_CRITICAL(&statusLock);
}

void factoryReset() {
  perspice.clearCredentials();  // provisions again on the next start, if the key allows it
  network.forgetSettings();
  network.loop();  // applies it (writes NVS)
  ESP.restart();
}

void commsTask(void*) {
  PerspiceNetworkConfig netCfg;
  netCfg.wifiSsid = DEFAULT_WIFI_SSID;
  netCfg.wifiPass = DEFAULT_WIFI_PASS;
  netCfg.priority = DEFAULT_NETWORK_PRIORITY;
  netCfg.ethernet = HAS_W5500;
  netCfg.hostname = "perspice-product";
  // netCfg.ethCs = 14; netCfg.ethIrq = 10; netCfg.ethRst = 9;  // your board's W5500 pins
  network.begin(netCfg);

  net.setCACert(PERSPICE_LETSENCRYPT_ROOTS);  // verify the broker (a --local-certs install: its root)

  PerspiceConfig cfg;
  cfg.apiHost = PLATFORM_API_HOST;
  cfg.provisionKey = PLATFORM_PROVISION_KEY;
  cfg.apiCaCert = PERSPICE_LETSENCRYPT_ROOTS;
  cfg.otaCaCert = PERSPICE_LETSENCRYPT_ROOTS;
  cfg.port = MQTT_PORT;
  cfg.useTls = true;
  cfg.firmwareVersion = FIRMWARE_VERSION;
  perspice.begin(cfg);
  perspice.useNetwork(network);
  perspice.onCommand("set_output", onSetOutput);
  perspice.onCommand("set_network", onSetNetwork);
  perspice.onCommand("restart", onRestart);
  perspice.onConfig(onConfig);

  TelemetryItem item;
  Control control;
  for (;;) {
    perspice.loop();  // network, provisioning, reconnects, buffered telemetry, OTA

    while (xQueueReceive(telemetryQueue, &item, 0) == pdTRUE) {
      JsonDocument values;
      if (!deserializeJson(values, item.json)) perspice.sendTelemetry(values);
    }
    if (xQueueReceive(controlQueue, &control, 0) == pdTRUE && control == Control::FactoryReset) factoryReset();
    if (restartAtMs && static_cast<int32_t>(millis() - restartAtMs) >= 0) ESP.restart();

    publishStatus();
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// ── App task (loop()): sensors and the HMI ───────────────────────────────────────────────────

// Queues readings for the platform; false when they don't fit a message or the queue is full.
bool queueTelemetry(JsonDocument& values) {
  TelemetryItem item;
  size_t len = serializeJson(values, item.json, sizeof(item.json));
  if (len == 0 || len >= sizeof(item.json) - 1) return false;
  return xQueueSend(telemetryQueue, &item, 0) == pdTRUE;
}

CommsStatus statusSnapshot() {
  portENTER_CRITICAL(&statusLock);
  CommsStatus s = status;
  portEXIT_CRITICAL(&statusLock);
  return s;
}

// What an HMI's network screen calls (safe from this task):
//   network.setPriority(PerspicePriority::WiFiOnly);
//   network.setWifi("site-wifi", "password");
//   char ssid[33]; network.wifiSsid(ssid, sizeof(ssid));
//   network.ethernetCable(), network.wifiRssi(), network.localIP()

uint32_t intervalMs = TELEMETRY_INTERVAL_MS;
unsigned long lastSend = 0;
unsigned long lastShow = 0;
unsigned long pressedSince = 0;
bool resetRequested = false;
bool outputOn = false;

void handleEvents() {
  AppEvent e;
  while (xQueueReceive(eventQueue, &e, 0) == pdTRUE) {
    if (e.type == EventType::SetOutput) {
      outputOn = e.on;
      digitalWrite(OUTPUT_PIN, outputOn ? HIGH : LOW);
      lastSend = 0;  // report the new state now
    } else if (e.type == EventType::Config && e.number > 0) {
      intervalMs = e.number * 1000;
    }
  }
}

void showStatus() {
  // Stand-in for the HMI: the same snapshot would feed a display.
  CommsStatus s = statusSnapshot();
  Serial.printf("[%s] link=%s broker=%s pending=%u", FIRMWARE_VERSION, PerspiceNetwork::linkName(s.link),
                s.broker ? "up" : "down", s.pending);
  if (s.provisioned) Serial.printf(" device=%s", s.deviceId);
  else if (s.provisionHttp) Serial.printf(" provisioning: HTTP %d", s.provisionHttp);
  if (*s.claimCode) Serial.printf(" claim=%s", s.claimCode);
  if (s.otaRunning) Serial.print(" OTA in progress");
  Serial.println();
}

void checkFactoryReset() {
  if (digitalRead(FACTORY_RESET_PIN) != LOW) {
    pressedSince = 0;
    return;
  }
  if (!pressedSince) pressedSince = millis();
  if (!resetRequested && millis() - pressedSince > 5000) {
    resetRequested = true;  // the comms task restarts the unit
    Serial.println("factory reset");
    Control c = Control::FactoryReset;
    xQueueSend(controlQueue, &c, 0);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(FACTORY_RESET_PIN, INPUT_PULLUP);
  pinMode(OUTPUT_PIN, OUTPUT);

  telemetryQueue = xQueueCreate(16, sizeof(TelemetryItem));
  controlQueue = xQueueCreate(4, sizeof(Control));
  eventQueue = xQueueCreate(8, sizeof(AppEvent));
  // 12 KB: TLS, HTTPS provisioning and the OTA download run on this stack.
  xTaskCreatePinnedToCore(commsTask, "perspice", 12288, nullptr, 1, nullptr, 0);
}

void loop() {
  handleEvents();
  checkFactoryReset();

  if (millis() - lastSend >= intervalMs || lastSend == 0) {
    lastSend = millis();
    JsonDocument values;
    values["temperature"] = temperatureRead();  // replace with the product's sensors
    values["uptime_s"] = millis() / 1000;
    values["output_on"] = outputOn;
    if (!queueTelemetry(values)) Serial.println("telemetry queue full");
  }
  if (millis() - lastShow >= 10000) {
    lastShow = millis();
    showStatus();
  }
  delay(20);
}
