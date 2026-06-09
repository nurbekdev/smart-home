import { TOPICS } from "./_lib/constants.js";
import { mqttPublish } from "./_lib/mqtt.js";
import { appendLog, getState, setState } from "./_lib/state.js";
import { answerCallback, sendHelp, sendMessage } from "./_lib/telegram.js";
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

function helpText() {
  return [
    "Elshodlampa bot tayyor.",
    "",
    "Buyruqlar:",
    "/on - lampani yoqish",
    "/off - lampani o'chirish",
    "/status - device statusini so'rash",
    "/help - yordam"
  ].join("\n");
}

function formatStatus(state) {
  return [
    "Elshodlampa status",
    `Device: ${state.deviceId || "device-1"}`,
    `Online: ${state.online ? "YES" : "NO"}`,
    `Relay: ${state.lightOn ? "ON" : "OFF"}`,
    `Last seen: ${state.lastSeenAt || "-"}`,
    `Last status: ${state.lastStatusAt || "-"}`,
    `Last command: ${state.lastCommand || "-"}`,
    `MQTT latency: ${state.lastLatencyMs ?? "-"} ms`,
    `IP: ${state.ip || "-"}`,
    `RSSI: ${state.rssi ?? "-"}`
  ].join("\n");
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

async function handleAllowedCommand(chatId, command) {
  switch (command) {
    case "/start":
    case "/help":
      await sendHelp(chatId, helpText());
      return;
    case "/on": {
      try {
        const state = await publishCommand("on", { lightOn: true });
        await sendMessage(chatId, `OK. Lampa yoqish buyrug'i yuborildi.\n\n${formatStatus(state)}`);
      } catch (err) {
        console.error("on mqtt publish failed", err?.message || err);
        await appendLog({ type: "mqtt", message: "ON command publish failed" });
        await sendMessage(chatId, "MQTT xatosi: lampa yoqish buyrug'i yuborilmadi. Broker sozlamalarini tekshiring.");
      }
      return;
    }
    case "/off": {
      try {
        const state = await publishCommand("off", { lightOn: false });
        await sendMessage(chatId, `OK. Lampa o'chirish buyrug'i yuborildi.\n\n${formatStatus(state)}`);
      } catch (err) {
        console.error("off mqtt publish failed", err?.message || err);
        await appendLog({ type: "mqtt", message: "OFF command publish failed" });
        await sendMessage(chatId, "MQTT xatosi: lampa o'chirish buyrug'i yuborilmadi. Broker sozlamalarini tekshiring.");
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
      await sendMessage(chatId, formatStatus(state));
      return;
    }
    default:
      await sendHelp(chatId, `Noma'lum buyruq: ${command || "-"}\n\n${helpText()}`);
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

  await handleAllowedCommand(chatId, command);
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
