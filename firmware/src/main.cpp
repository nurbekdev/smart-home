#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <WiFiClientSecureBearSSL.h>

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef WIFI_SSID
#define WIFI_SSID "YOUR_WIFI_SSID"
#endif

#ifndef WIFI_PASS
#define WIFI_PASS "YOUR_WIFI_PASSWORD"
#endif

#ifndef MQTT_HOST
#define MQTT_HOST "YOUR_CLUSTER.s1.eu.hivemq.cloud"
#endif

#ifndef MQTT_PORT
#define MQTT_PORT 8883
#endif

#ifndef MQTT_USER
#define MQTT_USER "YOUR_MQTT_USER"
#endif

#ifndef MQTT_PASS
#define MQTT_PASS "YOUR_MQTT_PASSWORD"
#endif

#ifndef DEVICE_ID
#define DEVICE_ID "device-1"
#endif

#ifndef MQTT_COMMAND_TOPIC
#define MQTT_COMMAND_TOPIC "elshodlampa/device-1/cmd"
#endif

#ifndef MQTT_STATUS_TOPIC
#define MQTT_STATUS_TOPIC "elshodlampa/device-1/status"
#endif

// NodeMCU D6. Change this only if your relay is wired to another pin.
static const uint8_t RELAY_PIN = 12;
static const bool RELAY_ACTIVE_LOW = true;

static const unsigned long WIFI_RETRY_MS = 10000;
static const unsigned long MQTT_RETRY_MS = 5000;
static const unsigned long STATUS_INTERVAL_MS = 30000;

BearSSL::WiFiClientSecure wifiSecure;
PubSubClient mqttClient(wifiSecure);

bool relayOn = false;
unsigned long lastWifiAttemptAt = 0;
unsigned long lastMqttAttemptAt = 0;
unsigned long lastStatusAt = 0;

void setRelay(bool on) {
  relayOn = on;
  const uint8_t active = RELAY_ACTIVE_LOW ? LOW : HIGH;
  const uint8_t inactive = RELAY_ACTIVE_LOW ? HIGH : LOW;
  digitalWrite(RELAY_PIN, on ? active : inactive);
}

void publishStatus(bool online) {
  if (!mqttClient.connected()) return;

  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["online"] = online;
  doc["relay"] = relayOn ? "on" : "off";
  doc["lightOn"] = relayOn;
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["uptimeMs"] = millis();
  doc["firmware"] = "elshodlampa-1.0.0";

  char payload[256];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  mqttClient.publish(MQTT_STATUS_TOPIC, reinterpret_cast<const uint8_t*>(payload), length, true);
}

void handleCommand(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, MQTT_COMMAND_TOPIC) != 0) return;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.print(F("Invalid JSON command: "));
    Serial.println(err.c_str());
    return;
  }

  const char* relay = doc["relay"] | "";
  const char* action = doc["action"] | "";

  if (strcmp(relay, "on") == 0) {
    setRelay(true);
    Serial.println(F("Relay ON"));
    publishStatus(true);
    return;
  }

  if (strcmp(relay, "off") == 0) {
    setRelay(false);
    Serial.println(F("Relay OFF"));
    publishStatus(true);
    return;
  }

  if (strcmp(action, "status") == 0) {
    Serial.println(F("Status requested"));
    publishStatus(true);
    return;
  }

  Serial.println(F("Unknown command"));
}

void connectWifiNonBlocking() {
  if (WiFi.status() == WL_CONNECTED) return;

  const unsigned long now = millis();
  if (now - lastWifiAttemptAt < WIFI_RETRY_MS) return;
  lastWifiAttemptAt = now;

  Serial.println(F("Connecting WiFi..."));
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void connectMqttNonBlocking() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected()) return;

  const unsigned long now = millis();
  if (now - lastMqttAttemptAt < MQTT_RETRY_MS) return;
  lastMqttAttemptAt = now;

  String clientId = String("elshodlampa-") + DEVICE_ID + "-" + String(ESP.getChipId(), HEX);
  Serial.println(F("Connecting MQTT..."));

  if (mqttClient.connect(
        clientId.c_str(),
        MQTT_USER,
        MQTT_PASS,
        MQTT_STATUS_TOPIC,
        1,
        true,
        "{\"online\":false}",
        true)) {
    Serial.println(F("MQTT connected"));
    mqttClient.subscribe(MQTT_COMMAND_TOPIC, 1);
    publishStatus(true);
  } else {
    Serial.print(F("MQTT failed, state="));
    Serial.println(mqttClient.state());
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println(F("Elshodlampa ESP8266 boot"));

  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);

  wifiSecure.setInsecure();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(handleCommand);
  mqttClient.setBufferSize(512);
  mqttClient.setKeepAlive(30);
  mqttClient.setSocketTimeout(8);

  connectWifiNonBlocking();
}

void loop() {
  connectWifiNonBlocking();

  if (WiFi.status() == WL_CONNECTED) {
    connectMqttNonBlocking();
  }

  mqttClient.loop();

  const unsigned long now = millis();
  if (mqttClient.connected() && now - lastStatusAt >= STATUS_INTERVAL_MS) {
    lastStatusAt = now;
    publishStatus(true);
  }
}
