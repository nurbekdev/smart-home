import { getLogs, getState } from "./_lib/state.js";

export default async () => {
  const state = await getState();
  const logs = await getLogs();
  const env = {
    telegramBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    telegramSecretToken: Boolean(process.env.TELEGRAM_SECRET_TOKEN || process.env.HIVEMQ_INGEST_SECRET),
    telegramWebhookUrl: Boolean(process.env.TELEGRAM_WEBHOOK_URL || process.env.SITE_BASE_URL),
    allowedChatId: Boolean(
      process.env.ALLOWED_CHAT_ID || process.env.TELEGRAM_DEFAULT_CHAT_ID || process.env.TELEGRAM_ADMIN_IDS
    ),
    mqttUrl: Boolean(process.env.MQTT_URL || process.env.HIVEMQ_HOST),
    mqttUser: Boolean(process.env.MQTT_USER || process.env.HIVEMQ_USERNAME),
    mqttPass: Boolean(process.env.MQTT_PASS || process.env.HIVEMQ_PASSWORD),
    mqttCommandTopic: process.env.MQTT_COMMAND_TOPIC || "elshodlampa/device-1/cmd",
    mqttStatusTopic: process.env.MQTT_STATUS_TOPIC || "elshodlampa/device-1/status",
    mqttMotionTopic: process.env.MQTT_MOTION_TOPIC || "elshodlampa/device-1/motion"
  };
  return new Response(
    JSON.stringify({
      ok: true,
      state,
      logs: logs.slice(0, 20),
      env
    }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  );
};
