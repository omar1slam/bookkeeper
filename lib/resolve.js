import { getValues, getSheetId, batchUpdate, updateValues } from "./sheets.js";
import { CATEGORIES, SECTION_HEADERS, normalizeLabel, canonicalizeLabel } from "./categories.js";

/**
 * Match a col-G cell against the known section headers.
 * Returns { name, alias } or null. The VACATION header may carry a custom
 * suffix naming the current trip (e.g. "VACATION - Sahel" → alias "sahel");
 * the cell must still START with "vacation" to be detected as the section.
 */
export function matchesHeader(label) {
  const norm = normalizeLabel(label);
  for (const header of SECTION_HEADERS) {
    if (header === "VACATION") {
      if (norm.startsWith("vacation")) {
        const alias = norm
          .slice("vacation".length)
          .replace(/[—–:()[\]-]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return { name: "VACATION", alias: alias || null };
      }
    } else if (norm === normalizeLabel(header)) {
      return { name: header, alias: null };
    }
  }
  return null;
}

/**
 * Compute section ranges from raw col-G values and col-I formulas (pure, testable).
 * Returns { gRows: [{row,label}], sections: { NAME: {headerRow, startRow, endRow, subtotalRow, alias} } }
 * Rows are 1-based (sheet rows).
 */
export function parseLayout(gValues, iValues) {
  const gRows = [];
  const headers = []; // { row, name, alias }
  for (let i = 0; i < gValues.length; i++) {
    const cell = gValues[i] && gValues[i][0];
    if (cell == null || String(cell).trim() === "") continue;
    const row = i + 1;
    const label = String(cell);
    gRows.push({ row, label });
    const match = matchesHeader(label);
    if (match) headers.push({ row, name: match.name, alias: match.alias });
  }

  const iFormula = (row) => {
    const v = iValues[row - 1] && iValues[row - 1][0];
    return v == null ? "" : String(v);
  };

  const sections = {};
  for (let h = 0; h < headers.length; h++) {
    const header = headers[h];
    const next = headers[h + 1];
    const startRow = header.row + 1;
    const endRow = next ? next.row - 1 : 80;
    // Subtotal = first row in range whose col-I formula starts with =SUM(
    let subtotalRow = null;
    for (let r = startRow; r <= endRow; r++) {
      if (/^=SUM\(/i.test(iFormula(r))) {
        subtotalRow = r;
        break;
      }
    }
    sections[header.name] = { headerRow: header.row, startRow, endRow, subtotalRow, alias: header.alias };
  }

  return { gRows, sections, iFormula };
}

/** Read col G + col I (formulas) of a tab and compute section ranges. */
async function readLayout(tabName) {
  const gValues = await getValues(`'${tabName}'!G1:G80`, { render: "UNFORMATTED_VALUE" });
  const iValues = await getValues(`'${tabName}'!I1:I80`, { render: "FORMULA" });
  return parseLayout(gValues, iValues);
}

/**
 * Resolve the target cell for an item.
 * Returns { cellRef, rowIndex } on success, or { error } on failure.
 * For freeform items it may create a new labeled row (writing label + placeholder)
 * and returns { cellRef, rowIndex, created: true }.
 */
export async function resolveTargetCell(tabName, item) {
  const layout = await readLayout(tabName);

  // --- Fixed-label items ---
  if (item.category_key) {
    const cat = CATEGORIES[item.category_key];
    if (!cat) return { error: `unknown category "${item.category_key}"` };
    const section = layout.sections[cat.section];
    if (!section) return { error: `no ${cat.section} section in ${tabName}` };

    const target = canonicalizeLabel(cat.label);
    for (const { row, label } of layout.gRows) {
      if (row <= section.headerRow) continue;
      if (section.subtotalRow && row >= section.subtotalRow) continue;
      if (row > section.endRow) continue;
      if (canonicalizeLabel(label) === target) {
        return { cellRef: `'${tabName}'!I${row}`, rowIndex: row };
      }
    }
    return { error: `no ${cat.label} row in ${tabName}` };
  }

  // --- Freeform items (one_time / vacation) ---
  const sectionName = resolveFreeformSection(item.section, layout.sections);
  if (!sectionName) return { error: `unknown freeform section "${item.section}"` };
  const resolvedSection = layout.sections[sectionName];
  if (!resolvedSection) return { error: `no ${sectionName} section in ${tabName}` };
  if (!item.label) return { error: `freeform item missing label` };

  const limit = resolvedSection.subtotalRow || resolvedSection.endRow + 1;

  // Reuse an existing row (exact or prefix label match) instead of creating a duplicate.
  const found = findFreeformRow(layout.gRows, resolvedSection, item.label);
  if (found) {
    return {
      cellRef: `'${tabName}'!I${found.row}`,
      rowIndex: found.row,
      matchedLabel: found.label,
      labelRemainder: found.remainder,
    };
  }

  // Find first empty col-G row between header and subtotal.
  const used = new Set(layout.gRows.map((r) => r.row));
  for (let r = resolvedSection.startRow; r < limit; r++) {
    if (!used.has(r)) {
      await updateValues([
        { range: `'${tabName}'!G${r}`, value: item.label },
        { range: `'${tabName}'!I${r}`, value: `=(${item.amount})` },
      ]);
      return { cellRef: `'${tabName}'!I${r}`, rowIndex: r, created: true };
    }
  }

  // No empty slot → insert a dimension inside the SUM range so the subtotal auto-extends.
  if (!resolvedSection.subtotalRow) {
    return { error: `no subtotal row found for ${sectionName} in ${tabName}` };
  }
  const sheetId = await getSheetId(tabName);
  if (sheetId == null) return { error: `cannot resolve sheetId for ${tabName}` };
  const insertAt0 = resolvedSection.subtotalRow - 1; // 0-based; insert just above subtotal, inside range
  await batchUpdate([
    {
      insertDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: insertAt0,
          endIndex: insertAt0 + 1,
        },
        inheritFromBefore: true,
      },
    },
  ]);
  const newRow = resolvedSection.subtotalRow; // the inserted row now occupies the old subtotal index
  await updateValues([
    { range: `'${tabName}'!G${newRow}`, value: item.label },
    { range: `'${tabName}'!I${newRow}`, value: `=(${item.amount})` },
  ]);
  return { cellRef: `'${tabName}'!I${newRow}`, rowIndex: newRow, created: true };
}

/**
 * Find an existing row for a freeform label within a section's bounds.
 * Exact canonical match first; then prefix match — an existing row label the item
 * label STARTS WITH on a word boundary ("utilities sunscreen" → row "Utilities"),
 * longest row label wins. Returns { row, label, remainder } or null; remainder
 * holds the leftover words on a prefix match (canonicalized, e.g. "sunscreen").
 */
export function findFreeformRow(gRows, section, itemLabel) {
  const limit = section.subtotalRow || section.endRow + 1;
  const target = canonicalizeLabel(itemLabel);
  const inBounds = gRows.filter(({ row }) => row > section.headerRow && row < limit);

  for (const { row, label } of inBounds) {
    if (canonicalizeLabel(label) === target) return { row, label, remainder: "" };
  }

  let best = null;
  for (const { row, label } of inBounds) {
    const key = canonicalizeLabel(label);
    if (key && target.startsWith(key + " ")) {
      if (!best || key.length > canonicalizeLabel(best.label).length) {
        best = { row, label, remainder: target.slice(key.length + 1) };
      }
    }
  }
  return best;
}

export function resolveFreeformSection(section, sections = {}) {
  const norm = normalizeLabel(section);
  if (norm === "one time payments" || norm === "one_time") return "One time payments";
  if (norm === "vacation" || norm.startsWith("vacation")) return "VACATION";
  // Accept the trip name written next to the VACATION header (e.g. "Sahel").
  const alias = sections.VACATION && sections.VACATION.alias;
  if (alias && (norm === alias || norm.includes(alias))) return "VACATION";
  return null;
}

// Warm-instance cache for the vacation context (avoids a Sheets read per message).
const vacationCache = new Map(); // tabName → { context, at }
const VACATION_TTL_MS = 10 * 60 * 1000;

/**
 * Vacation context for a tab: the trip name on the VACATION header (e.g. "sahel")
 * and the labels of the rows already in the section. Cached per warm instance for
 * 10 minutes; used to prime the parser prompt.
 */
export async function getVacationContext(tabName) {
  const hit = vacationCache.get(tabName);
  if (hit && Date.now() - hit.at < VACATION_TTL_MS) return hit.context;
  const layout = await readLayout(tabName);
  const vac = layout.sections.VACATION;
  let context = { alias: null, labels: [] };
  if (vac) {
    const limit = vac.subtotalRow || vac.endRow + 1;
    context = {
      alias: vac.alias ?? null,
      labels: layout.gRows
        .filter(({ row }) => row > vac.headerRow && row < limit)
        .map(({ label }) => label),
    };
  }
  vacationCache.set(tabName, { context, at: Date.now() });
  return context;
}
