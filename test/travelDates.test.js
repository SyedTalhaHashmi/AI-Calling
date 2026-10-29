/**
 * Spoken travel dates → departure / return dates (flight and hotel price questions).
 * "Today" is fixed at Thursday 2026-10-29.
 * Run: node test/travelDates.test.js
 */
const assert = require("assert");
const { parseTravelDates, stayNights, monthName } = require("../utils/travelDates");

const NOW = Date.parse("2026-10-29T15:00:00Z");
const p = (t) => parseTravelDates(t, NOW);

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("travel dates\n");

check("no dates → nothing set", () => {
  assert.deepStrictEqual(p("How much is a flight from Bogota to Miami?"), {
    departDate: null, returnDate: null, departMonth: null, window: null, oneWay: null, nights: null,
  });
});

check("weekdays: 'next Monday', 'on Monday', 'this Saturday'", () => {
  assert.strictEqual(p("leaving next Monday").departDate, "2026-11-02");
  assert.strictEqual(p("on Monday").departDate, "2026-11-02");
  assert.strictEqual(p("this Saturday").departDate, "2026-10-31");
});

check("'Monday to Friday next week' (production log) → Nov 2 out, Nov 6 back", () => {
  const r = p("Bogota to Miami leaving on Monday to Friday next week.");
  assert.strictEqual(r.departDate, "2026-11-02");
  assert.strictEqual(r.returnDate, "2026-11-06");
  assert.strictEqual(r.oneWay, false);
});

check("'Tuesday to Friday next week' → Nov 3 to Nov 6", () => {
  const r = p("I want to travel on Tuesday to Friday next week.");
  assert.deepStrictEqual([r.departDate, r.returnDate], ["2026-11-03", "2026-11-06"]);
});

check("today / tomorrow / day after tomorrow", () => {
  assert.strictEqual(p("flying today").departDate, "2026-10-29");
  assert.strictEqual(p("flying tomorrow").departDate, "2026-10-30");
  assert.strictEqual(p("the day after tomorrow").departDate, "2026-10-31");
});

check("calendar dates, rolling to next year when already past", () => {
  assert.strictEqual(p("on November 10").departDate, "2026-11-10");
  assert.strictEqual(p("on the 10th of November").departDate, "2026-11-10");
  assert.strictEqual(p("Nov 10th").departDate, "2026-11-10");
  assert.strictEqual(p("January 5").departDate, "2027-01-05");
  assert.strictEqual(p("on the 15th").departDate, "2026-11-15");
});

check("two calendar dates → out and back", () => {
  const r = p("from December 20 to January 3");
  assert.deepStrictEqual([r.departDate, r.returnDate, r.oneWay], ["2026-12-20", "2027-01-03", false]);
});

check("month only / next month / next week", () => {
  assert.deepStrictEqual([p("sometime in December").departMonth, p("sometime in December").departDate], ["2026-12", null]);
  assert.strictEqual(p("next month").departMonth, "2026-11");
  const w = p("next week");
  assert.deepStrictEqual(w.window, { start: "2026-11-02", end: "2026-11-08" });
  assert.strictEqual(w.departMonth, "2026-11");
});

check("'for three nights starting next Monday' → return and nights", () => {
  const r = p("hotel in Miami for three nights starting next Monday");
  assert.deepStrictEqual([r.departDate, r.returnDate, r.nights], ["2026-11-02", "2026-11-05", 3]);
});

check("one way / round trip wording", () => {
  assert.strictEqual(p("one way to Miami on Monday").oneWay, true);
  assert.strictEqual(p("round trip to Miami on Monday").oneWay, false);
  assert.strictEqual(p("to Miami on Monday, coming back Friday").oneWay, false);
  assert.strictEqual(p("to Miami on Monday, coming back Friday").returnDate, "2026-11-06");
  assert.strictEqual(p("to Miami on Monday").oneWay, null);
});

check("Spanish dates", () => {
  assert.strictEqual(p("el próximo lunes").departDate, "2026-11-02");
  assert.strictEqual(p("el 10 de noviembre").departDate, "2026-11-10");
  assert.strictEqual(p("mañana").departDate, "2026-10-30");
  assert.strictEqual(p("solo ida el lunes").oneWay, true);
  assert.strictEqual(p("en diciembre").departMonth, "2026-12");
});

check("not dates: 'Monday morning meeting'-style chat still parses, numbers alone don't", () => {
  assert.strictEqual(p("I have 3 kids").departDate, null);
  assert.strictEqual(p("the 3 best hotels").departDate, null);
});

check("stay nights from words or dates; month names", () => {
  assert.strictEqual(stayNights("three nights in Miami", NOW), 3);
  assert.strictEqual(stayNights("Monday to Friday next week", NOW), 4);
  assert.strictEqual(stayNights("a hotel in Miami", NOW), null);
  assert.strictEqual(monthName("2026-12"), "December");
});

if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
