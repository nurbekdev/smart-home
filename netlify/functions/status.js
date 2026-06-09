import { getLogs, getState } from "./_lib/state.js";

export default async () => {
  const state = await getState();
  const logs = await getLogs();
  const env = {
    telegramBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    telegramSecretToken: Boolean(process.env.TELEGRAM_SECRET_TOKEN),
    telegramWebhookUrl: Boolean(process.env.TELEGRAM_WEBHOOK_URL),
    allowedChatId: Boolean(process.env.ALLOWED_CHAT_ID),
    mqttUrl: Boolean(process.env.MQTT_URL),
    mqttUser: Boolean(process.env.MQTT_USER),
    mqttPass: Boolean(process.env.MQTT_PASS),
    mqttCommandTopic: process.env.MQTT_COMMAND_TOPIC || "elshodlampa/device-1/cmd",
    mqttStatusTopic: process.env.MQTT_STATUS_TOPIC || "elshodlampa/device-1/status"
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
