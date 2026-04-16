import { getStore } from "@netlify/blobs";
import { DEFAULTS } from "./constants.js";

const store = getStore("iot-state");

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
  const value = await store.get("state", { type: "json" });
  return { ...DEFAULT_STATE, ...(value || {}) };
}

export async function setState(patch) {
  const current = await getState();
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await store.setJSON("state", next);
  return next;
}

export async function appendLog(event) {
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
  return (await store.get("logs", { type: "json" })) || [];
}
