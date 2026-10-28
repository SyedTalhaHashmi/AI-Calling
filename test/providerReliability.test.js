/**
 * Reliability fixes for existing providers (no provider changes): Open-Meteo, Google Places, Frankfurter.
 * axios is stubbed — no network.
 * Run: node test/providerReliability.test.js
 */
const assert = require("assert");
const axios = require("axios");
const createOpenMeteoService = require("../services/openMeteo");
const createPlacesService = require("../services/places");
const createFxService = require("../services/fx");
const { extractCurrencies } = require("../utils/intentRouter");
const { keepAliveAgent } = require("../utils/httpAgent");

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
let requests = [];
let getHandler = null;
axios.get = async (url, opts) => {
  requests.push({ url, opts });
  return getHandler(url, opts);
};
axios.post = async (url, body, opts) => {
  requests.push({ url, body, opts });
  return { data: { places: [{ displayName: { text: "Hotel" }, formattedAddress: "A", rating: 4.5 }] } };
};

const timeoutError = () => Object.assign(new Error("timeout of 1000ms exceeded"), { code: "ECONNABORTED" });
const httpError = (status) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

function meteoHandler(url) {
  if (url.includes("geocoding")) {
    return { data: { results: [{ name: "Bogotá", latitude: 4.6, longitude: -74.08, country_code: "CO", population: 7000000 }] } };
  }
  return { data: { current: { temperature_2m: 14, apparent_temperature: 13, weather_code: 3, wind_speed_10m: 5, relative_humidity_2m: 80 } } };
}

(async () => {
  console.log("provider reliability\n");

  await check("shared HTTPS agent keeps connections open between lookups", async () => {
    assert.strictEqual(keepAliveAgent.keepAlive, true);
    assert.ok(keepAliveAgent.options.timeout >= 30000, "idle sockets kept at least 30 s");
  });

  await check("weather: repeat city skips the geocoding request (coordinates cached a day)", async () => {
    let t = 0;
    requests = [];
    getHandler = meteoHandler;
    const svc = createOpenMeteoService(true, logger, { now: () => t });
    assert.strictEqual((await svc.getByCity("Bogota", "CO")).temp, 14);
    t = 5 * 60 * 1000; // weather cache (2 min) expired, coordinates still cached
    assert.strictEqual((await svc.getByCity("Bogota", "CO")).temp, 14);
    const geo = requests.filter((r) => r.url.includes("geocoding")).length;
    const forecast = requests.filter((r) => r.url.includes("forecast")).length;
    assert.strictEqual(geo, 1);
    assert.strictEqual(forecast, 2);
    t = 25 * 60 * 60 * 1000;
    await svc.getByCity("Bogota", "CO");
    assert.strictEqual(requests.filter((r) => r.url.includes("geocoding")).length, 2, "refreshed after a day");
  });

  // The service already downloaded a 7-day forecast and dropped it; "any rain prediction?" was then guessed
  await check("weather: today's and tomorrow's high, low, and rain chance come from the same request", async () => {
    requests = [];
    getHandler = (url) =>
      url.includes("geocoding")
        ? meteoHandler(url)
        : {
            data: {
              ...meteoHandler(url).data,
              daily: {
                weather_code: [61, 0, 3],
                temperature_2m_max: [19.4, 21.6, 20],
                temperature_2m_min: [11.2, 10.5, 9],
                precipitation_probability_max: [80, 5, 10],
              },
            },
          };
    const r = await createOpenMeteoService(true, logger).getByCity("Bogota", "CO");
    assert.deepStrictEqual(r.today, { high: 19, low: 11, rainChance: 80, description: "light rain" });
    assert.deepStrictEqual(r.tomorrow, { high: 22, low: 11, rainChance: 5, description: "clear sky" });
    assert.strictEqual(r.temp, 14, "current conditions unchanged");
    const forecast = requests.find((x) => x.url.includes("forecast"));
    assert.ok(/precipitation_probability_max/.test(forecast.opts.params.daily), forecast.opts.params.daily);
    assert.strictEqual(requests.filter((x) => x.url.includes("forecast")).length, 1, "no extra request");
  });

  await check("weather: missing forecast data leaves today/tomorrow out", async () => {
    getHandler = meteoHandler;
    const r = await createOpenMeteoService(true, logger).getByCity("Bogota", "CO");
    assert.strictEqual(r.today, undefined);
    assert.strictEqual(r.tomorrow, undefined);
  });

  await check("weather: requests reuse connections", async () => {
    requests = [];
    getHandler = meteoHandler;
    await createOpenMeteoService(true, logger).getByCity("Bogota", "CO");
    assert.ok(requests.every((r) => r.opts.httpsAgent === keepAliveAgent));
  });

  await check("places: timeout raised to 2.2 s (cold p90 was ~1.45 s vs the old 1.6 s) and connections reused", async () => {
    requests = [];
    const r = await createPlacesService("key", logger).searchHotels("Cartagena");
    assert.ok(r.places);
    assert.strictEqual(requests[0].opts.timeout, 2200);
    assert.strictEqual(requests[0].opts.httpsAgent, keepAliveAgent);
  });

  await check("fx: one quick retry after a timeout", async () => {
    requests = [];
    let n = 0;
    getHandler = () => {
      n += 1;
      if (n === 1) throw timeoutError();
      return { data: { rate: 3154.42 } };
    };
    const r = await createFxService(true, logger).getRate("USD", "COP");
    assert.strictEqual(r.rate, 3154.42);
    assert.strictEqual(requests.length, 2);
    assert.ok(requests.every((x) => x.opts.timeout === 1000 && x.opts.httpsAgent === keepAliveAgent));
  });

  await check("fx: retries a 5xx once, then gives up with an error", async () => {
    requests = [];
    getHandler = () => {
      throw httpError(503);
    };
    const r = await createFxService(true, logger).getRate("USD", "COP");
    assert.ok(r.error);
    assert.strictEqual(requests.length, 2);
  });

  await check("fx: no retry for a bad currency pair (4xx)", async () => {
    requests = [];
    getHandler = () => {
      throw httpError(422);
    };
    const r = await createFxService(true, logger).getRate("USD", "XYZ");
    assert.ok(r.error);
    assert.strictEqual(requests.length, 1);
  });

  await check("fx parsing: ordinary three-letter words are not currency codes", async () => {
    assert.deepStrictEqual(extractCurrencies("What's the exchange rate from USD to COP?"), { base: "USD", quote: "COP" });
    assert.deepStrictEqual(extractCurrencies("How many pesos is one dollar today?"), { base: null, quote: null });
    assert.deepStrictEqual(extractCurrencies("Convert all my USD to EUR"), { base: "USD", quote: "EUR" });
    const fx = createFxService(true, logger);
    assert.deepStrictEqual(fx.parsePairFromUtterance("What's the exchange rate from USD to COP?"), { base: "USD", quote: "COP" });
    assert.deepStrictEqual(fx.parsePairFromUtterance("convert the pesos to dollars"), { base: "COP", quote: "USD" });
  });

  await check("fx parsing: 'a dollar in pesos' and two-word currency names", async () => {
    const fx = createFxService(true, logger);
    assert.deepStrictEqual(fx.parsePairFromUtterance("How much is a dollar in pesos?"), { base: "USD", quote: "COP" });
    assert.deepStrictEqual(fx.parsePairFromUtterance("What is the dollar to Mexican peso rate?"), { base: "USD", quote: "MXN" });
    assert.deepStrictEqual(fx.parsePairFromUtterance("How much is 100 euros in Japanese yen?"), { base: "EUR", quote: "JPY" });
    assert.deepStrictEqual(fx.parsePairFromUtterance("How much is the euro in Spain?"), { base: null, quote: null });
  });

  console.log(`\n${process.exitCode ? "Some checks failed" : `All ${passed} checks passed`}`);
})();
