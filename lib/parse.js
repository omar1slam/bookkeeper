import { CATEGORIES } from "./categories.js";

// ---------------------------------------------------------------------------
// Merchant / shorthand hints. EDIT THIS to teach the parser the shops and
// abbreviations you use. Each line maps merchants → an existing category_key
// from categories.js. Ambiguous merchants are noted; pick a sensible default.
// ---------------------------------------------------------------------------
const MERCHANT_HINTS = [
  "Merchant and shorthand hints (merchant -> category_key):",
  "Groceries: carrefour, spinneys, seoudi, gourmet, metro, kazyon, hyper one, rabbit, instashop, breadfast, oscar, fresh, awlad ragab -> groceries.",
  "Food delivery / ordering in: talabat, elmenus, mrsool, otlob -> ordering_in. (talabat is ambiguous: if the message says 'talabat groceries' treat as groceries.)",
  "Coffee shops: starbucks, costa, tbs, cilantro, arabica, % arabica, dose, beanos, espresso lab, brew, joffrey -> coffee.",
  "Dining / going out: mcdonalds, mac, kfc, hardees, buffalo burger, zooba, abou tarek, gad, bazooka, smoking bary, ovio, kazoku -> dining_out.",
  "Fuel stations: wataniya, mobil, total, totalenergies, chillout, misr petroleum, gas station, banzina -> fuel.",
  "Ride / transport: uber, careem, didi, indrive, swvl, mwasalat, taxi, scooter, parking, garage -> uber_parking.",
  "Mobile / phone bills: vodafone, orange, etisalat, e&, we (mobile), fawry recharge -> phone.",
  "Home internet: te data, we internet, link, noor, vodafone dsl, orange home -> home_internet.",
  "Pharmacy / health: el ezaby, seif, roshdy, 19011, misr pharmacy, dawaya, sehaty, doctor, clinic, lab, mokhtabar, borg, alfa labs -> health_medicine.",
  "Subscriptions: netflix, spotify, anghami, shahid, osn, watch it, youtube premium, icloud, google one, chatgpt, claude, openai, disney -> subscriptions.",
  "Cinema / shows: vox, renaissance, cinema, imax, el sawy, concert, ticket -> concerts_movies.",
  "Clothing: zara, h&m, hm, lc waikiki, max, defacto, american eagle, shein, town team -> clothing.",
  "Pet (cats Zaatar): vet, baytar, pets corner, purina, royal canin, litter, cat food, pet shop -> pet_supplies.",
  "Pokemon: etb, booster, box, prismatic, pokemon, tcg, pokeball, cards -> pokemon_tcg.",
].join("\n");

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
    MERCHANT_HINTS,
    "",
    'If a purchase is a one-off gift/fee/admin item that does not fit a fixed category, use category_key: null, section: "One time payments", and put a short human label in label.',
    'For trips/holidays use section: "VACATION".',
    "",
    "Default currency EGP; default date is today (provided in the user block, in the given timezone). Honor relative dates like yesterday or 'on the 3rd'. Split multi-item messages into multiple entries. If unsure of the category, set needs_clarification: true with a brief clarification question. Never invent amounts.",
    'If the user states a non-EGP currency (USD, $, EUR, €, GBP, £, etc.), set currency to the ISO code and keep amount as the stated foreign value. Do NOT convert and do NOT set needs_clarification for currency — the app converts to EGP automatically.',
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
    'Input: "zaatar food 612 and litter 440" -> two items, both category_key "pet_supplies" (612 note "food", 440 note "litter").',
    'Input: "2 prismatic ETBs 9711" -> {"category_key":"pokemon_tcg","amount":9711,"note":"2 Prismatic ETBs"}.',
    'Input: "uber to work 130" -> {"category_key":"uber_parking","amount":130}.',
    'Input: "talabat 240" -> {"category_key":"ordering_in","amount":240,"note":"Talabat"}.',
    'Input: "carrefour 1300" -> {"category_key":"groceries","amount":1300,"note":"Carrefour"}.',
    'Input: "starbucks 130" -> {"category_key":"coffee","amount":130,"note":"Starbucks"}.',
    'Input: "vodafone fatoura 400" -> {"category_key":"phone","amount":400,"note":"Vodafone bill"}.',
    'Input: "netflix 199" -> {"category_key":"subscriptions","amount":199,"note":"Netflix"}.',
    'Input: "el ezaby 250" -> {"category_key":"health_medicine","amount":250,"note":"El Ezaby pharmacy"}.',
    'Input: "farah visa service 5700" -> {"category_key":null,"section":"One time payments","label":"Farah\'s Visa Service","amount":5700}.',
    'Input: "groceries 300 yesterday" -> {"category_key":"groceries","amount":300,"date":"<yesterday>"}.',
    'Input: "prismatic box 186.89 usd" -> {"category_key":"pokemon_tcg","amount":186.89,"currency":"USD","note":"Prismatic box"}.',
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
