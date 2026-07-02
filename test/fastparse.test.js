import test from "node:test";
import assert from "node:assert/strict";

import { fastParse } from "../lib/fastparse.js";

const OPTS = { todayISO: "2026-07-02", defaultCurrency: "EGP" };

test("fastParse accepts trivial <phrase> <amount> messages", () => {
  const r = fastParse("coffee 85", OPTS);
  assert.ok(r);
  assert.equal(r.reply, null);
  assert.deepEqual(r.items[0], {
    amount: 85,
    currency: "EGP",
    section: "DAILY LIVING",
    category_key: "coffee",
    label: null,
    date: "2026-07-02",
    note: null,
    confidence: 1,
    needs_clarification: false,
    clarification: null,
  });
});

test("fastParse accepts <amount> <phrase> order and merchants with notes", () => {
  assert.equal(fastParse("85 coffee", OPTS).items[0].category_key, "coffee");

  const sb = fastParse("starbucks 130", OPTS).items[0];
  assert.equal(sb.category_key, "coffee");
  assert.equal(sb.note, "Starbucks");

  assert.equal(fastParse("uber 130", OPTS).items[0].category_key, "uber_parking");

  const cf = fastParse("cat food 440", OPTS).items[0];
  assert.equal(cf.category_key, "pet_supplies");
  assert.equal(cf.amount, 440);

  assert.equal(fastParse("Carrefour 1300", OPTS).items[0].category_key, "groceries");
});

test("fastParse bails to the LLM on anything non-trivial", () => {
  const cases = [
    "coffee 85 yesterday", // date word
    "coffee 85 on the 3rd", // date phrase / ordinal
    "anoos food 612 and litter 440", // multi-item "and"
    "1,300 carrefour", // comma
    "coffee 85 usd", // currency token
    "$50 coffee", // currency symbol
    "coffee", // no amount
    "coffee 0", // zero amount
    "coffee -50", // negative-ish
    "coffee 85 90", // two numbers
    "random 50", // unknown phrase
    "farah visa 5700", // freeform one-time
    "", // empty
    "coffee 85\nuber 90", // multiline
  ];
  for (const msg of cases) {
    assert.equal(fastParse(msg, OPTS), null, `should bail: ${JSON.stringify(msg)}`);
  }
});

test("fastParse bails when the message mentions the vacation alias", () => {
  const opts = { ...OPTS, vacationAlias: "sahel" };
  assert.equal(fastParse("sahel fnb 254", opts), null);
  assert.equal(fastParse("254 sahel coffee", opts), null);
  // without the alias configured, plain messages still work
  assert.ok(fastParse("coffee 85", opts));
});
