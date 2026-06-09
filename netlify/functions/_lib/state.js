import { getStore } from "@netlify/blobs";
import { DEFAULTS } from "./constants.js";

const store = () => getStore("iot-state");

const DEFAULT_STATE = {
  deviceId: DEFAULTS.deviceId,
  lightOn: false,
  online: false,
  lastSeenAt: null,
  lastStatusAt: null,
  lastCommandAt: null,
  lastCommand: null,
  lastLatencyMs: null,
  ip: null,
  rssi: null,
  uptimeMs: null,
  firmware: null,
  updatedAt: null
};

export async function getState() {
  const value = await store().get("state", { type: "json" });
  return { ...DEFAULT_STATE, ...(value || {}) };
}

export async function setState(patch) {
  const current = await getState();
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await store().setJSON("state", next);
  return next;
}

export async function appendLog(event) {
  const logs = (await store().get("logs", { type: "json" })) || [];
  logs.unshift({
    ...event,
    at: new Date().toISOString()
  });
  const compact = logs.slice(0, 50);
  await store().setJSON("logs", compact);
  return compact;
}

export async function getLogs() {
  return (await store().get("logs", { type: "json" })) || [];
}
