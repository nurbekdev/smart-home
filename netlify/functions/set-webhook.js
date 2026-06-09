import { telegramCall } from "./_lib/telegram.js";

function missingEnv() {
  return ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_URL", "TELEGRAM_SECRET_TOKEN"].filter(
    (name) => !process.env[name]
  );
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
      url: process.env.TELEGRAM_WEBHOOK_URL,
      secret_token: process.env.TELEGRAM_SECRET_TOKEN,
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
