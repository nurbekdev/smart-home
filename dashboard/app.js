async function load() {
  const res = await fetch("/api/status");
  const data = await res.json();
  const state = data.state || {};
  const logs = data.logs || [];

  const rows = [
    ["Online", state.online ? "YES" : "NO"],
    ["Light", state.lightOn ? "ON" : "OFF"],
    ["Armed", state.armed ? "YES" : "NO"],
    ["Night Mode", state.nightModeOnly ? "YES" : "NO"],
    ["Last Seen", state.lastSeenAt || "-"],
    ["Last Motion", state.lastMotionAt || "-"],
    ["Latency", `${state.lastLatencyMs ?? "-"} ms`],
    ["Cooldown", `${state.motionCooldownSeconds ?? "-"} s`]
  ];

  const grid = document.getElementById("grid");
  grid.innerHTML = rows
    .map(([k, v]) => `<div class="item"><strong>${k}</strong><br/>${v}</div>`)
    .join("");

  const logsEl = document.getElementById("logs");
  logsEl.innerHTML = logs.map((l) => `<li>[${l.at}] ${l.message}</li>`).join("");
}

load();
setInterval(load, 5000);
