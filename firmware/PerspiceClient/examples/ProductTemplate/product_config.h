// Product settings for the ProductTemplate example. Everything a product changes per build lives
// here; keep secrets (the provisioning key) out of public repositories.
#pragma once

#define FIRMWARE_VERSION "1.0.0"  // raise for every OTA release; reported as the "fw" attribute

// The platform. Units fetch their own device id and token on first boot with the provisioning key
// (Device profiles → Provisioning) and keep them in NVS.
#define PLATFORM_API_HOST "iot.example.com"
#define PLATFORM_PROVISION_KEY "pps_YOUR_PROVISIONING_KEY"
#define MQTT_PORT 8883  // TLS

// Network defaults for the first boot. A choice made on the HMI (or by the set_network command)
// is kept in NVS and wins afterwards.
#define DEFAULT_WIFI_SSID ""  // "" = no Wi-Fi until one is set from the HMI
#define DEFAULT_WIFI_PASS ""
#define DEFAULT_NETWORK_PRIORITY PerspicePriority::EthernetFirst
#define HAS_W5500 true
// W5500 pins: the PerspiceNetworkConfig defaults suit an ESP32 devkit (SCK 18, MISO 19, MOSI 23,
// CS 5, INT 4) and the Waveshare ESP32-S3-ETH (13, 12, 11, CS 14, INT 10, RST 9). Override in
// commsTask() for your board.

#define TELEMETRY_INTERVAL_MS 30000
#define FACTORY_RESET_PIN 0  // BOOT button: hold 5 s to forget credentials and network settings
#define OUTPUT_PIN 2         // driven by the set_output command (an on-board LED on most devkits)
