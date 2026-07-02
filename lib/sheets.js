import { JWT } from "google-auth-library";

const SHEET_ID = process.env.SHEET_ID;
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

let _client = null;

/**
 * Build (and cache) a JWT client from the service-account JSON env var.
 * google-auth-library handles access-token fetch + refresh internally.
 */
function getClient() {
  if (_client) return _client;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const creds = JSON.parse(raw);
  _client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return _client;
}

async function authHeader() {
  const client = getClient();
  const { token } = await client.getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

async function sheetsFetch(url, options = {}) {
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API ${res.status}: ${body}`);
  }
  return res.json();
}

const enc = (range) => encodeURIComponent(range);

/**
 * Read a range. render = "FORMULA" (to append) | "UNFORMATTED_VALUE" (to report).
 * Returns the raw `values` 2-D array (or []).
 */
export async function getValues(range, { render = "UNFORMATTED_VALUE" } = {}) {
  const url = `${BASE}/values/${enc(range)}?valueRenderOption=${render}`;
  const data = await sheetsFetch(url);
  return data.values || [];
}

/** Read multiple ranges in one call (values:batchGet). Returns an array of `values` 2-D arrays. */
export async function getValuesBatch(ranges, { render = "UNFORMATTED_VALUE" } = {}) {
  const qs = ranges.map((r) => `ranges=${enc(r)}`).join("&");
  const url = `${BASE}/values:batchGet?${qs}&valueRenderOption=${render}`;
  const data = await sheetsFetch(url);
  return (data.valueRanges || []).map((vr) => vr.values || []);
}

/** Write a single value into a single cell (USER_ENTERED so formulas interpret). */
export async function updateValue(range, value) {
  const url = `${BASE}/values/${enc(range)}?valueInputOption=USER_ENTERED`;
  return sheetsFetch(url, {
    method: "PUT",
    body: JSON.stringify({ values: [[value]] }),
  });
}

/** Write multiple cells at once via batch values update (USER_ENTERED). */
export async function updateValues(updates) {
  const url = `${BASE}/values:batchUpdate`;
  return sheetsFetch(url, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
    }),
  });
}

/** Append a row to the bottom of a tab's data. */
export async function appendRow(tab, row) {
  const range = `${tab}!A1`;
  const url =
    `${BASE}/values/${enc(range)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  return sheetsFetch(url, {
    method: "POST",
    body: JSON.stringify({ values: [row] }),
  });
}

/** Spreadsheet metadata: sheet titles + ids (needed for insert/deleteDimension). */
export async function getMeta() {
  const url = `${BASE}?fields=sheets.properties(sheetId,title)`;
  return sheetsFetch(url);
}

/** Map tab title → numeric sheetId. */
export async function getSheetId(title) {
  const meta = await getMeta();
  const sheet = (meta.sheets || []).find((s) => s.properties.title === title);
  return sheet ? sheet.properties.sheetId : null;
}

/** Run arbitrary batchUpdate requests (addSheet, insertDimension, deleteDimension…). */
export async function batchUpdate(requests) {
  const url = `${BASE}:batchUpdate`;
  return sheetsFetch(url, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}
