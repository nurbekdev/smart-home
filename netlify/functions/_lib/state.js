import { getStore } from "@netlify/blobs";
import { DEFAULTS } from "./constants.js";

const DEFAULT_STATE = {
  lightOn: false,
  armed: DEFAULTS.armed,
  nightModeOnly: DEFAULTS.nightModeOnly,
  autoOffEnabled: true,
  autoOffMinutes: DEFAULTS.autoOffMinutes,
  motionCooldownSeconds: DEFAULTS.motionCooldownSeconds,
  online: false,
  lastSeenAt: null,
  lastMotionAt: null,
  lastLatencyMs: null,
  updatedAt: null
};

export async function getState() {
  const store = getStore("iot-state");
  const value = await store.get("state", { type: "json" });
  return { ...DEFAULT_STATE, ...(value || {}) };
}

export async function setState(patch) {
  const store = getStore("iot-state");
  const current = await getState();
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await store.setJSON("state", next);
  return next;
}

export async function appendLog(event) {
  const store = getStore("iot-state");
  const logs = (await store.get("logs", { type: "json" })) || [];
  logs.unshift({
    ...event,
    at: new Date().toISOString()
  });
  const compact = logs.slice(0, 50);
  await store.setJSON("logs", compact);
  return compact;
}

export async function getLogs() {
  const store = getStore("iot-state");
  return (await store.get("logs", { type: "json" })) || [];
}
