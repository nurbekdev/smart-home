# Smart Home

ESP8266 lamp control through Telegram, Netlify Functions, and MQTT. The bot is production-oriented for serverless hosting: Telegram uses webhook delivery only, and Netlify opens an MQTT connection only for the duration of each command publish.

## Architecture

```text
Telegram -> Netlify telegram-webhook -> MQTT command topic -> ESP8266
ESP8266  -> MQTT status topic -----------------------------> dashboard/status ingest
```

Netlify Functions are not always-on servers. This project does not use Telegram polling, `bot.launch()`, infinite loops, or persistent MQTT subscribers in Netlify.

## Environment Variables

Set these in Netlify Site configuration:

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather token |
| `TELEGRAM_SECRET_TOKEN` | Secret sent by Telegram in `X-Telegram-Bot-Api-Secret-Token` |
| `TELEGRAM_WEBHOOK_URL` | `https://YOUR_SITE.netlify.app/.netlify/functions/telegram-webhook` |
| `ALLOWED_CHAT_ID` | Only this Telegram chat can control the lamp |
| `MQTT_URL` | Broker URL, for HiveMQ Cloud usually `wss://HOST:8884/mqtt` |
| `MQTT_USER` | MQTT username |
| `MQTT_PASS` | MQTT password |
| `MQTT_COMMAND_TOPIC` | Defaults to `elshodlampa/device-1/cmd` |
| `MQTT_STATUS_TOPIC` | Defaults to `elshodlampa/device-1/status` |
| `MQTT_MOTION_TOPIC` | Defaults to `elshodlampa/device-1/motion` |

Optional:

| Variable | Purpose |
| --- | --- |
| `HIVEMQ_INGEST_SECRET` | Secret for `hivemq-ingest`; falls back to `TELEGRAM_SECRET_TOKEN` |
| `MQTT_CONNECT_TIMEOUT_MS` | MQTT connect timeout for functions |
| `MQTT_PUBLISH_TIMEOUT_MS` | MQTT publish timeout for functions |

Never commit `.env`. It is ignored by `.gitignore`.

## Telegram Webhook

After deploying to Netlify, open:

```text
https://YOUR_SITE.netlify.app/.netlify/functions/set-webhook
```

That function calls Telegram `setWebhook` with:

| Option | Value |
| --- | --- |
| `url` | `TELEGRAM_WEBHOOK_URL` |
| `secret_token` | `TELEGRAM_SECRET_TOKEN` |
| `drop_pending_updates` | `true` |
| `allowed_updates` | `["message","callback_query"]` |

Verify with Telegram:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo
```

`last_error_message` should be empty after a successful deployment.

## Bot Commands

| Command | MQTT payload |
| --- | --- |
| `/start` | Sends help and buttons |
| `/help` | Sends help and buttons |
| `/on` | `{ "relay": "on", "source": "telegram", "time": Date.now() }` |
| `/off` | `{ "relay": "off", "source": "telegram", "time": Date.now() }` |
| `/status` | `{ "action": "status", "source": "telegram", "time": Date.now() }` |

Unknown commands receive a clear help message. Chats other than `ALLOWED_CHAT_ID` receive `Sizga ruxsat berilmagan.`

## MQTT Topics

| Topic | Direction | Payload |
| --- | --- | --- |
| `elshodlampa/device-1/cmd` | Netlify -> ESP8266 | Command JSON from Telegram |
| `elshodlampa/device-1/status` | ESP8266 -> broker/Netlify | Retained status JSON |
| `elshodlampa/device-1/motion` | ESP8266 -> broker/Netlify | Motion event JSON |

The ESP8266 also publishes LWT offline status to `elshodlampa/device-1/status`.

## ESP8266 Firmware

Install PlatformIO dependencies from `firmware/platformio.ini`, then create a private file:

```cpp
// firmware/src/secrets.h
#define WIFI_SSID "your-wifi"
#define WIFI_PASS "your-password"
#define MQTT_HOST "your-hivemq-host.s1.eu.hivemq.cloud"
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

Default relay pin is NodeMCU `D6` (`GPIO12`) and active-low. Change `RELAY_PIN` or `RELAY_ACTIVE_LOW` in `firmware/src/main.cpp` only if your hardware is wired differently.

## Dashboard

The static dashboard calls only `/api/status`. It does not contain Telegram tokens, MQTT passwords, or broker credentials. Status is based on Netlify Blobs state updated by Telegram commands and by `hivemq-ingest` when you connect broker status events to it.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Bot does not answer | Run `getWebhookInfo`, confirm `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_SECRET_TOKEN`, and Netlify function logs |
| Pending updates grow | Run `set-webhook` again; it uses `drop_pending_updates=true` |
| MQTT publish fails | Check `MQTT_URL` format, username/password, HiveMQ access rules, and TLS/WebSocket port |
| ESP8266 offline | Check serial monitor, Wi-Fi is 2.4 GHz, MQTT host/port, and retained status topic |
| `/status` is stale | Confirm ESP publishes `elshodlampa/device-1/status` and broker HTTP integration posts to `hivemq-ingest` |
| Motion notification does not arrive | Confirm PIR is on D5/GPIO14 and `NETLIFY_INGEST_SECRET` in firmware matches Netlify ingest secret |
| Netlify function error | Check env vars in `/api/status`; it reports booleans only, never secret values |
