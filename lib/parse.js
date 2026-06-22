import { CATEGORIES } from "./categories.js";

// Build the "key → meaning" list injected into the system prompt from CATEGORIES.
function categoryListText() {
  return Object.entries(CATEGORIES)
    .map(([key, { label, section }]) => `${key} = ${label} (${section})`)
    .join("; ");
}

function buildSystemPrompt() {
  return [
    "You are a budgeting parser for a personal expense tracker. Convert the user's message into structured expense entries.",
    "The user writes in English and transliterated Egyptian Arabic (Franco).",
    "Output STRICT JSON only matching the schema below — no prose, no code fences.",
    "",
    "Map each purchase to exactly one category_key from this list (key = meaning (section)):",
    categoryListText(),
    "",
    'If a purchase is a one-off gift/fee/admin item that does not fit a fixed category, use category_key: null, section: "One time payments", and put a short human label in label.',
    'For trips/holidays use section: "VACATION".',
    "",
    "Default currency EGP; default date is today (provided in the user block, in the given timezone). Honor relative dates like yesterday or 'on the 3rd'. Split multi-item messages into multiple entries. If unsure of the category, set needs_clarification: true with a brief clarification question. Never invent amounts.",
    'If the user states USD or $, set currency accordingly, keep amount as the stated value, and set needs_clarification: true with a clarification asking for the EGP amount (do not convert).',
    "",
    "Schema (return exactly this shape):",
    JSON.stringify(
      {
        items: [
          {
            amount: 0,
            currency: "EGP",
            section: "DAILY LIVING",
            category_key: "coffee",
            label: null,
            date: "YYYY-MM-DD",
            note: "",
            confidence: 0.0,
            needs_clarification: false,
            clarification: null,
          },
        ],
        reply: null,
      },
      null,
      0
    ),
    "",
    "Examples:",
    'Input: "coffee 85" -> {"items":[{"amount":85,"currency":"EGP","section":"DAILY LIVING","category_key":"coffee","label":null,"date":"<today>","note":null,"confidence":0.97,"needs_clarification":false,"clarification":null}],"reply":null}',
    'Input: "anoos food 612 and litter 440" -> two items, both category_key "pet_supplies" (612 note "food", 440 note "litter").',
    'Input: "2 prismatic ETBs 9711" -> {"category_key":"pokemon_tcg","amount":9711,"note":"2 Prismatic ETBs"}.',
    'Input: "uber to work 130" -> {"category_key":"uber_parking","amount":130}.',
    'Input: "farah visa service 5700" -> {"category_key":null,"section":"One time payments","label":"Farah\'s Visa Service","amount":5700}.',
    'Input: "groceries 300 yesterday" -> {"category_key":"groceries","amount":300,"date":"<yesterday>"}.',
    'Input: "prismatic box 186.89 usd" -> {"category_key":"pokemon_tcg","amount":186.89,"currency":"USD","needs_clarification":true,"clarification":"What is the EGP amount for the Prismatic box?"}.',
  ].join("\n");
}

function buildUserBlock(text, todayISO, tz) {
  return `Today: ${todayISO} (${tz})\nMessage: ${text}`;
}

/** Strip accidental markdown fences and parse JSON. */
function parseJsonStrict(raw) {
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // If there is leading/trailing prose, try to extract the outermost JSON object.
  if (!s.startsWith("{")) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}

async function callAnthropic(system, user) {
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function callGemini(system, user) {
  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("");
}

/**
 * Parse a free-form message into structured items.
 * Returns { items: [...], reply? } or { items: [], reply: <error message> } on failure.
 */
export async function parseMessage(text, { todayISO, tz, defaultCurrency = "EGP" } = {}) {
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  const system = buildSystemPrompt();
  const user = buildUserBlock(text, todayISO, tz);

  let rawText;
  try {
    rawText = provider === "gemini" ? await callGemini(system, user) : await callAnthropic(system, user);
  } catch (err) {
    return { items: [], reply: `Sorry, the parser is unavailable right now. (${err.message})` };
  }

  let parsed;
  try {
    parsed = parseJsonStrict(rawText);
  } catch {
    return { items: [], reply: "I couldn't understand that. Could you rephrase? e.g. \"coffee 85\"." };
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  // Apply defaults defensively.
  for (const it of items) {
    if (!it.currency) it.currency = defaultCurrency;
    if (!it.date) it.date = todayISO;
  }
  return { items, reply: parsed.reply ?? null };
}
