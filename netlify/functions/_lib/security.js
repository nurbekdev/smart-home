function parseAdminIds() {
  const raw = process.env.TELEGRAM_ADMIN_IDS || "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isTelegramAdmin(userId) {
  const admins = parseAdminIds();
  return admins.includes(String(userId));
}

export function verifyIngestSecret(headers) {
  const configured = process.env.HIVEMQ_INGEST_SECRET || "";
  const received =
    headers["x-ingest-secret"] ||
    headers["X-Ingest-Secret"] ||
    headers["x-ingest-Secret"];
  return configured.length > 0 && received === configured;
}
