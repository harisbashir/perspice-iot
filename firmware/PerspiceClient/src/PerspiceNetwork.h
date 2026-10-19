// PerspiceNetwork — Wi-Fi and a W5500 Ethernet module on one ESP32 / ESP32-S3, with the
// connection chosen by a priority that can change at run time (an HMI setting, a command).
// Both go through the ESP32's own network stack, so TLS, provisioning, OTA and NTP work the same
// on either. Pass it to PerspiceClient::useNetwork() and the client reconnects over the new
// connection whenever it changes.
#pragma once

#if defined(ESP32)

#include <Arduino.h>
#include <IPAddress.h>
#include <SPI.h>

enum class PerspiceLink : uint8_t { None = 0, Ethernet = 1, WiFi = 2 };

enum class PerspicePriority : uint8_t {
  EthernetFirst = 0,  // Ethernet; Wi-Fi while Ethernet is down or can't reach the broker
  WiFiFirst = 1,      // the other way round
  EthernetOnly = 2,
  WiFiOnly = 3,
};

struct PerspiceNetworkConfig {
  // Wi-Fi network; leave out for Ethernet only. Values set at run time (setWifi) take precedence.
  const char* wifiSsid = nullptr;
  const char* wifiPass = nullptr;

  // A W5500 on SPI. The defaults suit an ESP32 devkit (VSPI pins) and the Waveshare
  // ESP32-S3-ETH board; change them to match the wiring. Avoid GPIO12 on the ESP32: it selects
  // the flash voltage at boot.
  bool ethernet = true;
#if CONFIG_IDF_TARGET_ESP32S3
  int8_t ethCs = 14, ethIrq = 10, ethRst = 9, ethSck = 13, ethMiso = 12, ethMosi = 11;
#else
  int8_t ethCs = 5, ethIrq = 4, ethRst = -1, ethSck = 18, ethMiso = 19, ethMosi = 23;
#endif
  // ethIrq -1: the W5500 is polled instead (no interrupt wire). ethRst -1: not connected.
  uint8_t ethSpiMhz = 20;
  // To share an SPI bus with other devices (a display), pass the SPIClass after calling its
  // begin(sck, miso, mosi); the eth* SPI pins are then not used. Otherwise the W5500 gets a bus
  // of its own.
  SPIClass* ethSpi = nullptr;

  PerspicePriority priority = PerspicePriority::EthernetFirst;
  // Keep the second connection up while the first is in use, so a switch takes a moment rather
  // than a Wi-Fi association. false: Wi-Fi is only started while it is needed.
  bool keepStandby = true;
  // After the broker could not be reached over the preferred connection (it is up but has no
  // route out), use the other one for this long before trying the preferred one again.
  uint32_t failbackMs = 300000;
  // Keep the priority and Wi-Fi network set at run time in NVS (namespace "perspice_net").
  bool remember = true;
  const char* hostname = nullptr;
};

class PerspiceNetwork {
 public:
  using ChangeHandler = void (*)(PerspiceLink now, PerspiceLink before);

  bool begin(const PerspiceNetworkConfig& config);
  // Call from loop() (PerspiceClient::loop() does it when the network is attached).
  void loop();

  PerspiceLink active() const { return active_; }
  bool isUp() const { return active_ != PerspiceLink::None; }
  bool ethernetUp() const;  // has an address
  bool ethernetCable() const;
  bool wifiUp() const;
  IPAddress localIP() const;
  int wifiRssi() const;  // dBm, 0 while Wi-Fi is down

  // From the HMI or a command: takes effect at once and is remembered (config.remember).
  void setPriority(PerspicePriority priority);
  PerspicePriority priority() const { return priority_; }
  bool setWifi(const char* ssid, const char* pass);
  const char* wifiSsid() const { return ssid_; }
  // Forgets the remembered priority and Wi-Fi network (begin()'s values apply after a restart).
  void forgetSettings();
  void onChange(ChangeHandler handler) { onChange_ = handler; }

  // Increments on every change of the active connection.
  uint32_t generation() const { return generation_; }
  // PerspiceClient reports whether the broker was reached over the active connection.
  void reportConnectFailure();
  void reportConnected() { failures_ = 0; }

  static const char* linkName(PerspiceLink link);
  static const char* priorityName(PerspicePriority priority);
  // "ethernet_first", "wifi_first", "ethernet_only", "wifi_only".
  static bool parsePriority(const char* name, PerspicePriority& out);

 private:
  bool allowed(PerspiceLink link) const;
  bool usable(PerspiceLink link) const;
  PerspiceLink choose() const;
  bool wantWifi() const;
  void startWifi();
  void stopWifi();
  void makeDefault(PerspiceLink link);
  void captureDns(PerspiceLink link);
  void applyDns(PerspiceLink link);

  PerspiceNetworkConfig config_;
  PerspicePriority priority_ = PerspicePriority::EthernetFirst;
  char ssid_[33] = "";
  char pass_[65] = "";
  bool started_ = false;
  bool ethStarted_ = false;
  bool wifiStarted_ = false;
  uint32_t wifiAttemptMs_ = 0;
  // lwIP keeps one set of DNS servers, which the last DHCP lease overwrites; each connection's
  // are kept here (IPv4, indexed by PerspiceLink) and restored when it becomes the active one.
  uint32_t dnsMain_[3] = {};
  uint32_t dnsBackup_[3] = {};
  volatile bool dnsChanged_ = false;
  PerspiceLink active_ = PerspiceLink::None;
  // A connection that couldn't reach the broker, passed over until avoidUntilMs_.
  PerspiceLink avoid_ = PerspiceLink::None;
  uint32_t avoidUntilMs_ = 0;
  uint8_t failures_ = 0;
  uint32_t generation_ = 0;
  ChangeHandler onChange_ = nullptr;
};

#endif
