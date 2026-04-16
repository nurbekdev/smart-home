#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP8266WiFi.h>
#include <ArduinoOTA.h>
#include <ESP8266HTTPClient.h>
#include <PubSubClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <time.h>

#define PIR_PIN 14    // D5
#define RELAY_PIN 12  // D6

// ====== USER CONFIG ======
const char* WIFI_SSID = "Nurbek’s iPhone";
const char* WIFI_PASS = "password4nur123";

const char* MQTT_HOST = "960fe8fe25f14254961d65b12f1eacf0.s1.eu.hivemq.cloud";
const int MQTT_PORT = 8883;
const char* MQTT_USER = "nurbek42";
const char* MQTT_PASS = "Polatov2004";
const char* DEVICE_ID = "1";

const char* OTA_USER = "admin";
const char* OTA_PASS = "change_me";

// Netlify hivemq-ingest (HiveMQ Cloud Free odatda HTTP webhook yo'q) — dashboard "Online" uchun:
// Netlify env dagi HIVEMQ_INGEST_SECRET bilan bir xil qiymatni yozing. Bo'sh qoldiring = o'chirilgan.
const char* NETLIFY_INGEST_HOST = "smarthome4.netlify.app";
const char* NETLIFY_INGEST_PATH = "/.netlify/functions/hivemq-ingest";
const char* HIVEMQ_INGEST_SECRET_FOR_DEVICE = "super-secret-ingest-token";

const char* TOPIC_MOTION = "home/mainroom/motion";
const char* TOPIC_LIGHT_SET = "home/mainroom/light/set";
const char* TOPIC_LIGHT_STATE = "home/mainroom/light/state";
const char* TOPIC_STATUS = "home/mainroom/status";
const char* TOPIC_HEARTBEAT = "home/mainroom/heartbeat";
const char* TOPIC_RESTART = "home/mainroom/restart";
const char* TOPIC_ARM_STATE = "home/mainroom/arm/state";
const char* TOPIC_NIGHT_MODE_STATE = "home/mainroom/night_mode/state";

const unsigned long HEARTBEAT_INTERVAL_MS = 30000;
const unsigned long WIFI_RETRY_MS = 3000;
const unsigned long MQTT_RETRY_MS = 2000;
const unsigned long PIR_SAMPLE_MS = 80;

// ====== STATE ======
BearSSL::WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

bool lightOn = false;
bool armed = true;
bool nightModeOnly = false;
bool pirStable = false;
bool pirLastRead = false;
unsigned long pirChangedAt = 0;
unsigned long lastHeartbeatAt = 0;
unsigned long lastWifiAttemptAt = 0;
unsigned long lastMqttAttemptAt = 0;
unsigned long lastPirSampleAt = 0;
unsigned long lastMotionPublishedAt = 0;
unsigned long motionCooldownMs = 15000;

void queueIngest(const char* topic, JsonDocument& payloadDoc);
void flushIngestIfPending();

void setRelay(bool on) {
  lightOn = on;
  digitalWrite(RELAY_PIN, on ? LOW : HIGH);  // ACTIVE LOW relay
}

String nowIso() {
  time_t t = time(nullptr);
  struct tm* tmInfo = gmtime(&t);
  if (!tmInfo) return "";
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", tmInfo);
  return String(buf);
}

void publishJson(const char* topic, JsonDocument& doc, bool retained = false) {
  char out[256];
  size_t n = serializeJson(doc, out, sizeof(out));
  mqttClient.publish(topic, reinterpret_cast<const uint8_t*>(out), n, retained);
}

void publishLightState() {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["on"] = lightOn;
  doc["ts"] = nowIso();
  publishJson(TOPIC_LIGHT_STATE, doc, true);
  queueIngest(TOPIC_LIGHT_STATE, doc);
}

void publishStatus(bool online) {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["online"] = online;
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["armed"] = armed;
  doc["nightModeOnly"] = nightModeOnly;
  doc["motionCooldownMs"] = motionCooldownMs;
  doc["uptimeMs"] = millis();
  doc["ts"] = nowIso();
  publishJson(TOPIC_STATUS, doc, true);
  queueIngest(TOPIC_STATUS, doc);
}

void publishHeartbeat() {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["online"] = true;
  doc["uptimeMs"] = millis();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["ts"] = nowIso();
  publishJson(TOPIC_HEARTBEAT, doc, false);
  queueIngest(TOPIC_HEARTBEAT, doc);
}

void publishMotion() {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["motion"] = true;
  doc["armed"] = armed;
  doc["nightModeOnly"] = nightModeOnly;
  doc["ts"] = nowIso();
  publishJson(TOPIC_MOTION, doc, false);
  queueIngest(TOPIC_MOTION, doc);
}

// HTTPS ingest MQTT callback ichida chaqirilmasin — uzoq bloklovchi TLS MQTT ni uzadi.
static char s_ingestTopic[72];
static char s_ingestPayload[360];
static volatile bool s_ingestPending = false;

void queueIngest(const char* topic, JsonDocument& payloadDoc) {
  if (strlen(HIVEMQ_INGEST_SECRET_FOR_DEVICE) == 0) return;
  strncpy(s_ingestTopic, topic, sizeof(s_ingestTopic) - 1);
  s_ingestTopic[sizeof(s_ingestTopic) - 1] = '\0';
  size_t n = serializeJson(payloadDoc, s_ingestPayload, sizeof(s_ingestPayload) - 1);
  s_ingestPayload[sizeof(s_ingestPayload) - 1] = '\0';
  if (n == 0 || n >= sizeof(s_ingestPayload) - 1) {
    Serial.println(F("queueIngest: payload too large"));
    return;
  }
  s_ingestPending = true;
}

static void sendIngestEnvelope(const char* topic, JsonDocument& innerDoc) {
  JsonDocument envelope;
  envelope["topic"] = topic;
  envelope["payload"] = innerDoc.as<JsonObject>();
  String body;
  serializeJson(envelope, body);

  BearSSL::WiFiClientSecure httpClient;
  httpClient.setInsecure();
  HTTPClient http;
  http.setTimeout(5000);
  String url = String("https://") + NETLIFY_INGEST_HOST + NETLIFY_INGEST_PATH;
  if (!http.begin(httpClient, url)) {
    Serial.println(F("ingest: http.begin failed"));
    return;
  }
  http.addHeader(F("Content-Type"), F("application/json"));
  http.addHeader(F("x-ingest-secret"), HIVEMQ_INGEST_SECRET_FOR_DEVICE);
  int code = http.POST(body);
  Serial.printf("ingest HTTP %d topic=%s\n", code, topic);
  http.end();
}

void flushIngestIfPending() {
  if (!s_ingestPending || WiFi.status() != WL_CONNECTED) return;

  char topicCopy[72];
  char payloadCopy[360];
  strncpy(topicCopy, s_ingestTopic, sizeof(topicCopy) - 1);
  topicCopy[sizeof(topicCopy) - 1] = '\0';
  strncpy(payloadCopy, s_ingestPayload, sizeof(payloadCopy) - 1);
  payloadCopy[sizeof(payloadCopy) - 1] = '\0';
  s_ingestPending = false;

  JsonDocument innerDoc;
  DeserializationError err = deserializeJson(innerDoc, payloadCopy);
  if (err) {
    Serial.println(F("flushIngest: JSON error"));
    return;
  }
  sendIngestEnvelope(topicCopy, innerDoc);
}

void connectWifiNonBlocking() {
  if (WiFi.status() == WL_CONNECTED) return;
  unsigned long now = millis();
  if (now - lastWifiAttemptAt < WIFI_RETRY_MS) return;
  lastWifiAttemptAt = now;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void mqttCallback(char* topic, byte* payload, unsigned int len) {
  String t(topic);
  String s;
  s.reserve(len + 1);
  for (unsigned int i = 0; i < len; i++) s += (char)payload[i];

  Serial.printf("MQTT RX [%s] %s\n", t.c_str(), s.c_str());

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, s);
  if (err) {
    Serial.println(F("MQTT JSON parse failed"));
    return;
  }

  if (t == TOPIC_LIGHT_SET) {
    bool on = doc["on"] | false;
    Serial.printf("Light SET -> %s\n", on ? "ON" : "OFF");
    setRelay(on);
    publishLightState();
  } else if (t == TOPIC_RESTART) {
    bool restart = doc["restart"] | false;
    if (restart) {
      delay(300);
      ESP.restart();
    }
  } else if (t == TOPIC_ARM_STATE) {
    armed = doc["armed"] | armed;
    publishStatus(true);
  } else if (t == TOPIC_NIGHT_MODE_STATE) {
    nightModeOnly = doc["enabled"] | nightModeOnly;
    publishStatus(true);
  }
}

void connectMqttNonBlocking() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected()) return;
  unsigned long now = millis();
  if (now - lastMqttAttemptAt < MQTT_RETRY_MS) return;
  lastMqttAttemptAt = now;

  String clientId = String(DEVICE_ID) + "-" + String(ESP.getChipId(), HEX);
  // cleanSession=false: qisqa vaqt offline bo'lsa ham QoS1 buyruqlar brokerda saqlanadi
  if (mqttClient.connect(
          clientId.c_str(),
          MQTT_USER,
          MQTT_PASS,
          TOPIC_STATUS,
          1,
          true,
          "{\"online\":false}",
          false)) {
    Serial.println(F("MQTT connected + subscribed"));
    mqttClient.subscribe(TOPIC_LIGHT_SET, 1);
    mqttClient.subscribe(TOPIC_RESTART, 1);
    mqttClient.subscribe(TOPIC_ARM_STATE, 1);
    mqttClient.subscribe(TOPIC_NIGHT_MODE_STATE, 1);
    publishStatus(true);
    publishLightState();
  } else {
    Serial.printf("MQTT connect FAILED state=%d\n", mqttClient.state());
  }
}

bool isNightTimeLocal() {
  time_t t = time(nullptr);
  struct tm* localTm = localtime(&t);
  if (!localTm) return false;
  int h = localTm->tm_hour;
  return (h >= 20 || h < 6);
}

void handlePirNonBlocking() {
  unsigned long now = millis();
  if (now - lastPirSampleAt < PIR_SAMPLE_MS) return;
  lastPirSampleAt = now;

  bool raw = digitalRead(PIR_PIN) == HIGH;
  if (raw != pirLastRead) {
    pirLastRead = raw;
    pirChangedAt = now;
  }

  const bool stableNow = (now - pirChangedAt) > 150 ? raw : pirStable;
  if (stableNow != pirStable) {
    pirStable = stableNow;
    if (pirStable) {
      if (now - lastMotionPublishedAt < motionCooldownMs) return;
      if (nightModeOnly && !isNightTimeLocal()) return;
      lastMotionPublishedAt = now;
      if (mqttClient.connected()) publishMotion();
    }
  }
}

void setupOta() {
  ArduinoOTA.setHostname(DEVICE_ID);
  ArduinoOTA.setPassword(OTA_PASS);
  ArduinoOTA.onStart([]() { Serial.println("OTA start"); });
  ArduinoOTA.onEnd([]() { Serial.println("OTA end"); });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("OTA error: %u\n", error);
  });
  ArduinoOTA.begin();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);

  secureClient.setInsecure();  // For production: pin CA cert instead.
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);
  mqttClient.setKeepAlive(60);
  mqttClient.setSocketTimeout(20);

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  setupOta();
}

void loop() {
  connectWifiNonBlocking();
  static bool wifiOkPrinted = false;
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiOkPrinted) {
      wifiOkPrinted = true;
      Serial.print(F("WiFi connected, IP: "));
      Serial.println(WiFi.localIP());
    }
  } else {
    wifiOkPrinted = false;
  }

  ArduinoOTA.handle();
  connectMqttNonBlocking();
  mqttClient.loop();
  flushIngestIfPending();
  mqttClient.loop();
  handlePirNonBlocking();

  unsigned long now = millis();
  if (mqttClient.connected() && now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    publishHeartbeat();
  }

  static wl_status_t lastWifi = WL_IDLE_STATUS;
  wl_status_t curr = WiFi.status();
  if (lastWifi == WL_CONNECTED && curr != WL_CONNECTED && mqttClient.connected()) {
    publishStatus(false);
  }
  lastWifi = curr;
}
