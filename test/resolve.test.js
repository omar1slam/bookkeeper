import test from "node:test";
import assert from "node:assert/strict";

import { normalizeLabel, canonicalizeLabel } from "../lib/categories.js";
import { matchesHeader, resolveFreeformSection, findFreeformRow } from "../lib/resolve.js";
import { appendAmount } from "../lib/formula.js";

test("canonicalizeLabel treats & and 'and' as equivalent", () => {
  assert.equal(canonicalizeLabel("Food & Beverage"), canonicalizeLabel("food and beverage"));
  assert.equal(canonicalizeLabel("Food & Beverage"), "food and beverage");
  assert.equal(canonicalizeLabel("  Health and  Medicine "), "health and medicine");
  // Distinct labels stay distinct.
  assert.notEqual(canonicalizeLabel("Food & Beverage"), canonicalizeLabel("Beverages"));
});

test("normalizeLabel is unchanged (trim/collapse/lowercase only)", () => {
  assert.equal(normalizeLabel("  Food &  Beverage "), "food & beverage");
});

test("matchesHeader extracts a vacation alias from the header suffix", () => {
  assert.deepEqual(matchesHeader("VACATION - Sahel"), { name: "VACATION", alias: "sahel" });
  assert.deepEqual(matchesHeader("VACATION — Sahel"), { name: "VACATION", alias: "sahel" });
  assert.deepEqual(matchesHeader("Vacation (Sahel)"), { name: "VACATION", alias: "sahel" });
  assert.deepEqual(matchesHeader("VACATION"), { name: "VACATION", alias: null });
  assert.deepEqual(matchesHeader("DAILY LIVING"), { name: "DAILY LIVING", alias: null });
  assert.equal(matchesHeader("Sahel"), null); // header must still start with "vacation"
  assert.equal(matchesHeader("Groceries"), null);
});

test("resolveFreeformSection accepts the vacation alias", () => {
  const sections = { VACATION: { alias: "sahel" } };
  assert.equal(resolveFreeformSection("VACATION", sections), "VACATION");
  assert.equal(resolveFreeformSection("vacation - sahel", sections), "VACATION");
  assert.equal(resolveFreeformSection("Sahel", sections), "VACATION");
  assert.equal(resolveFreeformSection("one_time", sections), "One time payments");
  assert.equal(resolveFreeformSection("One time payments", sections), "One time payments");
  // Without an alias, unknown names still fail.
  assert.equal(resolveFreeformSection("Sahel", { VACATION: { alias: null } }), null);
  assert.equal(resolveFreeformSection("Sahel", {}), null);
});

test("findFreeformRow matches exact labels and prefixes", () => {
  // VACATION section: header row 10, rows 11-13, subtotal row 14.
  const section = { headerRow: 10, startRow: 11, endRow: 20, subtotalRow: 14 };
  const gRows = [
    { row: 10, label: "VACATION - Sahel" },
    { row: 11, label: "Food & Beverage" },
    { row: 12, label: "Utilities" },
    { row: 13, label: "Water Sports" },
    { row: 14, label: "Subtotal" },
    { row: 15, label: "TOTAL" }, // outside the section
  ];

  // Exact (with &/and equivalence).
  assert.deepEqual(findFreeformRow(gRows, section, "food and beverage"), {
    row: 11,
    label: "Food & Beverage",
    remainder: "",
  });

  // Prefix: leftover words become the remainder.
  assert.deepEqual(findFreeformRow(gRows, section, "Utilities sunscreen"), {
    row: 12,
    label: "Utilities",
    remainder: "sunscreen",
  });

  // Longest matching row label wins over a shorter one.
  const gRows2 = [...gRows, { row: 13, label: "Water" }]; // hypothetical shorter sibling
  const m = findFreeformRow(gRows2, section, "water sports rental");
  assert.equal(m.label, "Water Sports");
  assert.equal(m.remainder, "rental");

  // No reversed or mid-string matches, no partial-word matches.
  assert.equal(findFreeformRow(gRows, section, "sunscreen utilities"), null);
  assert.equal(findFreeformRow(gRows, section, "utility bill"), null);

  // Rows outside the section bounds are ignored.
  assert.equal(findFreeformRow(gRows, section, "TOTAL"), null);
  assert.equal(findFreeformRow(gRows, section, "vacation - sahel"), null);
});

test("appendAmount regression", () => {
  assert.equal(appendAmount("", "254"), "=(254)");
  assert.equal(appendAmount("=(85+130)", "254"), "=(85+130+254)");
  assert.equal(appendAmount("500", "254"), "=(500+254)");
});
