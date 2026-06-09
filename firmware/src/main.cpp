#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP8266HTTPClient.h>
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

#ifndef MQTT_MOTION_TOPIC
#define MQTT_MOTION_TOPIC "elshodlampa/device-1/motion"
#endif

#ifndef NETLIFY_INGEST_HOST
#define NETLIFY_INGEST_HOST ""
#endif

#ifndef NETLIFY_INGEST_PATH
#define NETLIFY_INGEST_PATH "/.netlify/functions/hivemq-ingest"
#endif

#ifndef NETLIFY_INGEST_SECRET
#define NETLIFY_INGEST_SECRET ""
#endif

#ifndef PIR_PIN
#define PIR_PIN 14
#endif

#ifndef RELAY_PIN
#define RELAY_PIN 12
#endif

#ifndef RELAY_ACTIVE_LOW
#define RELAY_ACTIVE_LOW 1
#endif

#ifndef MOTION_TURNS_RELAY_ON
#define MOTION_TURNS_RELAY_ON 1
#endif

#ifndef MOTION_AUTO_OFF_MS
#define MOTION_AUTO_OFF_MS 120000
#endif

// Defaults: PIR on NodeMCU D5/GPIO14, relay on D6/GPIO12.
static const uint8_t PIR_PIN_NUMBER = PIR_PIN;
static const uint8_t RELAY_PIN_NUMBER = RELAY_PIN;
static const bool RELAY_IS_ACTIVE_LOW = RELAY_ACTIVE_LOW == 1;
static const bool MOTION_RELAY_ENABLED = MOTION_TURNS_RELAY_ON == 1;

static const unsigned long WIFI_RETRY_MS = 10000;
static const unsigned long MQTT_RETRY_MS = 5000;
static const unsigned long STATUS_INTERVAL_MS = 30000;
static const unsigned long PIR_SAMPLE_MS = 80;
static const unsigned long PIR_DEBOUNCE_MS = 200;
static const unsigned long MOTION_COOLDOWN_MS = 30000;

BearSSL::WiFiClientSecure wifiSecure;
PubSubClient mqttClient(wifiSecure);

bool relayOn = false;
unsigned long lastWifiAttemptAt = 0;
unsigned long lastMqttAttemptAt = 0;
unsigned long lastStatusAt = 0;
unsigned long lastPirSampleAt = 0;
unsigned long pirChangedAt = 0;
unsigned long lastMotionAt = 0;
unsigned long relayAutoOffAt = 0;
bool pirLastRead = false;
bool pirStable = false;
bool ingestPending = false;
char ingestTopic[72];
char ingestPayload[256];

void setRelay(bool on) {
  relayOn = on;
  const uint8_t active = RELAY_IS_ACTIVE_LOW ? LOW : HIGH;
  const uint8_t inactive = RELAY_IS_ACTIVE_LOW ? HIGH : LOW;
  digitalWrite(RELAY_PIN_NUMBER, on ? active : inactive);
  Serial.printf("Relay GPIO%d -> %s (pin level=%s)\n",
                RELAY_PIN_NUMBER,
                on ? "ON" : "OFF",
                (on ? active : inactive) == HIGH ? "HIGH" : "LOW");
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
  doc["firmware"] = "smart-home-1.1.0";
  doc["relayPin"] = RELAY_PIN_NUMBER;
  doc["relayActiveLow"] = RELAY_IS_ACTIVE_LOW;
  doc["motionRelayEnabled"] = MOTION_RELAY_ENABLED;

  char payload[256];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  mqttClient.publish(MQTT_STATUS_TOPIC, reinterpret_cast<const uint8_t*>(payload), length, true);
}

void publishMotion() {
  if (!mqttClient.connected()) return;

  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["motion"] = true;
  doc["relay"] = relayOn ? "on" : "off";
  doc["relayTriggered"] = MOTION_RELAY_ENABLED;
  doc["rssi"] = WiFi.RSSI();
  doc["uptimeMs"] = millis();

  char payload[256];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  mqttClient.publish(MQTT_MOTION_TOPIC, reinterpret_cast<const uint8_t*>(payload), length, false);

  strncpy(ingestTopic, MQTT_MOTION_TOPIC, sizeof(ingestTopic) - 1);
  ingestTopic[sizeof(ingestTopic) - 1] = '\0';
  strncpy(ingestPayload, payload, sizeof(ingestPayload) - 1);
  ingestPayload[sizeof(ingestPayload) - 1] = '\0';
  ingestPending = true;

  Serial.println(F("Motion published"));
}

void clearRetainedCommand() {
  if (!mqttClient.connected()) return;
  mqttClient.publish(MQTT_COMMAND_TOPIC, reinterpret_cast<const uint8_t*>(""), 0, true);
}

void flushIngestIfPending() {
  if (!ingestPending || WiFi.status() != WL_CONNECTED) return;
  if (strlen(NETLIFY_INGEST_HOST) == 0 || strlen(NETLIFY_INGEST_SECRET) == 0) {
    ingestPending = false;
    return;
  }

  char topicCopy[sizeof(ingestTopic)];
  char payloadCopy[sizeof(ingestPayload)];
  strncpy(topicCopy, ingestTopic, sizeof(topicCopy) - 1);
  topicCopy[sizeof(topicCopy) - 1] = '\0';
  strncpy(payloadCopy, ingestPayload, sizeof(payloadCopy) - 1);
  payloadCopy[sizeof(payloadCopy) - 1] = '\0';
  ingestPending = false;

  if (mqttClient.connected()) {
    mqttClient.disconnect();
    delay(30);
  }

  JsonDocument payloadDoc;
  if (deserializeJson(payloadDoc, payloadCopy)) return;

  JsonDocument envelope;
  envelope["topic"] = topicCopy;
  envelope["payload"] = payloadDoc.as<JsonObject>();

  String body;
  serializeJson(envelope, body);

  BearSSL::WiFiClientSecure httpClient;
  httpClient.setInsecure();
  HTTPClient http;
  http.setTimeout(5000);
  const String url = String("https://") + NETLIFY_INGEST_HOST + NETLIFY_INGEST_PATH;

  if (!http.begin(httpClient, url)) {
    Serial.println(F("Ingest begin failed"));
    return;
  }

  http.addHeader(F("Content-Type"), F("application/json"));
  http.addHeader(F("x-ingest-secret"), NETLIFY_INGEST_SECRET);
  const int code = http.POST(body);
  Serial.printf("Motion ingest HTTP %d\n", code);
  http.end();
}

void handleCommand(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, MQTT_COMMAND_TOPIC) != 0) return;
  if (length == 0) return;

  Serial.printf("MQTT command [%s] len=%u: ", topic, length);
  for (unsigned int i = 0; i < length; i++) Serial.print((char)payload[i]);
  Serial.println();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.print(F("Invalid JSON command: "));
    Serial.println(err.c_str());
    return;
  }

  const char* relay = doc["relay"] | "";
  const char* state = doc["state"] | "";
  const char* power = doc["power"] | "";
  const char* action = doc["action"] | "";
  const bool boolOn = doc["on"] | false;
  const bool hasOn = doc["on"].is<bool>();
  const bool lightOn = doc["lightOn"] | false;
  const bool hasLightOn = doc["lightOn"].is<bool>();

  if (strcmp(relay, "on") == 0 || strcmp(state, "on") == 0 || strcmp(power, "on") == 0 ||
      (hasOn && boolOn) || (hasLightOn && lightOn)) {
    setRelay(true);
    clearRetainedCommand();
    publishStatus(true);
    return;
  }

  if (strcmp(relay, "off") == 0 || strcmp(state, "off") == 0 || strcmp(power, "off") == 0 ||
      (hasOn && !boolOn) || (hasLightOn && !lightOn)) {
    setRelay(false);
    clearRetainedCommand();
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

  String clientId = String("smart-home-") + DEVICE_ID + "-" + String(ESP.getChipId(), HEX);
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

void handleMotionNonBlocking() {
  const unsigned long now = millis();
  if (now - lastPirSampleAt < PIR_SAMPLE_MS) return;
  lastPirSampleAt = now;

  const bool raw = digitalRead(PIR_PIN_NUMBER) == HIGH;
  if (raw != pirLastRead) {
    pirLastRead = raw;
    pirChangedAt = now;
  }

  if (now - pirChangedAt < PIR_DEBOUNCE_MS || raw == pirStable) return;
  pirStable = raw;

  if (!pirStable || now - lastMotionAt < MOTION_COOLDOWN_MS) return;
  lastMotionAt = now;

  Serial.println(F("Motion detected"));
  if (MOTION_RELAY_ENABLED) {
    setRelay(true);
    relayAutoOffAt = now + MOTION_AUTO_OFF_MS;
    Serial.printf("Motion relay ON; auto-off in %lu ms\n", (unsigned long)MOTION_AUTO_OFF_MS);
  }

  if (mqttClient.connected()) {
    publishMotion();
    publishStatus(true);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println(F("Smart Home ESP8266 boot"));
  Serial.printf("Relay config: GPIO%d activeLow=%s\n",
                RELAY_PIN_NUMBER,
                RELAY_IS_ACTIVE_LOW ? "true" : "false");
  Serial.printf("Motion relay: enabled=%s autoOffMs=%lu PIR GPIO%d\n",
                MOTION_RELAY_ENABLED ? "true" : "false",
                (unsigned long)MOTION_AUTO_OFF_MS,
                PIR_PIN_NUMBER);

  pinMode(RELAY_PIN_NUMBER, OUTPUT);
  pinMode(PIR_PIN_NUMBER, INPUT);
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
  handleMotionNonBlocking();
  flushIngestIfPending();

  const unsigned long now = millis();
  if (relayOn && relayAutoOffAt > 0 && now >= relayAutoOffAt) {
    relayAutoOffAt = 0;
    setRelay(false);
    Serial.println(F("Motion auto-off"));
    if (mqttClient.connected()) publishStatus(true);
  }

  if (mqttClient.connected() && now - lastStatusAt >= STATUS_INTERVAL_MS) {
    lastStatusAt = now;
    publishStatus(true);
  }
}
