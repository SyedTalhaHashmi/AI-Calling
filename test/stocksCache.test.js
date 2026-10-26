/**
 * Stocks/crypto/rates caching (Phase 1: same Alpha Vantage provider, fewer requests).
 * axios.get is stubbed — no network.
 * Run: node test/stocksCache.test.js
 */
const assert = require("assert");
const axios = require("axios");
const createStocksService = require("../services/stocks");

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

const logger = { warn() {}, info() {} };
let calls = [];
let respond = () => ({ data: {} });
axios.get = async (url, opts) => {
  calls.push(opts.params);
  return respond(opts.params);
};

function avResponse(params) {
  if (params.function === "GLOBAL_QUOTE") {
    return {
      data: {
        "Global Quote": {
          "01. symbol": params.symbol,
          "05. price": "100.00",
          "10. change percent": "1.0%",
        },
      },
    };
  }
  if (params.function === "CURRENCY_EXCHANGE_RATE") {
    return { data: { "Realtime Currency Exchange Rate": { "5. Exchange Rate": "50000" } } };
  }
  return { data: { data: [{ value: "3.75", date: "2026-09-01" }] } };
}

(async () => {
  console.log("stocks cache\n");

  await check("repeat stock quote served from cache", async () => {
    calls = [];
    respond = avResponse;
    const s = createStocksService("key", logger);
    const a = await s.getQuote("Apple");
    const b = await s.getQuote("What's the stock price of Apple?");
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(b, a);
  });

  await check("different symbols are cached separately", async () => {
    calls = [];
    respond = avResponse;
    const s = createStocksService("key", logger);
    await s.getQuote("Apple");
    await s.getQuote("Tesla");
    assert.strictEqual(calls.length, 2);
  });

  await check("repeat crypto quote served from cache", async () => {
    calls = [];
    respond = avResponse;
    const s = createStocksService("key", logger);
    await s.getCryptoQuote("bitcoin");
    await s.getCryptoQuote("BTC price");
    assert.strictEqual(calls.length, 1);
  });

  await check("repeat US rate served from cache", async () => {
    calls = [];
    respond = avResponse;
    const s = createStocksService("key", logger);
    await s.getUsInterestRate();
    await s.getUsInterestRate();
    assert.strictEqual(calls.length, 1);
  });

  await check("errors are not cached", async () => {
    calls = [];
    respond = () => {
      throw new Error("network down");
    };
    const s = createStocksService("key", logger);
    const first = await s.getQuote("Apple");
    assert.ok(first.error);
    respond = avResponse;
    const second = await s.getQuote("Apple");
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(second.symbol, "AAPL");
  });

  if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
})();
