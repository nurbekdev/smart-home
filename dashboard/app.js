async function load() {
  const grid = document.getElementById("grid");
  const logsEl = document.getElementById("logs");

  let data;
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    data = await res.json();
  } catch {
    grid.innerHTML = `<div class="item error"><strong>Status</strong><br/>Unavailable</div>`;
    logsEl.innerHTML = "";
    return;
  }

  const state = data.state || {};
  const logs = data.logs || [];

  const rows = [
    ["Device", state.deviceId || "device-1"],
    ["Online", state.online ? "YES" : "NO"],
    ["Relay", state.lightOn ? "ON" : "OFF"],
    ["Last Seen", state.lastSeenAt || "-"],
    ["Last Status", state.lastStatusAt || "-"],
    ["Last Command", state.lastCommand || "-"],
    ["MQTT Latency", `${state.lastLatencyMs ?? "-"} ms`],
    ["IP", state.ip || "-"],
    ["RSSI", state.rssi ?? "-"]
  ];

  grid.innerHTML = rows
    .map(([k, v]) => `<div class="item"><strong>${escapeHtml(k)}</strong><br/>${escapeHtml(String(v))}</div>`)
    .join("");

  logsEl.innerHTML = logs
    .map((l) => `<li>[${escapeHtml(l.at || "-")}] ${escapeHtml(l.message || "")}</li>`)
    .join("");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

load();
setInterval(load, 5000);
