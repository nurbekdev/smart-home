# Deployment Guide

## 1. Netlify

Netlify reads `netlify.toml`:

| Setting | Value |
| --- | --- |
| Publish directory | `dashboard` |
| Functions directory | `netlify/functions` |
| Node version | `20` |

Add all variables from `.env.example` in Netlify. Do not upload `.env`.

## 2. Telegram

Set:

```text
TELEGRAM_WEBHOOK_URL=https://YOUR_SITE.netlify.app/.netlify/functions/telegram-webhook
```

Deploy, then open:

```text
https://YOUR_SITE.netlify.app/.netlify/functions/set-webhook
```

Check:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo
```

Expected:

| Field | Expected value |
| --- | --- |
| `url` | Your Netlify telegram webhook URL |
| `pending_update_count` | Low or `0` |
| `last_error_message` | Empty/missing |

## 3. MQTT Broker

For HiveMQ Cloud in Netlify:

```text
MQTT_URL=wss://YOUR_HOST.s1.eu.hivemq.cloud:8884/mqtt
MQTT_USER=...
MQTT_PASS=...
```

For ESP8266 firmware, use the same host without scheme/path:

```cpp
#define MQTT_HOST "YOUR_HOST.s1.eu.hivemq.cloud"
#define MQTT_PORT 8883
```

## 4. Status Ingest

If your broker can call HTTP webhooks, post status events to:

```text
https://YOUR_SITE.netlify.app/.netlify/functions/hivemq-ingest
```

Header:

```text
x-ingest-secret: <HIVEMQ_INGEST_SECRET or TELEGRAM_SECRET_TOKEN>
```

Topic:

```text
elshodlampa/device-1/status
elshodlampa/device-1/motion
```

Payload example:

```json
{
  "deviceId": "device-1",
  "online": true,
  "relay": "on",
  "ip": "192.168.1.10",
  "rssi": -55,
  "uptimeMs": 123456
}
```

## 5. Firmware Upload

Create ignored private credentials:

```cpp
// firmware/src/secrets.h
#define WIFI_SSID "your-wifi"
#define WIFI_PASS "your-password"
#define MQTT_HOST "YOUR_HOST.s1.eu.hivemq.cloud"
#define MQTT_PORT 8883
#define MQTT_USER "your-mqtt-user"
#define MQTT_PASS "your-mqtt-password"
#define NETLIFY_INGEST_HOST "smarthome4.netlify.app"
#define NETLIFY_INGEST_SECRET "same-as-HIVEMQ_INGEST_SECRET"
```

Upload:

```bash
cd firmware
pio run -t upload
pio device monitor
```

## 6. End-to-End Test

1. Send `/start` to the bot.
2. Send `/on`; ESP8266 should receive `{ "relay": "on" }` and turn the relay on.
3. Send `/off`; ESP8266 should turn the relay off.
4. Send `/status`; ESP8266 should publish status to `elshodlampa/device-1/status`.
5. Open the Netlify dashboard and confirm status/logs.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Bot does not respond | Confirm webhook secret, `ALLOWED_CHAT_ID`, and Netlify logs |
| Telegram retries same update | Function must return `200`; inspect logs for unhandled deployment/runtime errors |
| Pending updates grow | Run `set-webhook`; it drops old pending updates |
| MQTT connect fails in Netlify | Use WebSocket TLS URL: `wss://HOST:8884/mqtt` |
| MQTT connect fails on ESP8266 | Use raw host plus `MQTT_PORT 8883`; check Wi-Fi and credentials |
| ESP8266 offline | Watch serial monitor and confirm LWT/status topic in broker |
| Dashboard does not update | Wire broker HTTP webhook to `hivemq-ingest` or call `/status` to update command state |
| Motion alert does not arrive | Check PIR wiring on D5/GPIO14 and firmware `NETLIFY_INGEST_SECRET` |
