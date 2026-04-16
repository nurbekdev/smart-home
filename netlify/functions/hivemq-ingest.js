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

export default async (req) => {
  try {
    if (req.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!verifyIngestSecret(req.headers || {})) {
      return { statusCode: 401, body: "unauthorized" };
    }

    const payload = parseBody(req.body);
    const msg = extractMessage(payload);
    const topic = msg.topic;
    const data = typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload || {};
    const now = new Date().toISOString();

    if (!topic) return { statusCode: 200, body: "ignored" };

    if (topic === TOPICS.motion && data.motion === true) {
      const state = await getState();
      const cooldown = Number(state.motionCooldownSeconds || 15);
      const last = state.lastMotionAt ? Date.parse(state.lastMotionAt) : 0;
      if (Date.now() - last >= cooldown * 1000) {
        await setState({ lastMotionAt: now, lastSeenAt: now, online: true });
        await appendLog({ type: "motion", message: "Motion detected in room" });
        if (state.armed) {
          await sendAlert("🚨 Motion detected in room!");
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

    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error("hivemq-ingest error", err);
    return { statusCode: 500, body: "internal error" };
  }
};
