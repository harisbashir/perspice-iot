#include "PerspiceClient.h"

#if defined(ESP32)
#include <esp_ota_ops.h>
#include <esp_sleep.h>
#include <sys/time.h>
#include <time.h>
#if defined(PERSPICE_BUFFER_FLASH)
#include <LittleFS.h>
#endif
#endif

namespace {
const uint32_t kMaxBackoffMs = 60000;
const uint8_t kMaxBatch = 10;
const uint16_t kMqttBufferBytes = 1024;
#if defined(ESP32) && defined(PERSPICE_BUFFER_FLASH)
const char* kBufferFile = "/perspice_buffer.txt";
#endif

// Decimal text of a 64-bit value (ArduinoJson cannot store 64-bit integers on AVR).
void formatU64(uint64_t value, char* out, size_t outBytes) {
  char digits[21];
  uint8_t n = 0;
  do {
    digits[n++] = static_cast<char>('0' + value % 10);
    value /= 10;
  } while (value && n < sizeof(digits));
  size_t i = 0;
  while (n && i + 1 < outBytes) out[i++] = digits[--n];
  out[i] = '\0';
}
}  // namespace

PerspiceClient* PerspiceClient::instance_ = nullptr;

PerspiceClient::PerspiceClient(Client& net) : mqtt_(net) { instance_ = this; }

PerspiceClient::~PerspiceClient() { delete buffer_; }

bool PerspiceClient::begin(const PerspiceConfig& config) {
  config_ = config;
#if defined(ESP32)
  userHost_ = config.host != nullptr;
  if ((!config_.deviceId || !config_.token) && canProvision()) loadCredentials();
  if (!hasCredentials() && !canProvision()) return false;
  if (!config_.host && !canProvision()) return false;
#else
  if (!config.host || !config.deviceId || !config.token) return false;
#endif
  delete buffer_;
  buffer_ = new PerspiceBuffer(config.bufferCapacity, PERSPICE_BUFFER_ITEM_BYTES);
  if (config_.host) mqtt_.setServer(config_.host, config_.port);
  mqtt_.setKeepAlive(config_.keepAliveS);
  mqtt_.setBufferSize(kMqttBufferBytes);
  mqtt_.setCallback(dispatch);
#if defined(ESP32)
  configTime(0, 0, "pool.ntp.org", "time.google.com");
#if defined(PERSPICE_BUFFER_FLASH)
  // Messages saved before a deep sleep or restart are sent on the next connection.
  if (LittleFS.begin(true)) {
    File f = LittleFS.open(kBufferFile, "r");
    if (f) {
      while (f.available()) {
        String line = f.readStringUntil('\n');
        if (line.length()) buffer_->push(line.c_str());
      }
      f.close();
      LittleFS.remove(kBufferFile);
    }
  }
#endif
#endif
  return true;
}

void PerspiceClient::topic(char* out, size_t outBytes, const char* channel) const {
  snprintf(out, outBytes, "perspice/v1/%s/%s", config_.deviceId, channel);
}

bool PerspiceClient::connect() {
  char status[96];
  topic(status, sizeof(status), "status");
  // The broker publishes "offline" (retained) if we drop without disconnecting.
  if (!mqtt_.connect(config_.deviceId, config_.deviceId, config_.token, status, 1, true, "offline")) return false;
  mqtt_.publish(status, "online", true);
  char t[96];
  topic(t, sizeof(t), "cmd");
  mqtt_.subscribe(t, 1);
  topic(t, sizeof(t), "config");
  mqtt_.subscribe(t, 1);
#if defined(ESP32)
  if (config_.otaEnabled) {
    topic(t, sizeof(t), "ota");
    mqtt_.subscribe(t, 1);
  }
  // Connected with this image: keep it (with rollback enabled, an image that never gets here is
  // replaced by the previous one at the next restart).
  esp_ota_mark_app_valid_cancel_rollback();
#endif
  if (config_.firmwareVersion) {
    JsonDocument fw;
    fw.set(config_.firmwareVersion);
    setAttribute("fw", fw.as<JsonVariantConst>());
  }
  return true;
}

void PerspiceClient::loop() {
  if (!buffer_) return;
#if defined(ESP32)
  if (!hasCredentials() || !config_.host) {
    provisionStep();
    return;
  }
#endif
  if (!mqtt_.connected()) {
    uint32_t now = millis();
    if (static_cast<int32_t>(now - nextAttemptMs_) < 0) return;
    if (connect()) {
      backoffMs_ = 1000;
#if defined(ESP32)
      authFailures_ = 0;
#endif
    } else {
#if defined(ESP32)
      // Credentials the broker keeps refusing (token replaced, device re-created): provision
      // again. The platform only hands out new ones when the key allows it; otherwise the stored
      // credentials stay and connecting carries on.
      int st = mqtt_.state();
      if ((st == MQTT_CONNECT_BAD_CREDENTIALS || st == MQTT_CONNECT_UNAUTHORIZED) && canProvision() && ++authFailures_ >= 3) {
        authFailures_ = 0;
        if (provision()) return;
      }
#endif
      // Exponential back-off: 1 s, 2 s, 4 s … up to 60 s.
      nextAttemptMs_ = now + backoffMs_;
      backoffMs_ = backoffMs_ * 2 > kMaxBackoffMs ? kMaxBackoffMs : backoffMs_ * 2;
      return;
    }
  }
  mqtt_.loop();
  flushBuffer();
#if defined(ESP32)
  if (otaPending_) runOta();
#endif
}

bool PerspiceClient::isConnected() { return mqtt_.connected(); }

uint64_t PerspiceClient::nowMs() {
#if defined(ESP32)
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  if (tv.tv_sec < 1600000000) return 0;  // NTP not synced yet
  return static_cast<uint64_t>(tv.tv_sec) * 1000ULL + tv.tv_usec / 1000;
#else
  return 0;  // no clock: the server stamps the receive time
#endif
}

bool PerspiceClient::sendTelemetry(JsonDocument& values, uint64_t tsMs) {
  if (!buffer_) return false;
  // {"ts":<ms>,"values":{…}}; "ts" is omitted when the time is unknown (the server stamps it).
  char payload[PERSPICE_BUFFER_ITEM_BYTES];
  size_t used = 0;
  uint64_t ts = tsMs ? tsMs : nowMs();
  if (ts) {
    char digits[21];
    formatU64(ts, digits, sizeof(digits));
    used = snprintf(payload, sizeof(payload), "{\"ts\":%s,\"values\":", digits);
  } else {
    used = snprintf(payload, sizeof(payload), "{\"values\":");
  }
  size_t len = serializeJson(values, payload + used, sizeof(payload) - used);
  if (len == 0 || used + len + 2 > sizeof(payload)) return false;  // too large for one message
  payload[used + len] = '}';
  payload[used + len + 1] = '\0';

  if (mqtt_.connected() && buffer_->empty()) {
    char t[96];
    topic(t, sizeof(t), "telemetry");
    if (mqtt_.publish(t, payload)) return true;
  }
  return buffer_->push(payload);
}

void PerspiceClient::flushBuffer() {
  if (!mqtt_.connected() || buffer_->empty()) return;
  char t[96];
  topic(t, sizeof(t), "telemetry");
  // Oldest first, up to 10 messages per publish as a JSON array; removed only once published.
  char batch[kMqttBufferBytes - 128];
  char item[PERSPICE_BUFFER_ITEM_BYTES];
  size_t used = 0;
  uint8_t n = 0;
  batch[used++] = '[';
  while (n < kMaxBatch && buffer_->peekAt(n, item, sizeof(item))) {
    size_t len = strlen(item);
    if (used + len + 2 >= sizeof(batch)) break;
    if (n) batch[used++] = ',';
    memcpy(batch + used, item, len);
    used += len;
    n++;
  }
  batch[used++] = ']';
  batch[used] = '\0';
  if (n && mqtt_.publish(t, batch)) {
    for (uint8_t i = 0; i < n; i++) buffer_->pop();
  }
}

bool PerspiceClient::setAttribute(const char* key, JsonVariantConst value) {
  if (!mqtt_.connected()) return false;
  JsonDocument doc;
  doc[key] = value;
  char payload[256];
  if (serializeJson(doc, payload, sizeof(payload)) >= sizeof(payload) - 1) return false;
  char t[96];
  topic(t, sizeof(t), "attributes");
  return mqtt_.publish(t, payload, true);
}

void PerspiceClient::onCommand(const char* name, CommandHandler handler) {
  if (commandCount_ < PERSPICE_MAX_COMMANDS) commands_[commandCount_++] = {name, handler};
}

void PerspiceClient::onConfig(ConfigHandler handler) { configHandler_ = handler; }

void PerspiceClient::dispatch(char* topic, uint8_t* payload, unsigned int length) {
  if (instance_) instance_->handleMessage(topic, payload, length);
}

void PerspiceClient::handleMessage(char* topicName, uint8_t* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  size_t topicLen = strlen(topicName);

  if (topicLen >= 7 && strcmp(topicName + topicLen - 7, "/config") == 0) {
    if (configHandler_) configHandler_(doc.as<JsonVariantConst>());
    return;
  }
#if defined(ESP32)
  if (topicLen >= 4 && strcmp(topicName + topicLen - 4, "/ota") == 0) {
    if (config_.otaEnabled) receiveOta(doc);
    return;
  }
#endif
  if (topicLen < 4 || strcmp(topicName + topicLen - 4, "/cmd") != 0) return;

  const char* cid = doc["cid"] | "";
  const char* name = doc["name"] | "";
  JsonDocument ack;
  ack["cid"] = cid;
  JsonDocument result;
  CommandHandler handler = nullptr;
  for (uint8_t i = 0; i < commandCount_; i++) {
    if (strcmp(commands_[i].name, name) == 0) handler = commands_[i].handler;
  }
  if (!handler) {
    ack["status"] = "failed";
    ack["result"]["error"] = "unknown_command";
  } else {
    bool ok = handler(doc["params"].as<JsonVariantConst>(), result);
    ack["status"] = ok ? "success" : "failed";
    if (!result.isNull()) ack["result"] = result.as<JsonVariantConst>();
  }
  char out[512];
  size_t len = serializeJson(ack, out, sizeof(out));
  if (len == 0 || len >= sizeof(out) - 1) return;
  char t[96];
  topic(t, sizeof(t), "cmd/ack");
  mqtt_.publish(t, out);
}

#if defined(ESP32)
void PerspiceClient::sleepCycle(uint32_t seconds) {
  for (uint8_t i = 0; i < 20 && mqtt_.connected() && !buffer_->empty(); i++) {
    flushBuffer();
    mqtt_.loop();
  }
#if defined(PERSPICE_BUFFER_FLASH)
  if (!buffer_->empty() && LittleFS.begin(true)) {
    File f = LittleFS.open(kBufferFile, "w");
    char item[PERSPICE_BUFFER_ITEM_BYTES];
    while (f && buffer_->peek(item, sizeof(item))) {
      f.println(item);
      buffer_->pop();
    }
    if (f) f.close();
  }
#endif
  mqtt_.disconnect();
  esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(seconds) * 1000000ULL);
  esp_deep_sleep_start();
}
#endif
