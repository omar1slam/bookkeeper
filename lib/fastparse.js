// Zero-LLM fast path for trivial messages like "coffee 85" or "130 uber".
// Conservative by design: anything ambiguous returns null and falls through
// to the LLM parser. Saves the Anthropic call entirely for common logs.

import { CATEGORIES, normalizeLabel } from "./categories.js";

// Normalized phrase → { category_key, note? }. Phrases must match the ENTIRE
// non-amount remainder of the message. Only unambiguous words/merchants belong
// here (e.g. "total" the fuel station is omitted — it collides with the word).
export const FAST_SYNONYMS = {
  // coffee
  coffee: { category_key: "coffee" },
  starbucks: { category_key: "coffee", note: "Starbucks" },
  costa: { category_key: "coffee", note: "Costa" },
  cilantro: { category_key: "coffee", note: "Cilantro" },
  tbs: { category_key: "coffee", note: "TBS" },
  beanos: { category_key: "coffee", note: "Beanos" },
  // groceries
  groceries: { category_key: "groceries" },
  carrefour: { category_key: "groceries", note: "Carrefour" },
  spinneys: { category_key: "groceries", note: "Spinneys" },
  seoudi: { category_key: "groceries", note: "Seoudi" },
  kazyon: { category_key: "groceries", note: "Kazyon" },
  gourmet: { category_key: "groceries", note: "Gourmet" },
  breadfast: { category_key: "groceries", note: "Breadfast" },
  instashop: { category_key: "groceries", note: "InstaShop" },
  "hyper one": { category_key: "groceries", note: "Hyper One" },
  // ordering in
  talabat: { category_key: "ordering_in", note: "Talabat" },
  elmenus: { category_key: "ordering_in", note: "Elmenus" },
  mrsool: { category_key: "ordering_in", note: "Mrsool" },
  "ordering in": { category_key: "ordering_in" },
  // dining out
  mcdonalds: { category_key: "dining_out", note: "McDonald's" },
  kfc: { category_key: "dining_out", note: "KFC" },
  hardees: { category_key: "dining_out", note: "Hardee's" },
  zooba: { category_key: "dining_out", note: "Zooba" },
  "dining out": { category_key: "dining_out" },
  // fuel
  fuel: { category_key: "fuel" },
  banzina: { category_key: "fuel" },
  wataniya: { category_key: "fuel", note: "Wataniya" },
  mobil: { category_key: "fuel", note: "Mobil" },
  // transport
  uber: { category_key: "uber_parking", note: "Uber" },
  careem: { category_key: "uber_parking", note: "Careem" },
  taxi: { category_key: "uber_parking", note: "Taxi" },
  parking: { category_key: "uber_parking", note: "Parking" },
  indrive: { category_key: "uber_parking", note: "inDrive" },
  swvl: { category_key: "uber_parking", note: "Swvl" },
  didi: { category_key: "uber_parking", note: "DiDi" },
  // phone
  vodafone: { category_key: "phone", note: "Vodafone" },
  etisalat: { category_key: "phone", note: "Etisalat" },
  // "orange" omitted: collides with the fruit (groceries)
  // health
  pharmacy: { category_key: "health_medicine", note: "Pharmacy" },
  ezaby: { category_key: "health_medicine", note: "El Ezaby" },
  "el ezaby": { category_key: "health_medicine", note: "El Ezaby" },
  seif: { category_key: "health_medicine", note: "Seif" },
  medicine: { category_key: "health_medicine" },
  // subscriptions
  netflix: { category_key: "subscriptions", note: "Netflix" },
  spotify: { category_key: "subscriptions", note: "Spotify" },
  anghami: { category_key: "subscriptions", note: "Anghami" },
  icloud: { category_key: "subscriptions", note: "iCloud" },
  // entertainment
  cinema: { category_key: "concerts_movies", note: "Cinema" },
  vox: { category_key: "concerts_movies", note: "VOX" },
  // clothing
  clothing: { category_key: "clothing" },
  clothes: { category_key: "clothing" },
  zara: { category_key: "clothing", note: "Zara" },
  shein: { category_key: "clothing", note: "Shein" },
  defacto: { category_key: "clothing", note: "DeFacto" },
  // pets
  vet: { category_key: "pet_supplies", note: "Vet" },
  litter: { category_key: "pet_supplies", note: "Litter" },
  "cat food": { category_key: "pet_supplies", note: "Cat food" },
  purina: { category_key: "pet_supplies", note: "Purina" },
  "royal canin": { category_key: "pet_supplies", note: "Royal Canin" },
  // misc fixed
  gym: { category_key: "gym" },
  electricity: { category_key: "electricity" },
  cleaning: { category_key: "cleaning" },
  tips: { category_key: "tips" },
  tip: { category_key: "tips" },
  barber: { category_key: "salon_barber", note: "Barber" },
  salon: { category_key: "salon_barber", note: "Salon" },
  haircut: { category_key: "salon_barber", note: "Haircut" },
};

const DATE_WORDS = new Set([
  "yesterday", "today", "tomorrow", "last", "ago", "on",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

const AMOUNT_RE = /^\d{1,7}(\.\d{1,2})?$/;

/**
 * Parse a trivial "<phrase> <amount>" / "<amount> <phrase>" message locally.
 * Returns the same shape as parseMessage ({ items, reply }) or null to
 * fall through to the LLM.
 */
export function fastParse(text, { todayISO, defaultCurrency = "EGP", vacationAlias = null } = {}) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 40 || /[\r\n]/.test(raw)) return null;
  if (/[,&+]/.test(raw)) return null; // multi-item messages

  const tokens = raw.split(/\s+/);
  const lower = tokens.map((t) => t.toLowerCase());
  if (lower.some((t) => DATE_WORDS.has(t) || /^\d+(st|nd|rd|th)$/.test(t))) return null;
  if (lower.includes("and") || lower.includes("w")) return null;
  if (vacationAlias && lower.includes(normalizeLabel(vacationAlias))) return null;

  // Exactly one numeric-looking token, at either end, matching the strict amount pattern.
  const numberish = tokens.filter((t) => /\d/.test(t));
  if (numberish.length !== 1) return null;
  let amountToken;
  let phraseTokens;
  if (AMOUNT_RE.test(tokens[tokens.length - 1])) {
    amountToken = tokens[tokens.length - 1];
    phraseTokens = tokens.slice(0, -1);
  } else if (AMOUNT_RE.test(tokens[0])) {
    amountToken = tokens[0];
    phraseTokens = tokens.slice(1);
  } else {
    return null; // amount carries currency/commas/etc — let the LLM handle it
  }
  if (numberish[0] !== amountToken) return null;
  const amount = Number(amountToken);
  if (!(amount > 0)) return null;
  if (phraseTokens.length === 0) return null;

  const entry = FAST_SYNONYMS[normalizeLabel(phraseTokens.join(" "))];
  if (!entry) return null;
  const cat = CATEGORIES[entry.category_key];
  if (!cat) return null;

  return {
    items: [
      {
        amount,
        currency: defaultCurrency,
        section: cat.section,
        category_key: entry.category_key,
        label: null,
        date: todayISO,
        note: entry.note ?? null,
        confidence: 1,
        needs_clarification: false,
        clarification: null,
      },
    ],
    reply: null,
  };
}
