import { TOPICS } from "./_lib/constants.js";
import { mqttPublish } from "./_lib/mqtt.js";
import { appendLog, getState, setState } from "./_lib/state.js";
import { answerCallback, editPanel, sendMessage, sendPanel } from "./_lib/telegram.js";
import { isAllowedChat, verifyTelegramSecret } from "./_lib/security.js";

function commandFromUpdate(update) {
  const callbackData = update.callback_query?.data;
  if (callbackData) return callbackData.trim().split(/\s+/)[0].toLowerCase();

  const text = update.message?.text || "";
  return text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
}

function chatIdFromUpdate(update) {
  return update.message?.chat?.id || update.callback_query?.message?.chat?.id;
}

function messageIdFromUpdate(update) {
  return update.callback_query?.message?.message_id;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function labelOnline(state) {
  return state.online ? "Online" : "Offline";
}

function labelRelay(state) {
  return state.lightOn ? "Yoqilgan" : "O'chirilgan";
}

function panelText(state, notice = "") {
  return [
    "Elshodlampa boshqaruv paneli",
    "",
    notice ? `Natija: ${notice}` : "Kerakli amalni tanlang.",
    "",
    `Holat: ${labelOnline(state)}`,
    `Lampa: ${labelRelay(state)}`,
    `Device: ${state.deviceId || "device-1"}`,
    `Oxirgi aloqa: ${formatDateTime(state.lastSeenAt)}`,
    `Oxirgi harakat: ${formatDateTime(state.lastMotionAt)}`,
    `Oxirgi buyruq: ${state.lastCommand ? `/${state.lastCommand}` : "-"}`,
    `MQTT kechikish: ${state.lastLatencyMs ?? "-"} ms`,
    `Wi-Fi signal: ${state.rssi ?? "-"} dBm`,
    "",
    "Buttonlardan foydalaning yoki /on, /off, /status yuboring."
  ]
    .filter((line) => line !== null)
    .join("\n");
}

async function safeTelegram(action) {
  try {
    await action();
  } catch (err) {
    console.error("telegram api failed", err?.message || err);
  }
}

async function publishCommand(command, patch) {
  const payload =
    command === "status"
      ? { action: "status", source: "telegram", time: Date.now() }
      : { relay: command, source: "telegram", time: Date.now() };

  const result = await mqttPublish(TOPICS.command, payload, { retain: false });
  const state = await setState({
    ...patch,
    lastCommand: command,
    lastCommandAt: new Date().toISOString(),
    lastLatencyMs: result.latencyMs
  });
  await appendLog({ type: "telegram", message: `Command /${command} published to MQTT` });
  return state;
}

async function replyWithPanel(update, chatId, text) {
  const messageId = messageIdFromUpdate(update);
  if (messageId) {
    try {
      await editPanel(chatId, messageId, text);
      return;
    } catch (err) {
      const message = err?.message || "";
      if (!message.includes("message is not modified")) {
        console.error("edit panel failed", message || err);
      }
    }
  }
  await sendPanel(chatId, text);
}

async function handleAllowedCommand(update, chatId, command) {
  switch (command) {
    case "/start":
    case "/help": {
      const state = await getState();
      await replyWithPanel(update, chatId, panelText(state));
      return;
    }
    case "/on": {
      try {
        const state = await publishCommand("on", { lightOn: true });
        await replyWithPanel(update, chatId, panelText(state, "Lampani yoqish buyrug'i yuborildi."));
      } catch (err) {
        console.error("on mqtt publish failed", err?.message || err);
        await appendLog({ type: "mqtt", message: "ON command publish failed" });
        const state = await getState();
        await replyWithPanel(update, chatId, panelText(state, "MQTT xatosi. Broker sozlamalarini tekshiring."));
      }
      return;
    }
    case "/off": {
      try {
        const state = await publishCommand("off", { lightOn: false });
        await replyWithPanel(update, chatId, panelText(state, "Lampani o'chirish buyrug'i yuborildi."));
      } catch (err) {
        console.error("off mqtt publish failed", err?.message || err);
        await appendLog({ type: "mqtt", message: "OFF command publish failed" });
        const state = await getState();
        await replyWithPanel(update, chatId, panelText(state, "MQTT xatosi. Broker sozlamalarini tekshiring."));
      }
      return;
    }
    case "/status": {
      let state = await getState();
      try {
        state = await publishCommand("status", {});
      } catch (err) {
        console.error("status mqtt publish failed", err?.message || err);
        await appendLog({ type: "mqtt", message: "Status request publish failed" });
      }
      await replyWithPanel(update, chatId, panelText(state, "Status so'rovi yuborildi."));
      return;
    }
    default:
      await replyWithPanel(update, chatId, panelText(await getState(), `Noma'lum buyruq: ${command || "-"}`));
  }
}

async function processUpdate(update) {
  const chatId = chatIdFromUpdate(update);
  if (!chatId) return;

  const command = commandFromUpdate(update);
  if (update.callback_query?.id) {
    await safeTelegram(() => answerCallback(update.callback_query.id));
  }

  if (!isAllowedChat(chatId)) {
    await safeTelegram(() => sendMessage(chatId, "Sizga ruxsat berilmagan."));
    return;
  }

  await handleAllowedCommand(update, chatId, command);
}

export default async (request, context = {}) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!verifyTelegramSecret(request.headers)) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const update = await request.json();
    const work = processUpdate(update || {}).catch((err) => {
      console.error("telegram-webhook handled error", err?.message || err);
    });

    if (typeof context.waitUntil === "function") {
      context.waitUntil(work);
    } else {
      await work;
    }
  } catch (err) {
    console.error("telegram-webhook handled error", err?.message || err);
  }

  return new Response("ok", { status: 200 });
};
