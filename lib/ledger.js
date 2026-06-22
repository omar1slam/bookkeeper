import { getMeta, batchUpdate, appendRow, getValues, getSheetId } from "./sheets.js";

const LEDGER_TAB = "Transactions";
const HEADER = [
  "txn_id",
  "logged_at",
  "date",
  "amount",
  "currency",
  "section",
  "category",
  "label",
  "note",
  "raw_message",
  "source",
  "tab",
  "cell_ref",
];

/** Create the Transactions tab + header row if it doesn't already exist (idempotent). */
export async function ensureLedger() {
  const meta = await getMeta();
  const exists = (meta.sheets || []).some((s) => s.properties.title === LEDGER_TAB);
  if (exists) return;
  await batchUpdate([{ addSheet: { properties: { title: LEDGER_TAB } } }]);
  await appendRow(LEDGER_TAB, HEADER);
}

function newTxnId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append a transaction row. `entry` carries the structured fields; returns the txn_id.
 */
export async function appendTransaction(entry) {
  await ensureLedger();
  const txnId = entry.txn_id || newTxnId();
  const row = [
    txnId,
    entry.logged_at || new Date().toISOString(),
    entry.date || "",
    entry.amount ?? "",
    entry.currency || "",
    entry.section || "",
    entry.category || "",
    entry.label || "",
    entry.note || "",
    entry.raw_message || "",
    entry.source || "telegram",
    entry.tab || "",
    entry.cell_ref || "",
  ];
  await appendRow(LEDGER_TAB, row);
  return txnId;
}

/** Read all ledger data rows (excluding header) as arrays. */
export async function readAllRows() {
  const values = await getValues(`'${LEDGER_TAB}'!A1:M5000`, { render: "UNFORMATTED_VALUE" });
  if (values.length <= 1) return [];
  return values.slice(1);
}

const COL = {
  txn_id: 0,
  logged_at: 1,
  date: 2,
  amount: 3,
  currency: 4,
  section: 5,
  category: 6,
  label: 7,
  note: 8,
  raw_message: 9,
  source: 10,
  tab: 11,
  cell_ref: 12,
};

/** Map a data row array to an object. Carries its 1-based sheet row number. */
function toObject(rowArr, sheetRow) {
  const o = {};
  for (const [k, i] of Object.entries(COL)) o[k] = rowArr[i];
  o._sheetRow = sheetRow; // 1-based
  return o;
}

/** Return the last (most recent) transaction as an object, or null. */
export async function readLast() {
  const rows = await readAllRows();
  if (rows.length === 0) return null;
  const sheetRow = rows.length + 1; // +1 for header (header is sheet row 1)
  return toObject(rows[rows.length - 1], sheetRow);
}

/** Delete a ledger row by its 1-based sheet row number. */
export async function deleteRow(sheetRow) {
  const sheetId = await getSheetId(LEDGER_TAB);
  if (sheetId == null) throw new Error("Transactions sheetId not found");
  const start0 = sheetRow - 1; // 0-based
  await batchUpdate([
    {
      deleteDimension: {
        range: { sheetId, dimension: "ROWS", startIndex: start0, endIndex: start0 + 1 },
      },
    },
  ]);
}

/** Sum amounts of rows whose date column equals the given YYYY-MM-DD. */
export async function sumForDate(dateISO) {
  const rows = await readAllRows();
  let total = 0;
  let count = 0;
  for (const r of rows) {
    if (String(r[COL.date]) === dateISO) {
      total += Number(r[COL.amount]) || 0;
      count += 1;
    }
  }
  return { total, count };
}
