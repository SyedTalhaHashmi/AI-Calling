/**
 * Fares for the caller's dates (Travelpayouts /aviasales/v3/prices_for_dates, same token).
 * axios is stubbed — no network.
 * Run: node test/travelFares.test.js
 */
const assert = require("assert");
const axios = require("axios");
const createTravelService = require("../services/travel");
const { formatFareFact } = require("../utils/spokenFacts");

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

const logger = { info() {}, warn() {}, error() {} };
let requests = [];
/** Items returned per departure_at value ("2026-11-02", "2026-11", …). */
let byDeparture = {};
axios.get = async (url, opts) => {
  requests.push({ url, params: opts.params });
  return { data: { success: true, currency: "usd", data: byDeparture[opts.params.departure_at] || [] } };
};

const item = (dep, price, extra = {}) => ({
  departure_at: `${dep}T09:00:00-05:00`,
  price,
  airline: "LA",
  flight_number: "1443",
  transfers: 1,
  return_transfers: 1,
  ...extra,
});

(async () => {
  console.log("travel fares for dates\n");

  await check("exact date found → one request, one-way when no return date, match 'exact'", async () => {
    requests = [];
    byDeparture = { "2026-11-02": [item("2026-11-02", 446)] };
    const s = createTravelService("tok", logger);
    const r = await s.fareForTrip("BOG", "MIA", { departDate: "2026-11-02" });
    assert.strictEqual(requests.length, 1);
    assert.ok(requests[0].url.endsWith("/aviasales/v3/prices_for_dates"), requests[0].url);
    assert.strictEqual(requests[0].params.departure_at, "2026-11-02");
    assert.strictEqual(requests[0].params.one_way, "true");
    assert.strictEqual(requests[0].params.currency, "usd");
    assert.strictEqual(r.match, "exact");
    assert.deepStrictEqual([r.price, r.airline, r.transfers, r.oneWay], [446, "LA", 1, true]);
    assert.strictEqual(r.departDate, "2026-11-02");
  });

  await check("round trip passes the return date and reports it", async () => {
    requests = [];
    byDeparture = { "2026-11-02": [item("2026-11-02", 520, { return_at: "2026-11-06T18:00:00-05:00" })] };
    const r = await createTravelService("tok", logger).fareForTrip("BOG", "MIA", { departDate: "2026-11-02", returnDate: "2026-11-06" });
    assert.strictEqual(requests[0].params.return_at, "2026-11-06");
    assert.strictEqual(requests[0].params.one_way, "false");
    assert.deepStrictEqual([r.oneWay, r.returnDate, r.match], [false, "2026-11-06", "exact"]);
  });

  await check("exact dates empty → month search; a fare on that date still counts as exact", async () => {
    requests = [];
    byDeparture = { "2026-11": [item("2026-11-20", 300), item("2026-11-02", 410)] };
    const r = await createTravelService("tok", logger).fareForTrip("BOG", "MIA", { departDate: "2026-11-02" });
    assert.deepStrictEqual(requests.map((q) => q.params.departure_at), ["2026-11-02", "2026-11"]);
    assert.deepStrictEqual([r.match, r.price, r.departDate], ["exact", 410, "2026-11-02"]);
  });

  await check("nothing on that date → nearby (within 3 days) is preferred and labelled 'near'", async () => {
    byDeparture = { "2026-11": [item("2026-11-20", 300), item("2026-11-04", 430)] };
    const r = await createTravelService("tok", logger).fareForTrip("BOG", "MIA", { departDate: "2026-11-02" });
    assert.deepStrictEqual([r.match, r.departDate], ["near", "2026-11-04"]);
  });

  await check("nothing near → cheapest that month, labelled so it isn't passed off as their date", async () => {
    byDeparture = { "2026-11": [item("2026-11-20", 300)] };
    const r = await createTravelService("tok", logger).fareForTrip("BOG", "MIA", { departDate: "2026-11-02" });
    assert.deepStrictEqual([r.match, r.departDate, r.requestedDate], ["other_dates", "2026-11-20", "2026-11-02"]);
  });

  await check("'next week' → month search filtered to that week", async () => {
    requests = [];
    byDeparture = { "2026-11": [item("2026-11-20", 250), item("2026-11-05", 390)] };
    const r = await createTravelService("tok", logger).fareForTrip("BOG", "MIA", {
      departMonth: "2026-11",
      window: { start: "2026-11-02", end: "2026-11-08" },
    });
    assert.strictEqual(requests.length, 1);
    assert.deepStrictEqual([r.match, r.departDate, r.price], ["window", "2026-11-05", 390]);
  });

  await check("month only → cheapest in that month", async () => {
    byDeparture = { "2026-12": [item("2026-12-09", 280), item("2026-12-02", 350)] };
    const r = await createTravelService("tok", logger).fareForTrip("BOG", "MIA", { departMonth: "2026-12" });
    assert.deepStrictEqual([r.match, r.departDate, r.price, r.month], ["month", "2026-12-09", 280, "2026-12"]);
  });

  await check("trip type not said and no one-way fares that month → tries round trip before giving up", async () => {
    requests = [];
    const saved = axios.get;
    axios.get = async (url, opts) => {
      requests.push({ params: opts.params });
      const items = opts.params.one_way === "false" ? [item("2026-12-12", 231, { return_at: "2026-12-19T10:00:00-05:00" })] : [];
      return { data: { success: true, data: items } };
    };
    const r = await createTravelService("tok", logger).fareForTrip("MIA", "BOG", { departMonth: "2026-12", oneWay: null });
    axios.get = saved;
    assert.deepStrictEqual(requests.map((q) => q.params.one_way), ["true", "false"]);
    assert.deepStrictEqual([r.match, r.oneWay, r.returnDate, r.price], ["month", false, "2026-12-19", 231]);
  });

  await check("caller said one-way → never switched to round trip", async () => {
    requests = [];
    byDeparture = {};
    const r = await createTravelService("tok", logger).fareForTrip("MIA", "BOG", { departMonth: "2026-12", oneWay: true });
    assert.deepStrictEqual(requests.map((q) => q.params.one_way), ["true"]);
    assert.ok(r.error);
  });

  await check("no fares at all → error with a booking-site tip, never a number", async () => {
    byDeparture = {};
    const r = await createTravelService("tok", logger).fareForTrip("BOG", "MIA", { departDate: "2026-11-02" });
    assert.ok(r.error && /Google Flights|Kayak|Skyscanner/.test(r.error) && !/\d{2,}/.test(r.error), JSON.stringify(r));
  });

  await check("failed request → error, never throws", async () => {
    const saved = axios.get;
    axios.get = async () => { throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" }); };
    const r = await createTravelService("tok", logger).fareForTrip("BOG", "MIA", { departDate: "2026-11-02" });
    axios.get = saved;
    assert.ok(r.error, JSON.stringify(r));
  });

  // Spoken wording for each kind of match
  const base = { origin: "BOG", destination: "MIA", currency: "USD", airline: "LA", transfers: 1 };

  await check("fact, exact date one-way: date, cities, price, airline, stops", async () => {
    const f = formatFareFact({ ...base, price: 446, match: "exact", oneWay: true, departDate: "2026-11-02" });
    assert.ok(/Monday, November 2/.test(f) && /Bogotá to Miami/.test(f) && /446 US dollars/.test(f), f);
    assert.ok(/one-way/.test(f) && /LATAM/.test(f) && /one stop/.test(f), f);
  });

  await check("fact, round trip: both dates and nonstop", async () => {
    const f = formatFareFact({ ...base, transfers: 0, return_transfers: 0, price: 520, match: "exact", oneWay: false, departDate: "2026-11-02", returnDate: "2026-11-06" });
    assert.ok(/round trip/.test(f) && /Friday, November 6/.test(f) && /nonstop/.test(f), f);
  });

  await check("fact, near / other dates / month say plainly what was found", async () => {
    const near = formatFareFact({ ...base, price: 430, match: "near", oneWay: true, departDate: "2026-11-04", requestedDate: "2026-11-02" });
    assert.ok(/don't see fares for Monday, November 2/i.test(near) && /Wednesday, November 4/.test(near), near);
    const other = formatFareFact({ ...base, price: 300, match: "other_dates", oneWay: true, departDate: "2026-11-20", requestedDate: "2026-11-02" });
    assert.ok(/don't see fares for Monday, November 2/i.test(other) && /cheapest I can see in November/.test(other), other);
    const month = formatFareFact({ ...base, price: 280, match: "month", oneWay: true, departDate: "2026-12-09", month: "2026-12" });
    assert.ok(/cheapest I can see in December/.test(month) && /Wednesday, December 9/.test(month), month);
    for (const f of [near, other, month]) assert.ok(/can change/.test(f), f);
  });

  if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
})();
