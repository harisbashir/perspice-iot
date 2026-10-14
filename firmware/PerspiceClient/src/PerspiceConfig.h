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
  // MQTT broker host, e.g. "mqtt.iot.example.com". With a provisioning key it may be left out:
  // the platform names its broker when the device provisions.
  const char* host = nullptr;
  // 8883 with TLS (pass a WiFiClientSecure), 1883 without.
  uint16_t port = 1883;
  // Device id and token from the platform's Credentials tab. Leave both out to provision instead.
  const char* deviceId = nullptr;
  const char* token = nullptr;

  // ── Provisioning (ESP32): the same firmware for every unit ─────────────────────────────
  // With a provisioning key (Device profiles → Provisioning) and no deviceId/token, the device
  // fetches its own credentials on first boot over HTTPS and keeps them in NVS, which OTA
  // updates don't touch. Needs Wi-Fi (or ESP32 Ethernet through lwIP) for the HTTPS request.
  // The platform's web address, e.g. "iot.example.com".
  const char* apiHost = nullptr;
  // The provisioning key, "pps_…".
  const char* provisionKey = nullptr;
  // This unit's serial; default: its MAC address (AA:BB:CC:DD:EE:FF).
  const char* serial = nullptr;
  // The name for a newly created device (default: "<profile> <serial>").
  const char* deviceName = nullptr;
  // PEM root certificate of the platform's web server (ISRG Root X1 for Let's Encrypt). Without it
  // the server isn't verified, so a network attacker could learn the provisioning key.
  const char* apiCaCert = nullptr;
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
