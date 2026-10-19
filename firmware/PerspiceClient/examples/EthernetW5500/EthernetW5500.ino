// EthernetW5500 — an ESP32 or ESP32-S3 on wired Ethernet through a W5500 module, with MQTT over
// TLS. The W5500 runs on the ESP32's own network stack, so provisioning, OTA updates and the
// clock work exactly as on Wi-Fi.
//
// Wiring (the defaults in PerspiceNetworkConfig; change them below to match yours):
//   W5500    ESP32 devkit   ESP32-S3 (Waveshare ESP32-S3-ETH)
//   SCK      18             13
//   MISO     19             12
//   MOSI     23             11
//   CS       5              14
//   INT      4              10      (or ethIrq = -1: the W5500 is polled)
//   RST      -              9       (ethRst = -1 when not connected)
//   3V3/GND  3V3/GND        3V3/GND (the W5500 draws up to 150 mA: use the 3V3 rail, not a pin)
// Don't use GPIO12 on the ESP32 for any of them: it selects the flash voltage at boot.
#include <PerspiceClient.h>
#include <WiFiClientSecure.h>

#define FIRMWARE_VERSION "1.0.0"

WiFiClientSecure net;  // TLS over whichever connection is up (here: Ethernet)
PerspiceNetwork network;
PerspiceClient perspice(net);
unsigned long lastSend = 0;

void onNetworkChange(PerspiceLink now, PerspiceLink before) {
  if (now == PerspiceLink::None) {
    Serial.printf("Ethernet down (cable %s)\n", network.ethernetCable() ? "in" : "out");
  } else {
    Serial.printf("Ethernet up, IP %s\n", network.localIP().toString().c_str());
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  PerspiceNetworkConfig netCfg;
  netCfg.priority = PerspicePriority::EthernetOnly;
  netCfg.remember = false;  // nothing to choose at run time here
  netCfg.hostname = "perspice-eth";
  // netCfg.ethCs = 5; netCfg.ethIrq = 4; netCfg.ethRst = -1;  // match your wiring
  // netCfg.ethSck = 18; netCfg.ethMiso = 19; netCfg.ethMosi = 23;
  if (!network.begin(netCfg)) Serial.println("No W5500 found: check the wiring and pins");
  network.onChange(onNetworkChange);

  // For production, pin the CA instead: net.setCACert(ISRG_ROOT_X1_PEM);
  net.setInsecure();

  PerspiceConfig cfg;
  cfg.host = "mqtt.iot.example.com";
  cfg.port = 8883;
  cfg.useTls = true;
  cfg.deviceId = "YOUR-DEVICE-ID";
  cfg.token = "pdt_YOUR_DEVICE_TOKEN";
  cfg.firmwareVersion = FIRMWARE_VERSION;
  perspice.begin(cfg);
  perspice.useNetwork(network);
}

void loop() {
  perspice.loop();  // runs the network too
  if (millis() - lastSend >= 30000) {
    lastSend = millis();
    JsonDocument values;
    values["uptime_s"] = millis() / 1000;
    values["temperature"] = temperatureRead();  // the chip's own sensor; replace with a real one
    perspice.sendTelemetry(values);  // buffered while the cable is out
  }
}
