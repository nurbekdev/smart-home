# Smart Motion Security + Smart Light (Serverless)

Production-grade, VPS-free IoT system using:

- ESP8266 NodeMCU + PIR + active-low relay lamp
- HiveMQ Cloud (MQTT over TLS)
- Telegram Bot as primary dashboard
- Netlify Functions (serverless webhook + control API)
- Optional static dashboard on Netlify

## 1) Architecture (No VPS)

```text
ESP8266  <---MQTT TLS--->  HiveMQ Cloud  --HTTP Webhook-->  Netlify Function
   ^                                                          |
   |                                                          v
Telegram commands --> Telegram Webhook --> Netlify Function -> MQTT publish
   |
   +---- Telegram chat receives alerts/status from Netlify
```

### Why this works serverless

- Telegram command handling is webhook-based (event-driven serverless).
- Device control is done by MQTT publish from serverless function.
- Motion alerts are pushed in real-time by HiveMQ HTTP webhook to serverless.
- No persistent VPS process required.

> Note: Configure HiveMQ Cloud webhook integration to POST motion/status events to `/.netlify/functions/hivemq-ingest`.

## 2) Folder Structure

```text
.
├── firmware/
│   ├── platformio.ini
│   └── src/main.cpp
├── netlify/
│   └── functions/
│       ├── _lib/constants.js
│       ├── _lib/security.js
│       ├── _lib/state.js
│       ├── _lib/telegram.js
│       ├── _lib/mqtt.js
│       ├── telegram-webhook.js
│       ├── hivemq-ingest.js
│       ├── status.js
│       ├── set-webhook.js
│       └── health.js
├── dashboard/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── netlify.toml
├── package.json
└── .env.example
```

## 3) MQTT Topics

All payloads are JSON.

- `home/mainroom/motion`
- `home/mainroom/light/set`
- `home/mainroom/light/state`
- `home/mainroom/status`
- `home/mainroom/heartbeat`
- `home/mainroom/restart`

Additional internal topics (recommended):

- `home/mainroom/arm/state`
- `home/mainroom/night_mode/state`

## 4) Deploy Steps

1. Create HiveMQ Cloud cluster and credentials.
2. Create Telegram bot with BotFather, get bot token.
3. Deploy this repo to Netlify.
4. Set environment variables from `.env.example`.
5. Configure HiveMQ HTTP webhook:
   - Source topics: `home/mainroom/motion`, `home/mainroom/light/state`, `home/mainroom/status`, `home/mainroom/heartbeat`
   - Target URL: `https://YOUR_SITE.netlify.app/.netlify/functions/hivemq-ingest`
   - Header: `x-ingest-secret: <HIVEMQ_INGEST_SECRET>`
6. Set Telegram webhook:
   - Call:
     - `GET https://YOUR_SITE.netlify.app/.netlify/functions/set-webhook`
7. Flash firmware with WiFi + MQTT creds.

## 5) Security Model

- Telegram user whitelist (`TELEGRAM_ADMIN_IDS`).
- MQTT over TLS (`wss://...:8884/mqtt` in serverless, `WiFiClientSecure` on ESP8266).
- Ingest endpoint secret header validation.
- Strict command parsing and callback validation.
- Secrets only in env vars.

## 6) Performance Notes

- Motion alert under 1s depends on HiveMQ webhook latency + Netlify cold start.
- For best performance:
  - Keep one region near your HiveMQ region.
  - Use scheduled warm ping to reduce cold starts.
  - Keep function bundle small.

## 7) Firmware Build

- Preferred: PlatformIO
  - `cd firmware`
  - `pio run -t upload`
- Or Arduino IDE with equivalent libraries.

## 8) Telegram Dashboard Menus

Main menu inline buttons:

- `🟢 Light ON`
- `🔴 Light OFF`
- `📊 Status`
- `🛡 Arm`
- `🔕 Disarm`
- `📜 Logs`
- `⚙ Settings`
- `🔄 Restart Device`

Settings menu:

- Toggle auto-off
- Set auto-off minutes
- Toggle night mode
- Set motion cooldown
- Back

