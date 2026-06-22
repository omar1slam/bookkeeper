import { parseMessage } from "../lib/parse.js";
import { resolveTargetCell } from "../lib/resolve.js";
import { appendAmount, removeLastTerm } from "../lib/formula.js";
import { getValues, updateValue } from "../lib/sheets.js";
import { CATEGORIES } from "../lib/categories.js";
import {
  appendTransaction,
  readLast,
  deleteRow,
  sumForDate,
  ensureLedger,
} from "../lib/ledger.js";
import { encodePayload, decodePayload, hasPayload } from "../lib/payload.js";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  CONFIRM_KEYBOARD,
} from "../lib/telegram.js";

const TZ = process.env.DEFAULT_TZ || "Africa/Cairo";
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || "EGP";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Best-effort dedupe of webhook retries within a warm instance (not durable).
const seenUpdates = new Set();

// ---------- date / formatting helpers ----------

/** Today's date parts in the configured timezone. */
function nowInTz() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function todayISO() {
  const { year, month, day } = nowInTz();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "Jun 2026" tab name for a YYYY-MM-DD date string. */
function tabNameForDate(dateISO) {
  const [y, m] = String(dateISO).split("-").map(Number);
  if (!y || !m) {
    const t = nowInTz();
    return `${MONTHS[t.month - 1]} ${t.year}`;
  }
  return `${MONTHS[m - 1]} ${y}`;
}

function fmtNumber(n) {
  const num = Number(n);
  if (!isFinite(num)) return String(n);
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Human label for an item (category label or freeform label). */
function itemLabel(item) {
  if (item.category_key && CATEGORIES[item.category_key]) return CATEGORIES[item.category_key].label;
  return item.label || item.section || "expense";
}

// ---------- HTTP entry point ----------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    // TEMP diagnostic: GET /api/telegram?diag=1 reports whether the secret env var
    // is present and its length (never the value). If you also send the header
    // x-telegram-bot-api-secret-token, it reports whether that header MATCHES the
    // env var. Remove after debugging.
    if (req.query && req.query.diag === "1") {
      const s = process.env.TELEGRAM_WEBHOOK_SECRET;
      const incoming = req.headers["x-telegram-bot-api-secret-token"];
      res.status(200).json({
        hasSecret: typeof s === "string" && s.length > 0,
        secretLen: typeof s === "string" ? s.length : 0,
        incomingHeaderPresent: typeof incoming === "string",
        incomingHeaderLen: typeof incoming === "string" ? incoming.length : 0,
        headerMatches: typeof s === "string" && incoming === s,
        node: process.version,
      });
      return;
    }
    res.status(200).send("ok");
    return;
  }

  // Webhook secret check.
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    res.status(401).send("unauthorized");
    return;
  }

  const update = req.body || {};

  // Respond 200 fast; Telegram retries on non-2xx.
  try {
    if (update.update_id != null) {
      if (seenUpdates.has(update.update_id)) {
        res.status(200).send("ok");
        return;
      }
      seenUpdates.add(update.update_id);
      if (seenUpdates.size > 1000) seenUpdates.clear();
    }

    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (err) {
    console.error("handler error:", err);
  }

  res.status(200).send("ok");
}

// ---------- allowlist ----------

function allowedChatIds() {
  return (process.env.ALLOWED_CHAT_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowed(chatId) {
  const allow = allowedChatIds();
  if (allow.length === 0) return null; // bootstrap mode
  return allow.includes(String(chatId));
}

// ---------- message handling ----------

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const text = (message.text || "").trim();
  if (!chatId) return;

  const allowed = isAllowed(chatId);
  if (allowed === null) {
    // Bootstrap: reveal chat id so the owner can set ALLOWED_CHAT_ID.
    await sendMessage(chatId, `Your chat ID is ${chatId}`);
    return;
  }
  if (!allowed) return; // silently ignore non-allowlisted chats

  if (!text) return;

  if (text.startsWith("/")) {
    await handleCommand(chatId, text);
    return;
  }

  // Parse free-form expense text.
  const { items, reply } = await parseMessage(text, {
    todayISO: todayISO(),
    tz: TZ,
    defaultCurrency: DEFAULT_CURRENCY,
  });

  if (reply) {
    await sendMessage(chatId, reply);
    return;
  }
  if (!items || items.length === 0) {
    await sendMessage(chatId, "I didn't catch any expense in that. Try e.g. \"coffee 85\".");
    return;
  }

  // Build a human receipt + hidden payload, attach to each item the raw message.
  for (const it of items) it.raw_message = text;

  const lines = items.map((it) => {
    const where = it.category_key && CATEGORIES[it.category_key]
      ? `${CATEGORIES[it.category_key].section} / ${itemLabel(it)}`
      : `${it.section} / ${itemLabel(it)}`;
    const cur = it.currency && it.currency !== DEFAULT_CURRENCY ? ` ${it.currency}` : "";
    const flag = it.needs_clarification ? `  ⚠ ${it.clarification || "needs review"}` : "";
    return `• ${fmtNumber(it.amount)}${cur} → ${where} (${it.date})${flag}`;
  });

  const receipt = `Log this?\n${lines.join("\n")}`;
  const body = receipt + encodePayload(items);
  await sendMessage(chatId, body, { keyboard: CONFIRM_KEYBOARD, html: true });
}

// ---------- commands ----------

async function handleCommand(chatId, text) {
  const cmd = text.split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case "/start":
    case "/help":
      await sendMessage(
        chatId,
        [
          "Budget Bot — text me your expenses and I'll log them.",
          "",
          "Examples:",
          '• "coffee 85"',
          '• "anoos food 612 and litter 440"',
          '• "uber to work 130"',
          '• "farah visa 5700"',
          "",
          "Commands:",
          "/undo — remove the last logged expense",
          "/today — today's total",
          "/month — this month's total expenses",
        ].join("\n")
      );
      return;
    case "/undo":
      await handleUndo(chatId);
      return;
    case "/today":
      await handleToday(chatId);
      return;
    case "/month":
      await handleMonth(chatId);
      return;
    default:
      await sendMessage(chatId, "Unknown command. Try /help.");
  }
}

async function handleUndo(chatId) {
  const last = await readLast();
  if (!last) {
    await sendMessage(chatId, "Nothing to undo.");
    return;
  }
  const cellRef = last.cell_ref;
  const amount = last.amount;
  if (!cellRef) {
    await sendMessage(chatId, "Last entry has no cell reference; cannot undo automatically.");
    return;
  }
  const existing = (await getValues(cellRef, { render: "FORMULA" }))?.[0]?.[0] ?? "";
  const updated = removeLastTerm(existing, amount);
  await updateValue(cellRef, updated === "" ? "" : updated);
  await deleteRow(last._sheetRow);
  await sendMessage(
    chatId,
    `Undone: ${fmtNumber(amount)} from ${last.label || last.category || "expense"} (${cellRef}).`
  );
}

async function handleToday(chatId) {
  const { total, count } = await sumForDate(todayISO());
  await sendMessage(chatId, `Today: ${fmtNumber(total)} ${DEFAULT_CURRENCY} across ${count} entr${count === 1 ? "y" : "ies"}.`);
}

async function handleMonth(chatId) {
  const tab = tabNameForDate(todayISO());
  const total = await readMonthTotal(tab);
  if (total == null) {
    await sendMessage(chatId, `Couldn't read the total for ${tab}.`);
    return;
  }
  await sendMessage(chatId, `${tab} total expenses: ${fmtNumber(total)} ${DEFAULT_CURRENCY}.`);
}

/** Locate the bottom TOTAL row in the expenses block and read its computed col-I value. */
async function readMonthTotal(tab) {
  const gValues = await getValues(`'${tab}'!G1:G80`, { render: "UNFORMATTED_VALUE" });
  let totalRow = null;
  for (let i = 0; i < gValues.length; i++) {
    const cell = gValues[i] && gValues[i][0];
    if (cell == null) continue;
    if (/^total/i.test(String(cell).trim())) totalRow = i + 1; // take the last TOTAL match
  }
  if (!totalRow) return null;
  const v = (await getValues(`'${tab}'!I${totalRow}`, { render: "UNFORMATTED_VALUE" }))?.[0]?.[0];
  return v == null ? null : Number(v);
}

// ---------- callback (confirm / cancel) ----------

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const messageText = cb.message?.text || "";
  const data = cb.data;

  if (!chatId) {
    await answerCallbackQuery(cb.id);
    return;
  }

  const allowed = isAllowed(chatId);
  if (allowed === false) {
    await answerCallbackQuery(cb.id);
    return;
  }

  if (data === "cancel") {
    await editMessageText(chatId, messageId, "Cancelled.");
    await answerCallbackQuery(cb.id, "Cancelled");
    return;
  }

  if (data !== "confirm") {
    await answerCallbackQuery(cb.id);
    return;
  }

  // Idempotency: if the payload is gone, this was already logged.
  if (!hasPayload(messageText)) {
    await answerCallbackQuery(cb.id, "Already logged");
    return;
  }

  const items = decodePayload(messageText);
  if (!items || items.length === 0) {
    await answerCallbackQuery(cb.id, "Already logged");
    return;
  }

  await ensureLedger();

  const results = [];
  for (const item of items) {
    try {
      const r = await writeItem(item);
      results.push(r);
    } catch (err) {
      console.error("writeItem error:", err);
      results.push({ ok: false, label: itemLabel(item), error: err.message });
    }
  }

  const lines = results.map((r) => {
    if (!r.ok) return `• ⚠ ${r.label}: ${r.error}`;
    return `• ${r.label} is now ${fmtNumber(r.newTotal)}`;
  });
  const receipt = `logged ✓\n${lines.join("\n")}`;
  // Edit WITHOUT payload + WITHOUT keyboard → idempotent.
  await editMessageText(chatId, messageId, receipt);
  await answerCallbackQuery(cb.id, "Logged");
}

/** Resolve + write a single item to the formula cell and the ledger. Returns a result. */
async function writeItem(item) {
  const tab = tabNameForDate(item.date || todayISO());

  // Verify the target tab exists by attempting resolution (resolve reads from it).
  const resolved = await resolveTargetCell(tab, item);
  if (resolved.error) {
    return { ok: false, label: itemLabel(item), error: resolved.error };
  }
  const cellRef = resolved.cellRef;

  // Read current formula, append amount, write back (USER_ENTERED).
  // Freeform 'created' rows already hold =(amount); skip re-appending in that case.
  let newFormula;
  if (resolved.created) {
    newFormula = `=(${item.amount})`;
  } else {
    const existing = (await getValues(cellRef, { render: "FORMULA" }))?.[0]?.[0] ?? "";
    newFormula = appendAmount(existing, item.amount);
    await updateValue(cellRef, newFormula);
  }

  // Read back the computed total for the receipt.
  const computed = (await getValues(cellRef, { render: "UNFORMATTED_VALUE" }))?.[0]?.[0];

  // Ledger row.
  await appendTransaction({
    date: item.date || todayISO(),
    amount: item.amount,
    currency: item.currency || DEFAULT_CURRENCY,
    section:
      item.category_key && CATEGORIES[item.category_key]
        ? CATEGORIES[item.category_key].section
        : item.section || "",
    category: item.category_key || "",
    label:
      item.category_key && CATEGORIES[item.category_key]
        ? CATEGORIES[item.category_key].label
        : item.label || "",
    note: item.note || "",
    raw_message: item.raw_message || "",
    source: "telegram",
    tab,
    cell_ref: cellRef,
  });

  return { ok: true, label: itemLabel(item), newTotal: computed ?? item.amount };
}
