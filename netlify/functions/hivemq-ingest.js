import { TOPICS } from "./_lib/constants.js";
import { getAllowedChatIds, verifyIngestSecret } from "./_lib/security.js";
import { appendLog, setState } from "./_lib/state.js";
import { sendMessage } from "./_lib/telegram.js";

function parseBody(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function extractMessage(payload) {
  if (payload.topic && payload.payload) return payload;
  if (payload.message?.topic) return payload.message;
  if (Array.isArray(payload.messages) && payload.messages[0]) return payload.messages[0];
  return {};
}

function parseMessagePayload(payload) {
  if (typeof payload !== "string") return payload || {};
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function formatTashkentTime(value) {
  const date = value ? new Date(value) : new Date();
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

function normalizeMotionAt(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "number" && value < 1000000000000) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

async function notifyMotion(data, at) {
  const text = [
    "Harakat aniqlandi",
    "",
    `Sana/soat: ${formatTashkentTime(at)}`,
    `Device: ${data.deviceId || "device-1"}`,
    typeof data.rssi === "number" ? `Wi-Fi signal: ${data.rssi} dBm` : null
  ]
    .filter(Boolean)
    .join("\n");

  await Promise.allSettled(getAllowedChatIds().map((chatId) => sendMessage(chatId, text)));
}

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (!verifyIngestSecret(request.headers)) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = parseBody(await request.text());
    const msg = extractMessage(payload);
    const topic = msg.topic;
    const data = parseMessagePayload(msg.payload);
    const now = new Date().toISOString();

    if (!data) return new Response("ignored", { status: 200 });

    if (topic === TOPICS.motion) {
      const motionAt = normalizeMotionAt(data.motionAt || data.time, now);
      await setState({
        online: true,
        lastSeenAt: now,
        lastMotionAt: new Date(motionAt).toISOString(),
        rssi: typeof data.rssi === "number" ? data.rssi : null
      });
      await appendLog({ type: "motion", message: `Motion detected at ${formatTashkentTime(motionAt)}` });
      await notifyMotion(data, motionAt);
      return new Response("ok", { status: 200 });
    }

    if (topic !== TOPICS.status) return new Response("ignored", { status: 200 });

    const patch = {
      online: data.online !== false,
      lastSeenAt: now,
      lastStatusAt: now,
      ip: data.ip || null,
      rssi: typeof data.rssi === "number" ? data.rssi : null,
      uptimeMs: typeof data.uptimeMs === "number" ? data.uptimeMs : null,
      firmware: data.firmware || null
    };

    if (typeof data.relay === "string") {
      patch.lightOn = data.relay === "on";
    } else if (typeof data.lightOn === "boolean") {
      patch.lightOn = data.lightOn;
    }

    await setState(patch);
    await appendLog({ type: "device", message: `Status update: ${patch.online ? "online" : "offline"}` });

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("hivemq-ingest error", err);
    return new Response("ok", { status: 200 });
  }
};
