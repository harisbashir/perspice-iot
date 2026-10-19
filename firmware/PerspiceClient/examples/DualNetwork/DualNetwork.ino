// DualNetwork — Wi-Fi and W5500 Ethernet on one ESP32 / ESP32-S3, with the order chosen at run
// time: Ethernet first, Wi-Fi first, Ethernet only or Wi-Fi only. The device switches when the
// connection in use drops, or when the broker can't be reached over it (a cable in, but no
// route out), and goes back to the preferred one when it recovers. The choice and the Wi-Fi
// network are kept in NVS, so they survive restarts and OTA updates.
//
// The serial menu below stands in for an HMI: a real panel calls the same functions
// (network.setPriority(), network.setWifi()) from its buttons and shows network.active().
// The platform can change the order too, with the command
//   set_network  {"priority": "wifi_first"}   (ethernet_first, wifi_first, ethernet_only, wifi_only)
// and sees the connection in use as the "net" attribute.
//
// Wiring of the W5500: see the EthernetW5500 example. On a board without a W5500 the same
// firmware runs on Wi-Fi alone.
#include <PerspiceClient.h>
#include <WiFiClientSecure.h>

#define FIRMWARE_VERSION "1.0.0"

WiFiClientSecure net;
PerspiceNetwork network;
PerspiceClient perspice(net);
unsigned long lastSend = 0;
String line;

void printStatus() {
  Serial.printf("priority: %s, in use: %s", PerspiceNetwork::priorityName(network.priority()),
                PerspiceNetwork::linkName(network.active()));
  if (network.isUp()) Serial.printf(" (%s)", network.localIP().toString().c_str());
  Serial.printf("\n  ethernet: %s%s\n", network.ethernetUp() ? "up" : "down",
                network.ethernetCable() ? "" : " (no cable or no W5500)");
  Serial.printf("  wifi: %s, network \"%s\"", network.wifiUp() ? "up" : "down", network.wifiSsid());
  if (network.wifiUp()) Serial.printf(", %d dBm", network.wifiRssi());
  Serial.printf("\n  broker: %s, %u message(s) waiting\n", perspice.isConnected() ? "connected" : "not connected",
                perspice.pending());
}

void printMenu() {
  Serial.println(
      "\n1  Ethernet first, Wi-Fi as backup\n"
      "2  Wi-Fi first, Ethernet as backup\n"
      "3  Ethernet only\n"
      "4  Wi-Fi only\n"
      "wifi <ssid> <password>   join another Wi-Fi network\n"
      "status                   show the connections\n"
      "forget                   forget the choices made here (after a restart)");
}

void onNetworkChange(PerspiceLink now, PerspiceLink before) {
  Serial.printf("network: %s -> %s\n", PerspiceNetwork::linkName(before), PerspiceNetwork::linkName(now));
}

// The "HMI": one line per command from the Serial Monitor (set it to send a newline).
void handleLine(String cmd) {
  cmd.trim();
  if (cmd == "1") network.setPriority(PerspicePriority::EthernetFirst);
  else if (cmd == "2") network.setPriority(PerspicePriority::WiFiFirst);
  else if (cmd == "3") network.setPriority(PerspicePriority::EthernetOnly);
  else if (cmd == "4") network.setPriority(PerspicePriority::WiFiOnly);
  else if (cmd == "status") {
    printStatus();
    return;
  } else if (cmd == "forget") {
    network.forgetSettings();
    Serial.println("forgotten: the compiled-in settings apply after a restart");
    return;
  } else if (cmd.startsWith("wifi ")) {
    String rest = cmd.substring(5);
    int space = rest.indexOf(' ');
    String ssid = space < 0 ? rest : rest.substring(0, space);
    String pass = space < 0 ? String() : rest.substring(space + 1);
    Serial.println(network.setWifi(ssid.c_str(), pass.c_str()) ? "joining" : "invalid network name or password (8-63 characters)");
    return;
  } else {
    printMenu();
    return;
  }
  Serial.printf("priority: %s\n", PerspiceNetwork::priorityName(network.priority()));
}

bool setNetwork(JsonVariantConst params, JsonDocument& result) {
  PerspicePriority p;
  if (!PerspiceNetwork::parsePriority(params["priority"] | "", p)) {
    result["error"] = "priority must be ethernet_first, wifi_first, ethernet_only or wifi_only";
    return false;
  }
  network.setPriority(p);
  result["priority"] = PerspiceNetwork::priorityName(p);
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(200);

  PerspiceNetworkConfig netCfg;
  netCfg.wifiSsid = "your-ssid";  // the first time only: one set from the menu wins afterwards
  netCfg.wifiPass = "your-password";
  netCfg.priority = PerspicePriority::EthernetFirst;  // likewise
  netCfg.hostname = "perspice-dual";
  // netCfg.keepStandby = false;  // start Wi-Fi only while Ethernet is down (saves ~100 mA)
  network.begin(netCfg);
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
  perspice.onCommand("set_network", setNetwork);

  printMenu();
  printStatus();
}

void loop() {
  perspice.loop();

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (line.length()) handleLine(line);
      line = "";
    } else if (line.length() < 120) {
      line += c;
    }
  }

  if (millis() - lastSend >= 30000) {
    lastSend = millis();
    JsonDocument values;
    values["uptime_s"] = millis() / 1000;
    values["on_ethernet"] = network.active() == PerspiceLink::Ethernet;
    if (network.wifiUp()) values["rssi"] = network.wifiRssi();
    perspice.sendTelemetry(values);
  }
}
