// OTA updates for ESP32 (spec §5.6): HTTPS download into the inactive boot partition with the
// SHA-256 checked before it is committed, progress on ota/progress, then a restart. The new
// image reports its version ("fw") when it connects, which completes the update on the platform.
#if defined(ESP32)

#include <HTTPClient.h>
#include <Update.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <mbedtls/sha256.h>

#include "PerspiceClient.h"

namespace {

void copy(char* dst, size_t size, const char* src) {
  strncpy(dst, src ? src : "", size - 1);
  dst[size - 1] = '\0';
}

}  // namespace

void PerspiceClient::receiveOta(JsonDocument& msg) {
  const char* job = msg["jobId"] | "";
  const char* version = msg["version"] | "";
  // The same job again (the platform resends after a reconnect): already on it.
  if (otaPending_ && strcmp(job, otaJob_) == 0) return;
  if (config_.firmwareVersion && strcmp(version, config_.firmwareVersion) == 0) {
    copy(otaVersion_, sizeof(otaVersion_), version);
    otaProgress("applied", 100);
    return;
  }
  if (otaPending_) return;  // one update at a time
  const char* url = msg["url"] | "";
  const char* sha = msg["sha256"] | "";
  uint32_t size = msg["size"] | 0;
  if (!*url || strlen(sha) != 64 || !size || strlen(url) >= sizeof(otaUrl_)) return;
  copy(otaJob_, sizeof(otaJob_), job);
  copy(otaVersion_, sizeof(otaVersion_), version);
  copy(otaSha_, sizeof(otaSha_), sha);
  copy(otaUrl_, sizeof(otaUrl_), url);
  otaSize_ = size;
  otaPending_ = true;  // run from loop(), not inside the MQTT callback
}

void PerspiceClient::otaProgress(const char* state, int pct, const char* error) {
  JsonDocument doc;
  doc["version"] = otaVersion_;
  doc["state"] = state;
  if (pct >= 0) doc["pct"] = pct;
  if (error) doc["error"] = error;
  char out[192];
  size_t len = serializeJson(doc, out, sizeof(out));
  if (len == 0 || len >= sizeof(out) - 1) return;
  char t[96];
  topic(t, sizeof(t), "ota/progress");
  // No mqtt_.loop() here: this also runs inside the MQTT callback (receiveOta), where calling
  // it again would read the next packet into the buffer the callback is still using.
  mqtt_.publish(t, out);
}

void PerspiceClient::runOta() {
  // otaPending_ stays set while the download runs, so the same job resent meanwhile (the MQTT
  // loop is serviced below) is recognised and a different one waits.
  runOtaDownload();
  otaPending_ = false;
}

void PerspiceClient::runOtaDownload() {
  const bool https = strncmp(otaUrl_, "https://", 8) == 0;
  WiFiClientSecure secure;
  WiFiClient plain;
  if (https) {
    if (config_.otaCaCert) secure.setCACert(config_.otaCaCert);
    else secure.setInsecure();  // integrity still comes from the SHA-256 below
  }
  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(https ? static_cast<WiFiClient&>(secure) : plain, otaUrl_)) {
    otaProgress("failed", -1, "bad download URL");
    return;
  }
  int code = http.GET();
  if (code != 200) {
    char err[48];
    snprintf(err, sizeof(err), "download failed (HTTP %d)", code);
    otaProgress("failed", -1, err);
    http.end();
    return;
  }
  int length = http.getSize();
  if (length > 0 && static_cast<uint32_t>(length) != otaSize_) {
    otaProgress("failed", -1, "size mismatch");
    http.end();
    return;
  }
  if (!Update.begin(otaSize_)) {
    otaProgress("failed", -1, "not enough space for the image");
    http.end();
    return;
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);
  WiFiClient* stream = http.getStreamPtr();
  uint8_t buf[1024];
  uint32_t done = 0;
  int lastPct = -10;
  uint32_t idleSince = millis();
  otaProgress("downloading", 0);
  mqtt_.loop();
  while (done < otaSize_) {
    size_t avail = stream->available();
    if (!avail) {
      if (!http.connected() || millis() - idleSince > 20000) break;
      delay(5);
      continue;
    }
    idleSince = millis();
    size_t n = stream->readBytes(buf, avail < sizeof(buf) ? avail : sizeof(buf));
    mbedtls_sha256_update(&sha, buf, n);
    if (Update.write(buf, n) != n) break;
    done += n;
    int pct = static_cast<int>(done * 100ULL / otaSize_);
    if (pct >= lastPct + 10) {
      lastPct = pct;
      otaProgress("downloading", pct);
      mqtt_.loop();  // keep the broker connection alive through a long download
    }
  }
  http.end();

  uint8_t digest[32];
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);
  if (done != otaSize_) {
    Update.abort();
    otaProgress("failed", -1, "download incomplete");
    return;
  }
  otaProgress("verifying", 100);
  mqtt_.loop();
  char hex[65];
  for (int i = 0; i < 32; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
  if (strcasecmp(hex, otaSha_) != 0) {
    Update.abort();  // nothing was committed: the current image keeps running
    otaProgress("failed", -1, "checksum mismatch");
    return;
  }
  if (!Update.end(true)) {
    otaProgress("failed", -1, Update.errorString());
    return;
  }
  otaProgress("applied", 100);
  for (uint8_t i = 0; i < 10; i++) {
    mqtt_.loop();
    delay(50);
  }
  mqtt_.disconnect();
  ESP.restart();
}

#endif
