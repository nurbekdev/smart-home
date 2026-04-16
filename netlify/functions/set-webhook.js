import { telegramCall } from "./_lib/telegram.js";

export default async () => {
  try {
    const base = process.env.SITE_BASE_URL;
    const webhookUrl = `${base}/.netlify/functions/telegram-webhook`;
    const response = await telegramCall("setWebhook", { url: webhookUrl });
    return new Response(
      JSON.stringify({
        ok: true,
        telegram: response
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err.message || err) }),
      {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
  }
};
