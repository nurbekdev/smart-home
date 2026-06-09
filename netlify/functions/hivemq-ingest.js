import { TOPICS } from "./_lib/constants.js";
import { verifyIngestSecret } from "./_lib/security.js";
import { appendLog, setState } from "./_lib/state.js";

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

    if (topic !== TOPICS.status) return new Response("ignored", { status: 200 });
    if (!data) return new Response("ignored", { status: 200 });

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
