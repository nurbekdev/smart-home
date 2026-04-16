# Deployment Guide (Netlify Serverless)

## Prerequisites

- HiveMQ Cloud instance + credentials
- Telegram bot token from BotFather
- Netlify account
- ESP8266 NodeMCU with PIR on `D5` and relay on `D6`

## A) Netlify Deploy

1. Push this repository to GitHub.
2. Import project in Netlify.
3. Build settings are read from `netlify.toml`.
4. Add environment variables from `.env.example`.
5. Deploy.

## B) Configure Telegram Webhook

After first deploy, open:

- `https://YOUR_SITE.netlify.app/.netlify/functions/set-webhook`

Expected response includes Telegram `ok: true`.

## C) Configure HiveMQ -> Netlify ingest

Create HTTP webhook rule in HiveMQ Cloud:

- Endpoint: `https://YOUR_SITE.netlify.app/.netlify/functions/hivemq-ingest`
- Method: `POST`
- Header: `x-ingest-secret: <HIVEMQ_INGEST_SECRET>`
- Topics:
  - `home/mainroom/motion`
  - `home/mainroom/light/state`
  - `home/mainroom/status`
  - `home/mainroom/heartbeat`

## D) Verify End-to-End

1. Send `/start` to Telegram bot.
2. Click `🟢 Light ON`; lamp should switch ON.
3. Trigger PIR; Telegram should receive `🚨 Motion detected in room!`.
4. Open dashboard URL (`/`) and verify status updates.

## E) ESP Firmware

1. Edit WiFi and MQTT values in `firmware/src/main.cpp`.
2. Flash with PlatformIO:
   - `cd firmware`
   - `pio run -t upload`
3. Open serial monitor:
   - `pio device monitor`

## F) Production Hardening

- Replace `secureClient.setInsecure()` with CA certificate pinning.
- Restrict Telegram bot to private chat.
- Rotate all credentials quarterly.
- Disable public access to status endpoint if privacy is required.
