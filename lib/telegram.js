// Thin Telegram Bot API helpers — all calls go through the global fetch.

const TOKEN = process.env.TELEGRAM_TOKEN;
const API = () => `https://api.telegram.org/bot${TOKEN}`;

async function callTelegram(method, body) {
  const res = await fetch(`${API()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(data)}`);
  }
  return data.result;
}

function inlineKeyboard(keyboard) {
  return keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {};
}

export async function sendMessage(chatId, text, { keyboard, html } = {}) {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    ...(html ? { parse_mode: "HTML" } : {}),
    ...inlineKeyboard(keyboard),
  });
}

export async function editMessageText(chatId, messageId, text, { keyboard, html } = {}) {
  return callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(html ? { parse_mode: "HTML" } : {}),
    reply_markup: keyboard ? { inline_keyboard: keyboard } : { inline_keyboard: [] },
  });
}

export async function answerCallbackQuery(callbackQueryId, text) {
  return callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

export const CONFIRM_KEYBOARD = [
  [
    { text: "✓ Confirm", callback_data: "confirm" },
    { text: "✗ Cancel", callback_data: "cancel" },
  ],
];
