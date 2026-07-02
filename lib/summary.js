// Month-tab summary shared by /status, /month, /trip and the weekly digest.
// Column layout per monthly tab: G = labels/headers, H = BUDGET, I = ACTUAL formulas.

import { getValues, getValuesBatch } from "./sheets.js";
import { parseLayout } from "./resolve.js";
import { fmtNumber } from "./dates.js";

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Compute a month summary from raw column data (pure, testable).
 * gValues/iFormulaValues are the G1:G80 (UNFORMATTED) and I1:I80 (FORMULA) reads;
 * hiValues is the H1:I80 UNFORMATTED read (budget + computed actual per row).
 */
export function computeSummary(tabName, gValues, iFormulaValues, hiValues) {
  const layout = parseLayout(gValues, iFormulaValues);
  const hi = (row) => hiValues[row - 1] || [];

  const sections = [];
  for (const [name, s] of Object.entries(layout.sections)) {
    if (!s.subtotalRow) continue;
    const [h, i] = hi(s.subtotalRow);
    const actual = num(i) ?? 0;
    const budget = num(h);
    sections.push({
      name,
      alias: s.alias ?? null,
      subtotalRow: s.subtotalRow,
      actual,
      budget,
      over: budget != null && actual > budget,
    });
  }

  // TOTAL = last col-G cell matching /^total/i (same rule the /month command used).
  let total = null;
  for (const { row, label } of layout.gRows) {
    if (/^total/i.test(String(label).trim())) {
      const [h, i] = hi(row);
      total = { actual: num(i) ?? 0, budget: num(h), row };
    }
  }

  // Vacation detail rows (between header and subtotal).
  let vacation = null;
  const vac = layout.sections.VACATION;
  if (vac) {
    const limit = vac.subtotalRow || vac.endRow + 1;
    const rows = [];
    for (const { row, label } of layout.gRows) {
      if (row <= vac.headerRow || row >= limit) continue;
      rows.push({ label, amount: num(hi(row)[1]) ?? 0, row });
    }
    const totalAmount = vac.subtotalRow
      ? num(hi(vac.subtotalRow)[1]) ?? 0
      : rows.reduce((sum, r) => sum + r.amount, 0);
    vacation = { alias: vac.alias ?? null, rows, total: totalAmount };
  }

  return { tab: tabName, sections, total, vacation };
}

/** Fetch G/H/I for a tab and compute its summary. Throws if the tab is missing. */
export async function readMonthSummary(tabName) {
  const [gValues, hiValues] = await getValuesBatch(
    [`'${tabName}'!G1:G80`, `'${tabName}'!H1:I80`],
    { render: "UNFORMATTED_VALUE" }
  );
  const iFormulaValues = await getValues(`'${tabName}'!I1:I80`, { render: "FORMULA" });
  return computeSummary(tabName, gValues, iFormulaValues, hiValues);
}

/** Render per-section Telegram lines. showBudget adds "actual / budget" + over flags. */
export function summaryLines(summary, { showBudget = true } = {}) {
  return summary.sections.map((s) => {
    const name = s.alias ? `${s.name} – ${capitalize(s.alias)}` : s.name;
    let line = `${name}: ${fmtNumber(s.actual)}`;
    if (showBudget && s.budget != null) {
      line += ` / ${fmtNumber(s.budget)}`;
      if (s.over) line += ` ⚠ over by ${fmtNumber(s.actual - s.budget)}`;
    }
    return line;
  });
}
