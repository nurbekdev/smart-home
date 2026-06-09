const BOT_API = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

function commandKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "ON", callback_data: "/on" },
        { text: "OFF", callback_data: "/off" }
      ],
      [{ text: "Status", callback_data: "/status" }]
    ]
  };
}

export async function telegramCall(method, payload) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }
  const response = await fetch(`${BOT_API()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  if (!json.ok) {
    throw new Error(`Telegram API error: ${json.description || response.status}`);
  }
  return json;
}

export async function sendMessage(chatId, text, extra = {}) {
  return telegramCall("sendMessage", {
    chat_id: chatId,
    text,
    ...extra
  });
}

export async function sendHelp(chatId, text) {
  return sendMessage(chatId, text, { reply_markup: commandKeyboard() });
}

export async function answerCallback(id, text = "OK") {
  return telegramCall("answerCallbackQuery", {
    callback_query_id: id,
    text
  });
}
