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

// 1 = yuklanganda D6 rele 3 marta "click" qiladi (sim / ACTIVE LOW tekshiruvi). Tekshiruvdan keyin 0 qiling.
#define RELAY_BOOT_TEST 0

// ====== USER CONFIG ======
// iPhone / macOS "Nurbek's iPhone" nomida apostrof ko'pincha UNICODE U+2019 (’) — UTF-8: E2 80 99.
// ASCII apostrof (0x27) bilan SSID BOSHQA — shuning uchun ESP ulanmaydi.
// 1 = iOS uslubi (tavsiya), 0 = oddiy ASCII '
#ifndef WIFI_SSID_USE_IOS_APOSTROPHE
#define WIFI_SSID_USE_IOS_APOSTROPHE 1
#endif

#if WIFI_SSID_USE_IOS_APOSTROPHE
static const char WIFI_SSID[] = "Nurbek" "\xE2\x80\x99" "s iPhone";  // ’  (17 bayt)
#else
static const char WIFI_SSID[] = "Nurbek" "\x27" "s iPhone";           // '  (15 bayt)
#endif

static const char WIFI_PASS[] = "password4nur123";

static void printSsidBytesOnce() {
  static bool done = false;
  if (done) return;
  done = true;
  Serial.print(F("SSID baytlar (HEX): "));
  for (size_t i = 0; i < strlen(WIFI_SSID); i++) {
    Serial.printf("%02X ", (unsigned char)WIFI_SSID[i]);
  }
  Serial.printf(" | uzunlik=%u bayt\n", (unsigned)strlen(WIFI_SSID));
  Serial.println(F("Kutilish: iOS ’ -> E2 80 99; ASCII ' -> 27 (bittasi bo'lishi kerak)"));
}

static const char* wlName(int s) {
  switch (s) {
    case WL_IDLE_STATUS:
      return "IDLE";
    case WL_NO_SSID_AVAIL:
      return "NO_SSID_AVAIL";
    case WL_SCAN_COMPLETED:
      return "SCAN_DONE";
    case WL_CONNECTED:
      return "CONNECTED";
    case WL_CONNECT_FAILED:
      return "CONNECT_FAILED";
    case WL_CONNECTION_LOST:
      return "CONNECTION_LOST";
    case WL_WRONG_PASSWORD:
      return "WRONG_PASSWORD";
    case WL_DISCONNECTED:
      return "DISCONNECTED";
    default:
      return "?";
  }
}

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
const char* TOPIC_SETTINGS = "home/mainroom/settings";

const unsigned long HEARTBEAT_INTERVAL_MS = 30000;
// Qayta ulanish: 3s juda tez — WiFi.begin takrorlanib assotsiatsiyani buzishi mumkin
const unsigned long WIFI_RETRY_MS = 12000;
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
unsigned long autoOffMs = 3UL * 60UL * 1000UL;  // 3 daqiqa, Telegram settings bilan o'zgaradi
unsigned long lightAutoOffAt = 0;                 // 0 = auto-off rejalashtirilmagan
unsigned long lastWifiDiagAt = 0;

static unsigned long s_bootMillis = 0;
static bool s_wifiScanDone = false;

/** 20 s ichida ulanmasa — tarmoqlarni skanerlab, SSID baytlarini chiqaradi (diagnostika). */
static void runWifiScanOnceIfStuck() {
  if (s_wifiScanDone || WiFi.status() == WL_CONNECTED) {
    if (WiFi.status() == WL_CONNECTED) s_wifiScanDone = true;
    return;
  }
  if (s_bootMillis == 0) s_bootMillis = millis();
  if (millis() - s_bootMillis < 20000) return;

  s_wifiScanDone = true;
  Serial.println(F("\n===== WiFi SCAN (ataylab SSID tekshiruvi) ====="));
  WiFi.mode(WIFI_STA);
  int n = WiFi.scanNetworks(false, true);
  if (n <= 0) {
    Serial.println(F("Hech narsa topilmadi: 2.4 GHz? Hotspot yoqilgan?"));
  } else {
    Serial.printf("Topildi: %d ta tarmoq\n", n);
    for (int i = 0; i < n; i++) {
      String ss = WiFi.SSID(i);
      Serial.printf(" [%2d] RSSI=%4d  ", i, WiFi.RSSI(i));
      Serial.print(ss);
      Serial.print(F("  HEX="));
      for (unsigned j = 0; j < ss.length() && j < 64; j++) {
        Serial.printf("%02X ", (unsigned char)ss[j]);
      }
      Serial.println();
    }
  }
  WiFi.scanDelete();
  Serial.println(F("Yuqoridagi HEX ni bootdagi \"SSID baytlar\" bilan solishtiring.\n"));
}

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
  // HTTPS ingest bu yerda emas: ikkinchi TLS + uzoq POST ESP8266 WiFi/MQTT ni uzadi
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
}

void publishHeartbeat() {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["online"] = true;
  doc["uptimeMs"] = millis();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["ts"] = nowIso();
  publishJson(TOPIC_HEARTBEAT, doc, false);
  // Faqat heartbeat: Netlify "Online" (kam HTTPS — barqarorlik)
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
  queueIngest(TOPIC_MOTION, doc);  // Netlify ga yuborish → Telegram notification
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
  yield();
  int code = http.POST(body);
  yield();
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

  // ESP8266 da MQTT (BearSSL) + HTTPS (BearSSL) bir vaqtda — xotira yetmaydi → HTTP -1.
  // MQTT ni vaqtincha yopamiz, HTTPS tugagach connectMqttNonBlocking qayta ulashtiradi.
  if (mqttClient.connected()) {
    mqttClient.disconnect();
    delay(50);
  }

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
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  static unsigned long s_lastBeginLog = 0;
  if (now - s_lastBeginLog > 30000) {
    s_lastBeginLog = now;
    Serial.printf("WiFi.begin (qayta urinish) SSID uzunligi=%u\n", (unsigned)strlen(WIFI_SSID));
  }
}

static void relayBootTest() {
#if RELAY_BOOT_TEST
  Serial.println(F("RELAY test: 3x ON/OFF (ACTIVE LOW: ON=LOW)"));
  for (int i = 0; i < 3; i++) {
    digitalWrite(RELAY_PIN, LOW);   // ON
    delay(350);
    digitalWrite(RELAY_PIN, HIGH);  // OFF
    delay(350);
  }
  digitalWrite(RELAY_PIN, HIGH);
  Serial.println(F("RELAY test tugadi"));
#endif
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
      Serial.println(F("MQTT RESTART buyrug'i — 2s kutib, reboot"));
      // Empty retained publish — MQTT standart usuli retained xabarni o'chiradi
      mqttClient.publish(TOPIC_RESTART, (const uint8_t*)"", 0, true);
      for (int i = 0; i < 20; i++) {
        mqttClient.loop();
        yield();
        delay(100);
      }
      ESP.restart();
    }
  } else if (t == TOPIC_ARM_STATE) {
    armed = doc["armed"] | armed;
    publishStatus(true);
  } else if (t == TOPIC_NIGHT_MODE_STATE) {
    nightModeOnly = doc["enabled"] | nightModeOnly;
    publishStatus(true);
  } else if (t == TOPIC_SETTINGS) {
    if (doc.containsKey("motionCooldownSeconds")) {
      motionCooldownMs = (unsigned long)(doc["motionCooldownSeconds"].as<int>()) * 1000UL;
    }
    if (doc.containsKey("autoOffMinutes")) {
      autoOffMs = (unsigned long)(doc["autoOffMinutes"].as<int>()) * 60UL * 1000UL;
    }
    Serial.printf("Settings yangilandi: cooldown=%lus autoOff=%lum\n",
                  motionCooldownMs / 1000, autoOffMs / 60000);
  }
}

void connectMqttNonBlocking() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected()) return;
  unsigned long now = millis();
  if (now - lastMqttAttemptAt < MQTT_RETRY_MS) return;
  lastMqttAttemptAt = now;

  String clientId = String(DEVICE_ID) + "-" + String(ESP.getChipId(), HEX);
  // cleanSession=true: har ulanishda yangi sessiya — broker QoS1 xabarlarini saqlamaydi.
  // Bu restart-loop muammosini hal qiladi (eski "restart:true" xabari qayta kelmaydi).
  // Retained xabarlar (light/set) esa saqlanadi — sessiyadan mustaqil.
  if (mqttClient.connect(
          clientId.c_str(),
          MQTT_USER,
          MQTT_PASS,
          TOPIC_STATUS,
          1,
          true,
          "{\"online\":false}",
          true)) {
    Serial.println(F("MQTT connected + subscribed"));
    // Empty retained → eski qolgan retained xabarlarni tozalaydi (boot loop oldini olish)
    mqttClient.publish(TOPIC_RESTART, (const uint8_t*)"", 0, true);
    mqttClient.loop();
    mqttClient.subscribe(TOPIC_RESTART, 0);
    mqttClient.subscribe(TOPIC_LIGHT_SET, 1);
    // light/set retained — Telegram dan oxirgi buyruq saqlanadi, bu yerda uni qabul qilamiz
    mqttClient.subscribe(TOPIC_ARM_STATE, 1);
    mqttClient.subscribe(TOPIC_NIGHT_MODE_STATE, 1);
    mqttClient.subscribe(TOPIC_SETTINGS, 1);
    mqttClient.loop();
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
      // Releni yoq va auto-off jadvali
      setRelay(true);
      publishLightState();
      lightAutoOffAt = now + autoOffMs;
      Serial.printf("Harakat! Chiroq yondi. Auto-OFF: %.0f s keyin\n", autoOffMs / 1000.0);
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
  delay(200);
  Serial.println();
  Serial.println(F("=== SmartHome ESP8266 boot ==="));
  printSsidBytesOnce();

  pinMode(PIR_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);  // ACTIVE LOW: boshlang'ich OFF
  lightOn = false;

  relayBootTest();
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
  runWifiScanOnceIfStuck();
  static bool wifiOkPrinted = false;
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiOkPrinted) {
      wifiOkPrinted = true;
      Serial.print(F("WiFi connected, IP: "));
      Serial.println(WiFi.localIP());
    }
  } else {
    wifiOkPrinted = false;
    unsigned long t = millis();
    if (t - lastWifiDiagAt > 15000) {
      lastWifiDiagAt = t;
      int st = (int)WiFi.status();
      Serial.printf("WiFi: %s (kod=%d). Kutiladi: %s (kod=%d)\n",
                    wlName(st), st, wlName(WL_CONNECTED), (int)WL_CONNECTED);
      Serial.printf("SSID=\"%s\"\n", WIFI_SSID);
      if (st == WL_WRONG_PASSWORD) {
        Serial.println(F("Parol noto'g'ri (WRONG_PASSWORD)."));
      }
      if (st == WL_NO_SSID_AVAIL) {
        Serial.println(F("SSID topilmadi (2.4 GHz, masofa, hotspot o'chiq?)."));
      }
      if (st == WL_DISCONNECTED) {
        Serial.println(F("DISCONNECTED: ulanish uzilgan yoki hali ulanmagan. iPhone: Maximize Compatibility yoqilgan bo'lsin."));
      }
    }
  }

  ArduinoOTA.handle();
  connectMqttNonBlocking();
  mqttClient.loop();
  flushIngestIfPending();
  mqttClient.loop();
  handlePirNonBlocking();

  unsigned long now = millis();

  // Auto-off: harakat bo'lmasa belgilangan vaqtda chiroqni o'chir
  if (lightOn && lightAutoOffAt > 0 && now >= lightAutoOffAt) {
    lightAutoOffAt = 0;
    setRelay(false);
    Serial.println(F("Auto-OFF: harakat yo'q, chiroq o'chdi"));
    if (mqttClient.connected()) publishLightState();
  }
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
