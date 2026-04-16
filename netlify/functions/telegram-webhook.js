import { CALLBACKS, TOPICS } from "./_lib/constants.js";
import { isTelegramAdmin } from "./_lib/security.js";
import { appendLog, getLogs, getState, setState } from "./_lib/state.js";
import {
  answerCallback,
  editDashboard,
  editSettings,
  sendAlert,
  sendDashboard
} from "./_lib/telegram.js";
import { mqttPublish } from "./_lib/mqtt.js";

function statusText(state) {
  return [
    "🏠 Smart Security + Light",
    `Light: ${state.lightOn ? "ON" : "OFF"}`,
    `Armed: ${state.armed ? "YES" : "NO"}`,
    `Night mode: ${state.nightModeOnly ? "YES" : "NO"}`,
    `Online: ${state.online ? "YES" : "NO"}`,
    `Last seen: ${state.lastSeenAt || "-"}`,
    `Last motion: ${state.lastMotionAt || "-"}`,
    `Latency: ${state.lastLatencyMs ?? "-"} ms`,
    `Cooldown: ${state.motionCooldownSeconds}s`,
    `Auto OFF: ${state.autoOffEnabled ? `${state.autoOffMinutes} min` : "disabled"}`
  ].join("\n");
}

async function handleCallback(query) {
  const userId = query.from?.id;
  if (!isTelegramAdmin(userId)) {
    await answerCallback(query.id, "Unauthorized");
    return;
  }

  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const action = query.data;
  let state = await getState();

  const publish = async (topic, body, localPatch = {}, mqttOptions = {}) => {
    const result = await mqttPublish(topic, body, { retain: false, ...mqttOptions });
    state = await setState({ ...localPatch, lastLatencyMs: result.latencyMs });
    return result;
  };

  switch (action) {
    case CALLBACKS.LIGHT_ON:
      await publish(TOPICS.lightSet, { on: true, source: "telegram" }, { lightOn: true }, { retain: true });
      await appendLog({ type: "light", message: "Light turned ON from Telegram" });
      await editDashboard(chatId, messageId, `✅ Light ON\n\n${statusText(state)}`);
      break;
    case CALLBACKS.LIGHT_OFF:
      await publish(TOPICS.lightSet, { on: false, source: "telegram" }, { lightOn: false }, { retain: true });
      await appendLog({ type: "light", message: "Light turned OFF from Telegram" });
      await editDashboard(chatId, messageId, `✅ Light OFF\n\n${statusText(state)}`);
      break;
    case CALLBACKS.ARM:
      await publish(TOPICS.armState, { armed: true, source: "telegram" }, { armed: true });
      await appendLog({ type: "security", message: "System armed from Telegram" });
      await editDashboard(chatId, messageId, `🛡 System armed\n\n${statusText(state)}`);
      break;
    case CALLBACKS.DISARM:
      await publish(TOPICS.armState, { armed: false, source: "telegram" }, { armed: false });
      await appendLog({ type: "security", message: "System disarmed from Telegram" });
      await editDashboard(chatId, messageId, `🔕 System disarmed\n\n${statusText(state)}`);
      break;
    case CALLBACKS.STATUS:
      await editDashboard(chatId, messageId, statusText(state));
      break;
    case CALLBACKS.LOGS: {
      const logs = await getLogs();
      const text =
        logs.length === 0
          ? "📜 No logs yet."
          : `📜 Recent logs:\n${logs
              .slice(0, 10)
              .map((l) => `- [${l.at}] ${l.message}`)
              .join("\n")}`;
      await editDashboard(chatId, messageId, text);
      break;
    }
    case CALLBACKS.SETTINGS:
      await editSettings(chatId, messageId, "⚙ Settings", state);
      break;
    case CALLBACKS.AUTO_OFF_TOGGLE:
      state = await setState({ autoOffEnabled: !state.autoOffEnabled });
      await appendLog({
        type: "settings",
        message: `Auto-OFF ${state.autoOffEnabled ? "enabled" : "disabled"}`
      });
      await editSettings(chatId, messageId, "⚙ Settings updated", state);
      break;
    case CALLBACKS.NIGHT_MODE_TOGGLE:
      state = await setState({ nightModeOnly: !state.nightModeOnly });
      await mqttPublish(TOPICS.nightModeState, { enabled: state.nightModeOnly, source: "telegram" });
      await appendLog({
        type: "settings",
        message: `Night mode ${state.nightModeOnly ? "enabled" : "disabled"}`
      });
      await editSettings(chatId, messageId, "⚙ Settings updated", state);
      break;
    case CALLBACKS.COOLDOWN_INC:
      state = await setState({ motionCooldownSeconds: Math.min(120, state.motionCooldownSeconds + 5) });
      await appendLog({ type: "settings", message: `Motion cooldown set to ${state.motionCooldownSeconds}s` });
      await editSettings(chatId, messageId, "⚙ Settings updated", state);
      break;
    case CALLBACKS.COOLDOWN_DEC:
      state = await setState({ motionCooldownSeconds: Math.max(5, state.motionCooldownSeconds - 5) });
      await appendLog({ type: "settings", message: `Motion cooldown set to ${state.motionCooldownSeconds}s` });
      await editSettings(chatId, messageId, "⚙ Settings updated", state);
      break;
    case CALLBACKS.RESTART:
      await publish(TOPICS.restart, { restart: true, source: "telegram" });
      await appendLog({ type: "device", message: "Device restart command sent" });
      await editDashboard(chatId, messageId, "🔄 Restart command sent.");
      break;
    case CALLBACKS.BACK_MAIN:
      await editDashboard(chatId, messageId, statusText(state));
      break;
    default:
      await answerCallback(query.id, "Unknown action");
      return;
  }

  await answerCallback(query.id, "Done");
}

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const body = await request.json().catch(() => ({}));

    if (body.message?.text === "/start") {
      const userId = body.message.from?.id;
      if (!isTelegramAdmin(userId)) {
        return new Response("ok", { status: 200 });
      }
      const state = await getState();
      await sendDashboard(body.message.chat.id, statusText(state));
      return new Response("ok", { status: 200 });
    }

    if (body.callback_query) {
      await handleCallback(body.callback_query);
      return new Response("ok", { status: 200 });
    }

    if (body.message?.text === "/status") {
      const userId = body.message.from?.id;
      if (!isTelegramAdmin(userId)) {
        return new Response("ok", { status: 200 });
      }
      const state = await getState();
      await sendAlert(statusText(state), body.message.chat.id);
      return new Response("ok", { status: 200 });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("telegram-webhook error", err);
    return new Response("internal error", { status: 500 });
  }
};
