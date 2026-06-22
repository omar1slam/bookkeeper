/**
 * Append a numeric term to an ACTUAL cell, preserving the owner's =(a+b+c) style.
 * Handles three shapes: empty, plain number, =(...) formula (plus any other formula).
 * `amount` is a numeric string exactly as it should appear as a term, e.g. "85", "186.89".
 */
export function appendAmount(existing, amount) {
  const n = String(amount);
  if (existing == null || String(existing).trim() === "") return `=(${n})`;
  const s = String(existing).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return `=(${s}+${n})`; // plain number
  const m = s.match(/^=\((.*)\)$/s); // =(...) form
  if (m) {
    const inner = m[1].replace(/\+\++/g, "+").replace(/\+\s*$/, ""); // normalize ++ and trailing +
    return `=(${inner}+${n})`;
  }
  if (s.startsWith("=")) return `=(${s.slice(1)}+${n})`; // any other formula
  return `=(${s}+${n})`; // fallback
}

/**
 * Remove the last term equal to `amount` from a =(...) cell (used by /undo).
 * Falls back to popping the last term if no exact match. Returns "" if it empties.
 */
export function removeLastTerm(existing, amount) {
  const target = String(amount);
  if (existing == null) return "";
  const s = String(existing).trim();
  const m = s.match(/^=\((.*)\)$/s);
  let inner;
  if (m) {
    inner = m[1];
  } else if (/^-?\d+(\.\d+)?$/.test(s)) {
    inner = s; // plain number, single term
  } else if (s.startsWith("=")) {
    inner = s.slice(1);
  } else {
    inner = s;
  }

  inner = inner.replace(/\+\++/g, "+").replace(/\+\s*$/, "").replace(/^\s*\+/, "");
  const terms = inner.split("+").map((t) => t.trim()).filter((t) => t.length > 0);
  if (terms.length === 0) return "";

  // Remove the last occurrence equal to the amount; otherwise pop the last term.
  let idx = -1;
  for (let i = terms.length - 1; i >= 0; i--) {
    if (terms[i] === target) {
      idx = i;
      break;
    }
  }
  if (idx === -1) idx = terms.length - 1;
  terms.splice(idx, 1);

  if (terms.length === 0) return "";
  return `=(${terms.join("+")})`;
}
