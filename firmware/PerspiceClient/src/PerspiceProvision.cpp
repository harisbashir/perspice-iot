// Provisioning for ESP32 (docs/provisioning.md): one key in every unit's firmware; on first boot
// the unit sends it with its serial over HTTPS and receives its own device id and token, kept in
// NVS (the "perspice" namespace), which firmware updates don't touch.
#if defined(ESP32)

#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFiClientSecure.h>

#include "PerspiceClient.h"

namespace {

const char* kNamespace = "perspice";
const uint32_t kMaxProvisionBackoffMs = 600000;  // 10 min
const uint32_t kRefusedRetryMs = 3600000;        // refused (403/409): try again hourly

bool copyIn(char* dst, size_t size, const char* src) {
  if (!src || !*src || strlen(src) >= size) return false;
  strcpy(dst, src);
  return true;
}

}  // namespace

void PerspiceClient::loadCredentials() {
  Preferences prefs;
  if (!prefs.begin(kNamespace, true)) return;
  String id = prefs.getString("id", "");
  String token = prefs.getString("token", "");
  String host = prefs.getString("host", "");
  String claim = prefs.getString("claim", "");
  prefs.end();
  if (!copyIn(storedId_, sizeof(storedId_), id.c_str()) || !copyIn(storedToken_, sizeof(storedToken_), token.c_str())) return;
  config_.deviceId = storedId_;
  config_.token = storedToken_;
  if (!userHost_ && copyIn(storedHost_, sizeof(storedHost_), host.c_str())) config_.host = storedHost_;
  copyIn(claimCode_, sizeof(claimCode_), claim.c_str());
}

void PerspiceClient::clearCredentials() {
  Preferences prefs;
  if (prefs.begin(kNamespace, false)) {
    prefs.clear();
    prefs.end();
  }
  mqtt_.disconnect();
  storedId_[0] = storedToken_[0] = claimCode_[0] = '\0';
  config_.deviceId = nullptr;
  config_.token = nullptr;
  if (!userHost_) config_.host = nullptr;
  nextProvisionMs_ = 0;
  provisionBackoffMs_ = 5000;
}

void PerspiceClient::provisionStep() {
  if (!canProvision()) return;
  uint32_t now = millis();
  if (static_cast<int32_t>(now - nextProvisionMs_) < 0) return;
  if (provision()) {
    provisionBackoffMs_ = 5000;
    return;
  }
  if (provisionStatus_ == 403 || provisionStatus_ == 409) {
    nextProvisionMs_ = now + kRefusedRetryMs;
  } else {
    // Network trouble, a bad key or rate limiting: 5 s, 10 s, 20 s … up to 10 minutes.
    nextProvisionMs_ = now + provisionBackoffMs_;
    provisionBackoffMs_ = provisionBackoffMs_ * 2 > kMaxProvisionBackoffMs ? kMaxProvisionBackoffMs : provisionBackoffMs_ * 2;
  }
}

bool PerspiceClient::provision() {
  const char* serial = config_.serial;
  if (!serial || !*serial) {
    uint64_t mac = ESP.getEfuseMac();
    snprintf(macSerial_, sizeof(macSerial_), "%02X:%02X:%02X:%02X:%02X:%02X", static_cast<unsigned>(mac & 0xff),
             static_cast<unsigned>((mac >> 8) & 0xff), static_cast<unsigned>((mac >> 16) & 0xff),
             static_cast<unsigned>((mac >> 24) & 0xff), static_cast<unsigned>((mac >> 32) & 0xff),
             static_cast<unsigned>((mac >> 40) & 0xff));
    serial = macSerial_;
  }

  JsonDocument req;
  req["key"] = config_.provisionKey;
  req["serial"] = serial;
  if (config_.deviceName) req["name"] = config_.deviceName;
  if (config_.firmwareVersion) req["attributes"]["fw"] = config_.firmwareVersion;
  String body;
  serializeJson(req, body);

  WiFiClientSecure tls;
  if (config_.apiCaCert) {
    tls.setCACert(config_.apiCaCert);
  } else {
    tls.setInsecure();
  }
  char url[192];
  snprintf(url, sizeof(url), "https://%s/api/v1/device/provision", config_.apiHost);
  HTTPClient http;
  if (!http.begin(tls, url)) {
    provisionStatus_ = -1;
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);
  int status = http.POST(body);
  String response = status > 0 ? http.getString() : String();
  http.end();
  provisionStatus_ = status;
  if (status != 201) return false;

  JsonDocument res;
  if (deserializeJson(res, response)) return false;
  char id[sizeof(storedId_)];
  char token[sizeof(storedToken_)];
  char host[sizeof(storedHost_)];
  if (!copyIn(id, sizeof(id), res["deviceId"] | "") || !copyIn(token, sizeof(token), res["token"] | "") ||
      !copyIn(host, sizeof(host), res["mqtt"]["host"] | "")) {
    return false;
  }
  const char* claim = res["claimCode"] | "";

  Preferences prefs;
  if (prefs.begin(kNamespace, false)) {
    prefs.putString("id", id);
    prefs.putString("token", token);
    prefs.putString("host", host);
    prefs.putString("claim", claim);
    prefs.end();
  }
  strcpy(storedId_, id);
  strcpy(storedToken_, token);
  strcpy(storedHost_, host);
  claimCode_[0] = '\0';
  copyIn(claimCode_, sizeof(claimCode_), claim);
  config_.deviceId = storedId_;
  config_.token = storedToken_;
  if (!userHost_) config_.host = storedHost_;
  mqtt_.disconnect();
  mqtt_.setServer(config_.host, config_.port);
  nextAttemptMs_ = 0;
  backoffMs_ = 1000;
  return true;
}

#endif
