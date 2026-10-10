// PerspiceClient — connects Arduino/ESP32 devices to the Perspice IoT platform over MQTT.
// Protocol: perspice/v1/<deviceId>/{telemetry,attributes,status,cmd,cmd/ack,config,ota,ota/progress}.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Client.h>
#include <PubSubClient.h>

#include "PerspiceBuffer.h"
#include "PerspiceConfig.h"

#ifndef PERSPICE_MAX_COMMANDS
#define PERSPICE_MAX_COMMANDS 16
#endif

class PerspiceClient {
 public:
  // Return true for success; fill `result` with anything to report back.
  using CommandHandler = bool (*)(JsonVariantConst params, JsonDocument& result);
  using ConfigHandler = void (*)(JsonVariantConst config);

  explicit PerspiceClient(Client& net);
  ~PerspiceClient();

  bool begin(const PerspiceConfig& config);
  // Call often from loop(): keeps the connection alive, reconnects and flushes the buffer.
  void loop();

  // Sends `values` (an object of key → number/string/bool/object). `tsMs` 0 = now (or, without
  // a synced clock, the server's receive time). Buffered while offline.
  bool sendTelemetry(JsonDocument& values, uint64_t tsMs = 0);
  bool setAttribute(const char* key, JsonVariantConst value);
  void onCommand(const char* name, CommandHandler handler);
  void onConfig(ConfigHandler handler);

  bool isConnected();
  // Milliseconds since the epoch once NTP has synced (ESP32), else 0.
  uint64_t nowMs();
  // Messages waiting in the offline buffer.
  uint16_t pending() const { return buffer_ ? buffer_->size() : 0; }

#if defined(ESP32)
  // Flushes, disconnects cleanly and deep-sleeps for `seconds` (the device restarts afterwards).
  void sleepCycle(uint32_t seconds);
  // True while an OTA update is downloading (the device restarts when it succeeds).
  bool otaInProgress() const { return otaPending_; }
#endif

 private:
  struct CommandEntry {
    const char* name;
    CommandHandler handler;
  };

  bool connect();
  void flushBuffer();
  void handleMessage(char* topic, uint8_t* payload, unsigned int length);
  void topic(char* out, size_t outBytes, const char* channel) const;
  static void dispatch(char* topic, uint8_t* payload, unsigned int length);

#if defined(ESP32)
  void receiveOta(JsonDocument& msg);
  void runOta();
  void otaProgress(const char* state, int pct, const char* error = nullptr);
  bool otaPending_ = false;
  char otaJob_[40] = "";
  char otaVersion_[41] = "";
  char otaSha_[65] = "";
  char otaUrl_[512] = "";
  uint32_t otaSize_ = 0;
#endif

  static PerspiceClient* instance_;
  PubSubClient mqtt_;
  PerspiceConfig config_;
  PerspiceBuffer* buffer_ = nullptr;
  CommandEntry commands_[PERSPICE_MAX_COMMANDS];
  uint8_t commandCount_ = 0;
  ConfigHandler configHandler_ = nullptr;
  uint32_t nextAttemptMs_ = 0;
  uint32_t backoffMs_ = 1000;
};
