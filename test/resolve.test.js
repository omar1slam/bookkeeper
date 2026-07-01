import test from "node:test";
import assert from "node:assert/strict";

import { normalizeLabel, canonicalizeLabel } from "../lib/categories.js";
import { matchesHeader, resolveFreeformSection } from "../lib/resolve.js";
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

test("appendAmount regression", () => {
  assert.equal(appendAmount("", "254"), "=(254)");
  assert.equal(appendAmount("=(85+130)", "254"), "=(85+130+254)");
  assert.equal(appendAmount("500", "254"), "=(500+254)");
});
