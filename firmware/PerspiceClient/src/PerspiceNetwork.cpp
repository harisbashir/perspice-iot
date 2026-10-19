#if defined(ESP32)

#include "PerspiceNetwork.h"

#include <ETH.h>
#include <Network.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_netif.h>

namespace {

const char* kNamespace = "perspice_net";
// Failed broker connections in a row over one connection before the other one is tried.
const uint8_t kFailoverAfter = 3;
const uint32_t kWifiRetryMs = 30000;

// The W5500's own bus, not the one the Arduino SPI object uses, so a display on SPI still works.
#if CONFIG_IDF_TARGET_ESP32
const spi_host_device_t kEthSpiHost = SPI2_HOST;  // SPI is VSPI (SPI3) on the ESP32
#else
const spi_host_device_t kEthSpiHost = SPI3_HOST;  // SPI is FSPI (SPI2) on the S2/S3
#endif

bool copyIn(char* dst, size_t size, const char* src) {
  if (!src || strlen(src) >= size) return false;
  strcpy(dst, src);
  return true;
}

NetworkInterface& interfaceOf(PerspiceLink link) {
  if (link == PerspiceLink::Ethernet) return ETH;
  return WiFi.STA;
}

}  // namespace

bool PerspiceNetwork::begin(const PerspiceNetworkConfig& config) {
  if (started_) return true;
  config_ = config;
  priority_ = config.priority;
  copyIn(ssid_, sizeof(ssid_), config.wifiSsid);
  copyIn(pass_, sizeof(pass_), config.wifiPass);
  if (config_.remember) {
    // Set from the HMI earlier: wins over the values compiled in.
    Preferences prefs;
    if (prefs.begin(kNamespace, true)) {
      if (prefs.isKey("prio")) {
        uint8_t p = prefs.getUChar("prio");
        if (p <= static_cast<uint8_t>(PerspicePriority::WiFiOnly)) priority_ = static_cast<PerspicePriority>(p);
      }
      if (prefs.isKey("ssid")) {
        copyIn(ssid_, sizeof(ssid_), prefs.getString("ssid").c_str());
        copyIn(pass_, sizeof(pass_), prefs.getString("pass").c_str());
      }
      prefs.end();
    }
  }

  if (config_.hostname) Network.setHostname(config_.hostname);
  Network.onEvent([this](arduino_event_id_t event, arduino_event_info_t) {
    if (event == ARDUINO_EVENT_ETH_GOT_IP) captureDns(PerspiceLink::Ethernet);
    else if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) captureDns(PerspiceLink::WiFi);
  });

  if (config_.ethernet) {
    // Fails (and the board runs on Wi-Fi alone) when no W5500 answers.
    if (config_.ethSpi) {
      ethStarted_ = ETH.begin(ETH_PHY_W5500, 1, config_.ethCs, config_.ethIrq, config_.ethRst, *config_.ethSpi, config_.ethSpiMhz);
    } else {
      ethStarted_ = ETH.begin(ETH_PHY_W5500, 1, config_.ethCs, config_.ethIrq, config_.ethRst, kEthSpiHost, config_.ethSck,
                              config_.ethMiso, config_.ethMosi, config_.ethSpiMhz);
    }
  }
  started_ = true;
  if (wantWifi()) startWifi();
  return ethStarted_ || *ssid_;
}

void PerspiceNetwork::loop() {
  if (!started_) return;
  uint32_t now = millis();

  bool want = wantWifi();
  if (want && !wifiStarted_) {
    startWifi();
  } else if (!want && wifiStarted_) {
    stopWifi();
  } else if (want && !wifiUp() && now - wifiAttemptMs_ >= kWifiRetryMs) {
    // The access point was missing or refused us; try again from scratch now and then.
    WiFi.disconnect();
    WiFi.begin(ssid_, pass_);
    wifiAttemptMs_ = now;
  }

  if (avoid_ != PerspiceLink::None && static_cast<int32_t>(now - avoidUntilMs_) >= 0) avoid_ = PerspiceLink::None;

  PerspiceLink next = choose();
  if (next != active_) {
    PerspiceLink before = active_;
    active_ = next;
    failures_ = 0;
    generation_++;
    if (next != PerspiceLink::None) makeDefault(next);
    if (onChange_) onChange_(next, before);
  } else if (dnsChanged_ && active_ != PerspiceLink::None) {
    applyDns(active_);  // the other connection's DHCP lease replaced the servers
  }
}

bool PerspiceNetwork::ethernetUp() const { return ethStarted_ && ETH.linkUp() && ETH.hasIP(); }

bool PerspiceNetwork::ethernetCable() const { return ethStarted_ && ETH.linkUp(); }

bool PerspiceNetwork::wifiUp() const { return wifiStarted_ && WiFi.STA.connected() && WiFi.STA.hasIP(); }

IPAddress PerspiceNetwork::localIP() const {
  if (active_ == PerspiceLink::None) return IPAddress();
  return interfaceOf(active_).localIP();
}

int PerspiceNetwork::wifiRssi() const { return wifiUp() ? WiFi.RSSI() : 0; }

void PerspiceNetwork::setPriority(PerspicePriority priority) {
  if (priority == priority_) return;
  priority_ = priority;
  avoid_ = PerspiceLink::None;
  failures_ = 0;
  if (config_.remember) {
    Preferences prefs;
    if (prefs.begin(kNamespace, false)) {
      prefs.putUChar("prio", static_cast<uint8_t>(priority));
      prefs.end();
    }
  }
}

bool PerspiceNetwork::setWifi(const char* ssid, const char* pass) {
  if (!pass) pass = "";
  size_t passLen = strlen(pass);
  // WPA2 needs 8 to 63 characters; empty is an open network.
  if (!ssid || !*ssid || strlen(ssid) >= sizeof(ssid_) || (passLen && (passLen < 8 || passLen >= sizeof(pass_)))) return false;
  strcpy(ssid_, ssid);
  strcpy(pass_, pass);
  if (config_.remember) {
    Preferences prefs;
    if (prefs.begin(kNamespace, false)) {
      prefs.putString("ssid", ssid_);
      prefs.putString("pass", pass_);
      prefs.end();
    }
  }
  if (wifiStarted_) stopWifi();  // loop() starts it again with the new network
  return true;
}

void PerspiceNetwork::forgetSettings() {
  Preferences prefs;
  if (prefs.begin(kNamespace, false)) {
    prefs.clear();
    prefs.end();
  }
}

void PerspiceNetwork::reportConnectFailure() {
  if (active_ == PerspiceLink::None || ++failures_ < kFailoverAfter) return;
  failures_ = 0;
  PerspiceLink other = active_ == PerspiceLink::Ethernet ? PerspiceLink::WiFi : PerspiceLink::Ethernet;
  if (!allowed(other)) return;
  // Up, but no way to the broker through it: use the other one for a while (as soon as it is up;
  // without keepStandby, Wi-Fi is started now).
  avoid_ = active_;
  avoidUntilMs_ = millis() + config_.failbackMs;
}

const char* PerspiceNetwork::linkName(PerspiceLink link) {
  switch (link) {
    case PerspiceLink::Ethernet:
      return "ethernet";
    case PerspiceLink::WiFi:
      return "wifi";
    default:
      return "none";
  }
}

const char* PerspiceNetwork::priorityName(PerspicePriority priority) {
  switch (priority) {
    case PerspicePriority::WiFiFirst:
      return "wifi_first";
    case PerspicePriority::EthernetOnly:
      return "ethernet_only";
    case PerspicePriority::WiFiOnly:
      return "wifi_only";
    default:
      return "ethernet_first";
  }
}

bool PerspiceNetwork::parsePriority(const char* name, PerspicePriority& out) {
  if (!name) return false;
  for (uint8_t p = 0; p <= static_cast<uint8_t>(PerspicePriority::WiFiOnly); p++) {
    if (strcmp(name, priorityName(static_cast<PerspicePriority>(p))) == 0) {
      out = static_cast<PerspicePriority>(p);
      return true;
    }
  }
  return false;
}

bool PerspiceNetwork::allowed(PerspiceLink link) const {
  if (link == PerspiceLink::Ethernet) return ethStarted_ && priority_ != PerspicePriority::WiFiOnly;
  if (link == PerspiceLink::WiFi) return *ssid_ && priority_ != PerspicePriority::EthernetOnly;
  return false;
}

bool PerspiceNetwork::usable(PerspiceLink link) const {
  if (!allowed(link)) return false;
  return link == PerspiceLink::Ethernet ? ethernetUp() : wifiUp();
}

PerspiceLink PerspiceNetwork::choose() const {
  bool ethFirst = priority_ == PerspicePriority::EthernetFirst || priority_ == PerspicePriority::EthernetOnly;
  const PerspiceLink order[2] = {ethFirst ? PerspiceLink::Ethernet : PerspiceLink::WiFi,
                                 ethFirst ? PerspiceLink::WiFi : PerspiceLink::Ethernet};
  for (PerspiceLink link : order) {
    if (link != avoid_ && usable(link)) return link;
  }
  // Only the connection that couldn't reach the broker is up: still better than nothing.
  for (PerspiceLink link : order) {
    if (usable(link)) return link;
  }
  return PerspiceLink::None;
}

bool PerspiceNetwork::wantWifi() const {
  if (!allowed(PerspiceLink::WiFi)) return false;
  if (priority_ != PerspicePriority::EthernetFirst) return true;
  return config_.keepStandby || !usable(PerspiceLink::Ethernet) || avoid_ == PerspiceLink::Ethernet;
}

void PerspiceNetwork::startWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid_, pass_);
  wifiStarted_ = true;
  wifiAttemptMs_ = millis();
}

void PerspiceNetwork::stopWifi() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  wifiStarted_ = false;
}

void PerspiceNetwork::makeDefault(PerspiceLink link) {
  Network.setDefaultInterface(interfaceOf(link));
  applyDns(link);
}

void PerspiceNetwork::captureDns(PerspiceLink link) {
  // Runs in the network event task, right after this connection's DHCP lease set the servers.
  uint8_t i = static_cast<uint8_t>(link);
  esp_netif_dns_info_t dns;
  esp_netif_t* netif = interfaceOf(link).netif();
  if (esp_netif_get_dns_info(netif, ESP_NETIF_DNS_MAIN, &dns) == ESP_OK && dns.ip.type == ESP_IPADDR_TYPE_V4) {
    dnsMain_[i] = dns.ip.u_addr.ip4.addr;
  }
  if (esp_netif_get_dns_info(netif, ESP_NETIF_DNS_BACKUP, &dns) == ESP_OK && dns.ip.type == ESP_IPADDR_TYPE_V4) {
    dnsBackup_[i] = dns.ip.u_addr.ip4.addr;
  }
  dnsChanged_ = true;
}

void PerspiceNetwork::applyDns(PerspiceLink link) {
  dnsChanged_ = false;
  uint8_t i = static_cast<uint8_t>(link);
  esp_netif_t* netif = interfaceOf(link).netif();
  esp_netif_dns_info_t dns = {};
  dns.ip.type = ESP_IPADDR_TYPE_V4;
  if (dnsMain_[i]) {
    dns.ip.u_addr.ip4.addr = dnsMain_[i];
    esp_netif_set_dns_info(netif, ESP_NETIF_DNS_MAIN, &dns);
  }
  if (dnsBackup_[i]) {
    dns.ip.u_addr.ip4.addr = dnsBackup_[i];
    esp_netif_set_dns_info(netif, ESP_NETIF_DNS_BACKUP, &dns);
  }
}

#endif
