#pragma once

#include <stdint.h>

#if defined(__AVR__)
#define PERSPICE_DEFAULT_BUFFER 8
#define PERSPICE_BUFFER_ITEM_BYTES 96
#else
#define PERSPICE_DEFAULT_BUFFER 64
#define PERSPICE_BUFFER_ITEM_BYTES 512
#endif

struct PerspiceConfig {
  // MQTT broker host, e.g. "mqtt.iot.example.com".
  const char* host = nullptr;
  // 8883 with TLS (pass a WiFiClientSecure), 1883 without.
  uint16_t port = 1883;
  // Device id and token from the platform's Credentials tab.
  const char* deviceId = nullptr;
  const char* token = nullptr;
  bool useTls = false;
  uint16_t keepAliveS = 30;
  // Telemetry messages kept while offline (oldest dropped when full).
  uint16_t bufferCapacity = PERSPICE_DEFAULT_BUFFER;
  // This firmware's version, reported as the "fw" attribute on every connect (OTA updates are
  // confirmed by the new version coming back after the restart).
  const char* firmwareVersion = nullptr;
  // ESP32: apply OTA updates sent by the platform.
  bool otaEnabled = true;
  // ESP32: PEM root certificate of the download server. Without it the server isn't verified,
  // but the image's SHA-256 still is before anything is written to the boot partition.
  const char* otaCaCert = nullptr;
};
