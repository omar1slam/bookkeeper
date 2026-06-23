// Foreign-currency → EGP conversion using a free, keyless daily-rate API.
// Source: open.er-api.com (supports EGP). Rates are cached per source currency
// within a warm serverless instance to avoid refetching on every message.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const _cache = new Map(); // CUR -> { rate, fetchedAt }

// Common symbols → ISO codes so "$", "€", "£" resolve.
const SYMBOL_MAP = {
  $: "USD",
  "US$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₺": "TRY",
  "ج.م": "EGP",
  "egp": "EGP",
  "le": "EGP",
};

/** Normalize a currency token to an ISO-4217-ish uppercase code. */
export function normalizeCurrency(currency) {
  if (!currency) return "EGP";
  const raw = String(currency).trim();
  if (SYMBOL_MAP[raw]) return SYMBOL_MAP[raw];
  if (SYMBOL_MAP[raw.toLowerCase()]) return SYMBOL_MAP[raw.toLowerCase()];
  return raw.toUpperCase();
}

async function getRateToEgp(currency) {
  const cur = normalizeCurrency(currency);
  if (cur === "EGP") return 1;

  const cached = _cache.get(cur);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rate;
  }

  const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(cur)}`);
  if (!res.ok) throw new Error(`FX API ${res.status}`);
  const data = await res.json();
  if (data.result !== "success" || !data.rates || typeof data.rates.EGP !== "number") {
    throw new Error(`no EGP rate for ${cur}`);
  }
  const rate = data.rates.EGP; // EGP per 1 unit of `cur`
  _cache.set(cur, { rate, fetchedAt: Date.now() });
  return rate;
}

/**
 * Convert `amount` of `currency` into EGP at today's rate.
 * Returns { egpAmount, rate, currency } where egpAmount is rounded to 2 decimals
 * and returned as a Number. Throws if the rate can't be fetched.
 */
export async function convertToEgp(amount, currency) {
  const cur = normalizeCurrency(currency);
  const n = Number(amount);
  if (!isFinite(n)) throw new Error("invalid amount");
  if (cur === "EGP") return { egpAmount: n, rate: 1, currency: "EGP" };

  const rate = await getRateToEgp(cur);
  const egpAmount = Math.round(n * rate * 100) / 100;
  return { egpAmount, rate, currency: cur };
}
