import { getValues, getSheetId, batchUpdate, updateValues } from "./sheets.js";
import { CATEGORIES, SECTION_HEADERS, normalizeLabel } from "./categories.js";

function matchesHeader(label) {
  const norm = normalizeLabel(label);
  for (const header of SECTION_HEADERS) {
    if (header === "VACATION") {
      if (norm.startsWith("vacation")) return "VACATION";
    } else if (norm === normalizeLabel(header)) {
      return header;
    }
  }
  return null;
}

/**
 * Read col G + col I (formulas) of a tab and compute section ranges.
 * Returns { gRows: [{row,label}], sections: { NAME: {headerRow, startRow, endRow, subtotalRow} } }
 * Rows are 1-based (sheet rows).
 */
async function readLayout(tabName) {
  const gValues = await getValues(`'${tabName}'!G1:G80`, { render: "UNFORMATTED_VALUE" });
  const iValues = await getValues(`'${tabName}'!I1:I80`, { render: "FORMULA" });

  const gRows = [];
  const headers = []; // { row, name }
  for (let i = 0; i < gValues.length; i++) {
    const cell = gValues[i] && gValues[i][0];
    if (cell == null || String(cell).trim() === "") continue;
    const row = i + 1;
    const label = String(cell);
    gRows.push({ row, label });
    const headerName = matchesHeader(label);
    if (headerName) headers.push({ row, name: headerName });
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
    sections[header.name] = { headerRow: header.row, startRow, endRow, subtotalRow };
  }

  return { gRows, sections, iFormula };
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

    const target = normalizeLabel(cat.label);
    for (const { row, label } of layout.gRows) {
      if (row <= section.headerRow) continue;
      if (section.subtotalRow && row >= section.subtotalRow) continue;
      if (row > section.endRow) continue;
      if (normalizeLabel(label) === target) {
        return { cellRef: `'${tabName}'!I${row}`, rowIndex: row };
      }
    }
    return { error: `no ${cat.label} row in ${tabName}` };
  }

  // --- Freeform items (one_time / vacation) ---
  const sectionName = resolveFreeformSection(item.section);
  if (!sectionName) return { error: `unknown freeform section "${item.section}"` };
  const resolvedSection = layout.sections[sectionName];
  if (!resolvedSection) return { error: `no ${sectionName} section in ${tabName}` };
  if (!item.label) return { error: `freeform item missing label` };

  // Find first empty col-G row between header and subtotal.
  const used = new Set(layout.gRows.map((r) => r.row));
  const limit = resolvedSection.subtotalRow || resolvedSection.endRow + 1;
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

function resolveFreeformSection(section) {
  const norm = normalizeLabel(section);
  if (norm === "one time payments" || norm === "one_time") return "One time payments";
  if (norm === "vacation" || norm.startsWith("vacation")) return "VACATION";
  return null;
}
