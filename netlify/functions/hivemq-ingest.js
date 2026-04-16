import { TOPICS } from "./_lib/constants.js";
import { verifyIngestSecret } from "./_lib/security.js";
import { appendLog, getState, setState } from "./_lib/state.js";
import { sendAlert } from "./_lib/telegram.js";

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

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const headersObj = {
      "x-ingest-secret": request.headers.get("x-ingest-secret"),
      "X-Ingest-Secret": request.headers.get("X-Ingest-Secret")
    };
    if (!verifyIngestSecret(headersObj)) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = parseBody(await request.text());
    const msg = extractMessage(payload);
    const topic = msg.topic;
    const data = typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload || {};
    const now = new Date().toISOString();

    if (!topic) return new Response("ignored", { status: 200 });

    if (topic === TOPICS.motion && data.motion === true) {
      const state = await getState();
      const cooldown = Number(state.motionCooldownSeconds || 15);
      const last = state.lastMotionAt ? Date.parse(state.lastMotionAt) : 0;
      if (Date.now() - last >= cooldown * 1000) {
        await setState({ lastMotionAt: now, lastSeenAt: now, online: true, lightOn: true });
        const timeStr = new Date(now).toLocaleString("uz-UZ", {
          timeZone: "Asia/Tashkent",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });
        await appendLog({ type: "motion", message: `Harakat aniqlandi — ${timeStr}` });
        if (state.armed) {
          await sendAlert(`🚨 Harakat aniqlandi!\n🕐 Vaqt: ${timeStr}`);
        }
      }
    } else if (topic === TOPICS.lightState) {
      await setState({ lightOn: Boolean(data.on), lastSeenAt: now, online: true });
      await appendLog({ type: "light", message: `Light state -> ${data.on ? "ON" : "OFF"}` });
    } else if (topic === TOPICS.status || topic === TOPICS.heartbeat) {
      await setState({
        online: data.online !== false,
        lastSeenAt: now
      });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("hivemq-ingest error", err);
    return new Response("internal error", { status: 500 });
  }
};
