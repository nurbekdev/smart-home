function timingSafeEqualString(a = "", b = "") {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isAllowedChat(chatId) {
  return String(chatId || "") === String(process.env.ALLOWED_CHAT_ID || "").trim();
}

export function verifyTelegramSecret(headers) {
  const configured = process.env.TELEGRAM_SECRET_TOKEN || "";
  const received =
    typeof headers.get === "function"
      ? headers.get("x-telegram-bot-api-secret-token")
      : headers["x-telegram-bot-api-secret-token"];
  return timingSafeEqualString(String(received || ""), configured);
}

export function verifyIngestSecret(headers) {
  const configured = process.env.HIVEMQ_INGEST_SECRET || process.env.TELEGRAM_SECRET_TOKEN || "";
  const received =
    typeof headers.get === "function" ? headers.get("x-ingest-secret") : headers["x-ingest-secret"];
  return timingSafeEqualString(String(received || ""), configured);
}
