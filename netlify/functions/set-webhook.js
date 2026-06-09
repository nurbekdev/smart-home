import { telegramCall } from "./_lib/telegram.js";
import { getTelegramSecret } from "./_lib/security.js";

function getWebhookUrl() {
  if (process.env.TELEGRAM_WEBHOOK_URL) return process.env.TELEGRAM_WEBHOOK_URL;
  if (process.env.SITE_BASE_URL) {
    return `${process.env.SITE_BASE_URL.replace(/\/$/, "")}/.netlify/functions/telegram-webhook`;
  }
  return "";
}

function missingEnv() {
  const missing = [];
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (!getWebhookUrl()) missing.push("TELEGRAM_WEBHOOK_URL or SITE_BASE_URL");
  if (!getTelegramSecret()) missing.push("TELEGRAM_SECRET_TOKEN or HIVEMQ_INGEST_SECRET");
  return missing;
}

export default async () => {
  const missing = missingEnv();
  if (missing.length > 0) {
    return new Response(JSON.stringify({ ok: false, error: "missing_env", missing }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  try {
    const telegram = await telegramCall("setWebhook", {
      url: getWebhookUrl(),
      secret_token: getTelegramSecret(),
      drop_pending_updates: true,
      allowed_updates: ["message", "callback_query"]
    });

    return new Response(
      JSON.stringify({
        ok: true,
        telegram: {
          ok: telegram.ok,
          result: telegram.result,
          description: telegram.description
        }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
  } catch (err) {
    console.error("set-webhook failed", err?.message || err);
    return new Response(JSON.stringify({ ok: false, error: "telegram_set_webhook_failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
};
