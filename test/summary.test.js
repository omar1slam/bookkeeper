import test from "node:test";
import assert from "node:assert/strict";

import { computeSummary, summaryLines } from "../lib/summary.js";
import { prevTabName, daysInMonth, tabNameForDate } from "../lib/dates.js";

// Synthetic mini month tab (1-based sheet rows):
// 1 HOME header | 2 Gas (budget 500, actual 150) | 3 subtotal =SUM (500/150)
// 4 VACATION - Sahel header | 5 Food & Beverage (no budget, actual 2450) | 6 subtotal (–/2450)
// 7 TOTAL (budget 10000, actual 2600)
const G = [["HOME"], ["Gas"], [""], ["VACATION - Sahel"], ["Food & Beverage"], [""], ["TOTAL"]];
const I_FORMULAS = [[""], ["=(100+50)"], ["=SUM(I2:I2)"], [""], ["=(2450)"], ["=SUM(I5:I5)"], ["=I3+I6"]];
const HI = [["", ""], [500, 150], [500, 150], ["", ""], ["", 2450], ["", 2450], [10000, 2600]];

test("computeSummary extracts sections, budget, total and vacation", () => {
  const s = computeSummary("Jul 2026", G, I_FORMULAS, HI);

  assert.equal(s.tab, "Jul 2026");
  assert.equal(s.sections.length, 2);

  const home = s.sections.find((x) => x.name === "HOME");
  assert.equal(home.actual, 150);
  assert.equal(home.budget, 500);
  assert.equal(home.over, false);

  const vac = s.sections.find((x) => x.name === "VACATION");
  assert.equal(vac.actual, 2450);
  assert.equal(vac.budget, null); // empty H → no budget
  assert.equal(vac.over, false);
  assert.equal(vac.alias, "sahel");

  assert.deepEqual(s.total, { actual: 2600, budget: 10000, row: 7 });

  assert.equal(s.vacation.alias, "sahel");
  assert.equal(s.vacation.total, 2450);
  assert.deepEqual(s.vacation.rows, [{ label: "Food & Beverage", amount: 2450, row: 5 }]);
});

test("computeSummary flags over-budget sections and ignores garbage budget cells", () => {
  const hi = HI.map((r) => [...r]);
  hi[2] = [100, 150]; // HOME budget 100 < actual 150 → over
  const s = computeSummary("Jul 2026", G, I_FORMULAS, hi);
  const home = s.sections.find((x) => x.name === "HOME");
  assert.equal(home.over, true);

  hi[2] = ["n/a", 150]; // garbage budget → treated as missing
  const s2 = computeSummary("Jul 2026", G, I_FORMULAS, hi);
  assert.equal(s2.sections.find((x) => x.name === "HOME").budget, null);
  assert.equal(s2.sections.find((x) => x.name === "HOME").over, false);
});

test("summaryLines renders both modes", () => {
  const hi = HI.map((r) => [...r]);
  hi[2] = [100, 150];
  const s = computeSummary("Jul 2026", G, I_FORMULAS, hi);

  const withBudget = summaryLines(s, { showBudget: true });
  assert.equal(withBudget[0], "HOME: 150 / 100 ⚠ over by 50");
  assert.equal(withBudget[1], "VACATION – Sahel: 2,450"); // no budget → actual only

  const withoutBudget = summaryLines(s, { showBudget: false });
  assert.equal(withoutBudget[0], "HOME: 150");
});

test("computeSummary handles a tab with no TOTAL row and no VACATION section", () => {
  const g = [["HOME"], ["Gas"], [""]];
  const iF = [[""], ["=(100)"], ["=SUM(I2:I2)"]];
  const hi = [["", ""], [500, 100], [500, 100]];
  const s = computeSummary("Aug 2026", g, iF, hi);
  assert.equal(s.total, null);
  assert.equal(s.vacation, null);
  assert.equal(s.sections.length, 1);
});

test("date helpers", () => {
  assert.equal(prevTabName("Jul 2026"), "Jun 2026");
  assert.equal(prevTabName("Jan 2026"), "Dec 2025");
  assert.equal(prevTabName("nonsense"), null);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 7), 31);
  assert.equal(tabNameForDate("2026-07-02"), "Jul 2026");
});
