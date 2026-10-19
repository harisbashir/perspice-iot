// BasicSensor — sends a temperature reading every 10 seconds over wired Ethernet with the
// Arduino Ethernet library, on AVR boards such as the Mega with an Ethernet shield. On an ESP32,
// use the EthernetW5500 example instead: its W5500 driver adds TLS, provisioning and OTA.
// Fill in the device id and token from the device's Credentials tab.
#include <Ethernet.h>
#include <PerspiceClient.h>
#include <SPI.h>

byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0x12, 0x34};
EthernetClient net;
PerspiceClient perspice(net);

const unsigned long INTERVAL_MS = 10000;
unsigned long lastSend = 0;

void setup() {
  Serial.begin(115200);
  Ethernet.init(5);  // W5500 chip-select pin; use 10 for most AVR shields
  if (Ethernet.begin(mac) == 0) Serial.println(F("DHCP failed"));

  PerspiceConfig cfg;
  cfg.host = "mqtt.iot.example.com";
  cfg.port = 1883;  // plain MQTT; AVR boards have no TLS
  cfg.deviceId = "YOUR-DEVICE-ID";
  cfg.token = "pdt_YOUR_DEVICE_TOKEN";
  cfg.bufferCapacity = 8;
  perspice.begin(cfg);
}

void loop() {
  Ethernet.maintain();
  perspice.loop();
  if (millis() - lastSend >= INTERVAL_MS) {
    lastSend = millis();
    JsonDocument values;
    values["temperature"] = 20.0 + analogRead(A0) / 100.0;  // replace with a real sensor
    perspice.sendTelemetry(values);
  }
}
