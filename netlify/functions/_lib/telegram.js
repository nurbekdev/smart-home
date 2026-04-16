import { CALLBACKS } from "./constants.js";

const BOT_API = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🟢 Light ON", callback_data: CALLBACKS.LIGHT_ON },
        { text: "🔴 Light OFF", callback_data: CALLBACKS.LIGHT_OFF }
      ],
      [
        { text: "📊 Status", callback_data: CALLBACKS.STATUS },
        { text: "🛡 Arm", callback_data: CALLBACKS.ARM }
      ],
      [
        { text: "🔕 Disarm", callback_data: CALLBACKS.DISARM },
        { text: "📜 Logs", callback_data: CALLBACKS.LOGS }
      ],
      [
        { text: "⚙ Settings", callback_data: CALLBACKS.SETTINGS },
        { text: "🔄 Restart Device", callback_data: CALLBACKS.RESTART }
      ]
    ]
  };
}

export function settingsKeyboard(state) {
  return {
    inline_keyboard: [
      [
        {
          text: `Auto-OFF: ${state.autoOffEnabled ? "ON" : "OFF"}`,
          callback_data: CALLBACKS.AUTO_OFF_TOGGLE
        }
      ],
      [
        { text: "Cooldown -", callback_data: CALLBACKS.COOLDOWN_DEC },
        { text: "Cooldown +", callback_data: CALLBACKS.COOLDOWN_INC }
      ],
      [
        {
          text: `Night Mode: ${state.nightModeOnly ? "ON" : "OFF"}`,
          callback_data: CALLBACKS.NIGHT_MODE_TOGGLE
        }
      ],
      [{ text: "⬅ Back", callback_data: CALLBACKS.BACK_MAIN }]
    ]
  };
}

export async function telegramCall(method, payload) {
  const response = await fetch(`${BOT_API()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  if (!json.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(json)}`);
  }
  return json;
}

export async function sendDashboard(chatId, text) {
  return telegramCall("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: mainKeyboard()
  });
}

export async function editDashboard(chatId, messageId, text) {
  return telegramCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: mainKeyboard()
  });
}

export async function editSettings(chatId, messageId, text, state) {
  return telegramCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: settingsKeyboard(state)
  });
}

export async function answerCallback(id, text = "OK") {
  return telegramCall("answerCallbackQuery", {
    callback_query_id: id,
    text
  });
}

export async function sendAlert(text, chatId = process.env.TELEGRAM_DEFAULT_CHAT_ID) {
  return telegramCall("sendMessage", {
    chat_id: chatId,
    text
  });
}
