const BOT_API = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export function controlKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "💡 Relay ON", callback_data: "/on" },
        { text: "🌙 Relay OFF", callback_data: "/off" }
      ],
      [
        { text: "📊 Status", callback_data: "/status" },
        { text: "ℹ️ Yordam", callback_data: "/help" }
      ]
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
    disable_web_page_preview: true,
    ...extra
  });
}

export async function sendSticker(chatId, sticker) {
  if (!sticker) return null;
  return telegramCall("sendSticker", {
    chat_id: chatId,
    sticker
  });
}

export async function sendPanel(chatId, text) {
  return sendMessage(chatId, text, { reply_markup: controlKeyboard() });
}

export async function editPanel(chatId, messageId, text) {
  return telegramCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    reply_markup: controlKeyboard()
  });
}

export async function answerCallback(id, text = "OK") {
  return telegramCall("answerCallbackQuery", {
    callback_query_id: id,
    text
  });
}
