/**
 * Local time answers: built-in Node time-zone data, no UTC-as-local, world time API opt-in.
 * Run: node test/time.test.js
 */
const assert = require("assert");
const axios = require("axios");
const createTimeService = require("../services/time");
const createWorldTimeService = require("../services/worldTime");

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`       ${err.message}`);
    process.exitCode = 1;
  }
}

const logger = { info() {}, warn() {}, error() {} };
let axiosCalls = 0;
axios.get = async () => {
  axiosCalls += 1;
  return { data: { timezone: "Asia/Tokyo", datetime: "2026-10-27T04:48:00+09:00" } };
};

(async () => {
  console.log("time\n");
  const time = createTimeService();
  const place = (text) => time.resolvePlace(text);

  await check("world time API is disabled by default (no network call)", async () => {
    axiosCalls = 0;
    const svc = createWorldTimeService("key", "world-time-api3.p.rapidapi.com", logger);
    assert.strictEqual(svc.enabled, false);
    const r = await svc.getTimeByTimezone("Asia/Tokyo");
    assert.ok(r.error);
    assert.strictEqual(axiosCalls, 0);
  });

  await check("world time API runs only when explicitly enabled and keyed", async () => {
    axiosCalls = 0;
    const on = createWorldTimeService("key", "world-time-api3.p.rapidapi.com", logger, { enabled: true });
    assert.strictEqual(on.enabled, true);
    await on.getTimeByTimezone("Asia/Tokyo");
    assert.strictEqual(axiosCalls, 1);
    const noKey = createWorldTimeService("", "world-time-api3.p.rapidapi.com", logger, { enabled: true });
    assert.strictEqual(noKey.enabled, false);
  });

  await check("previously supported cities still resolve", async () => {
    assert.strictEqual(place("What time is it in Tokyo?").timezone, "Asia/Tokyo");
    assert.strictEqual(place("what time is it in new york").timezone, "America/New_York");
    assert.strictEqual(place("time in Karachi").timezone, "Asia/Karachi");
    assert.strictEqual(place("What time is it in Miami?").timezone, "America/New_York");
  });

  await check("baseline misses now resolve (Bogota, Medellin, Mexico City, Madrid)", async () => {
    assert.strictEqual(place("What time is it in Bogota?").timezone, "America/Bogota");
    assert.strictEqual(place("What time is it in Bogotá right now?").timezone, "America/Bogota");
    assert.strictEqual(place("What time is it in Medellín?").timezone, "America/Bogota");
    assert.strictEqual(place("what time is it in Mexico City").timezone, "America/Mexico_City");
    assert.strictEqual(place("What time is it in Madrid?").timezone, "Europe/Madrid");
  });

  await check("any IANA zone city resolves (São Paulo, Lima, Buenos Aires, Sydney)", async () => {
    assert.strictEqual(place("hora en São Paulo").timezone, "America/Sao_Paulo");
    assert.strictEqual(place("time in Lima").timezone, "America/Lima");
    assert.strictEqual(place("time in Buenos Aires").timezone, "America/Buenos_Aires");
    assert.strictEqual(place("what time is it in Sydney").timezone, "Australia/Sydney");
  });

  await check("countries resolve to their main time zone", async () => {
    assert.strictEqual(place("What time is it in Colombia?").timezone, "America/Bogota");
    assert.strictEqual(place("time in Spain").timezone, "Europe/Madrid");
    assert.strictEqual(place("time in Pakistan").timezone, "Asia/Karachi");
    assert.strictEqual(place("what time is it in Mexico").timezone, "America/Mexico_City");
  });

  await check("a city wins over its country when both are named", async () => {
    assert.strictEqual(place("time in Medellin, Colombia").timezone, "America/Bogota");
    assert.strictEqual(place("what time is it in Los Angeles, United States").timezone, "America/Los_Angeles");
  });

  await check("spoken label is the place the caller named", async () => {
    assert.strictEqual(place("What time is it in Bogotá?").label, "Bogotá");
    assert.strictEqual(place("what time is it in new york").label, "New York");
    assert.strictEqual(place("time in Colombia").label, "Colombia");
  });

  await check("missing or unknown place returns null (never UTC)", async () => {
    assert.strictEqual(place("What time is it?"), null);
    assert.strictEqual(place("What's the time right now?"), null);
    assert.strictEqual(place("What time is it in Narnia?"), null);
    assert.strictEqual(place("Is it time to leave?"), null);
  });

  await check("common words never match zone names", async () => {
    assert.strictEqual(place("what time is it at the center"), null);
    assert.strictEqual(place("time for some hope"), null);
    assert.strictEqual(place("what time is my oral exam"), null);
    assert.strictEqual(place("what time do we wake up on Christmas"), null);
  });

  await check("resolveTimezone keeps its string contract", async () => {
    assert.strictEqual(time.resolveTimezone("What time is it in Tokyo?"), "Asia/Tokyo");
    assert.strictEqual(time.resolveTimezone("What time is it?"), null);
  });

  await check("getCurrentTime formats in the given zone", async () => {
    const r = time.getCurrentTime("America/Bogota");
    assert.strictEqual(r.timezone, "America/Bogota");
    assert.ok(/\d{1,2}:\d{2}\s?(AM|PM)/.test(r.time), r.time);
  });

  console.log(`\n${process.exitCode ? "Some checks failed" : `All ${passed} checks passed`}`);
})();
