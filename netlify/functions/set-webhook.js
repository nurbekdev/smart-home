import { telegramCall } from "./_lib/telegram.js";

export default async () => {
  try {
    const base = process.env.SITE_BASE_URL;
    const webhookUrl = `${base}/.netlify/functions/telegram-webhook`;
    const response = await telegramCall("setWebhook", { url: webhookUrl });
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        telegram: response
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(err.message || err) })
    };
  }
};
