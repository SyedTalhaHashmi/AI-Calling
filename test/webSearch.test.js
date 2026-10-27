/**
 * Exa web search (tools mode only): off by default, 1.5 s timeout, cache, daily limit.
 * axios is stubbed — no network, no Exa usage.
 * Run: node test/webSearch.test.js
 */
const assert = require("assert");
const axios = require("axios");
const createWebSearchService = require("../services/webSearch");
const { parseWebSearchDailyLimit } = require("../services/webSearch");

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
let posts = [];
let reply = null;
axios.post = async (url, body, opts) => {
  posts.push({ url, body, opts });
  if (typeof reply === "function") return reply();
  return reply;
};
const exaReply = (results) => ({ data: { results } });
const sample = exaReply([
  {
    title: "Gas prices in Miami",
    url: "https://www.gasbuddy.com/gasprices/florida/miami",
    publishedDate: "2026-10-26",
    highlights: ["Average regular gas in Miami is $3.12 per gallon today."],
  },
  { title: "AAA fuel report", url: "https://gasprices.aaa.com/?state=FL", highlights: ["Florida average $3.09."] },
]);

function fresh(opts = {}) {
  posts = [];
  reply = sample;
  return createWebSearchService({ apiKey: "test-key", enabled: true, logger, ...opts });
}

(async () => {
  console.log("webSearch\n");

  await check("off by default: no key or not enabled → disabled, no request", async () => {
    posts = [];
    for (const svc of [
      createWebSearchService({ apiKey: "test-key", logger }),
      createWebSearchService({ apiKey: "", enabled: true, logger }),
      createWebSearchService({ logger }),
    ]) {
      assert.strictEqual(svc.enabled, false);
      const r = await svc.search("gas price Miami");
      assert.ok(r.error);
    }
    assert.strictEqual(posts.length, 0);
  });

  await check("sends one low-cost Exa request: lite type, 3 results, short highlights, 1.5 s timeout", async () => {
    const svc = fresh();
    await svc.search("gas price Miami today");
    assert.strictEqual(posts.length, 1);
    const { url, body, opts } = posts[0];
    assert.strictEqual(url, "https://api.exa.ai/search");
    assert.strictEqual(body.query, "gas price Miami today");
    assert.strictEqual(body.type, "lite");
    assert.strictEqual(body.numResults, 3);
    assert.ok(body.contents.highlights.maxCharacters <= 500);
    assert.strictEqual(opts.timeout, 1500);
    assert.strictEqual(opts.headers["x-api-key"], "test-key");
    assert.ok(opts.httpsAgent?.keepAlive, "reuses connections");
  });

  await check("returns short spoken-ready results (title, site, date, snippet)", async () => {
    const r = await fresh().search("gas price Miami today");
    assert.strictEqual(r.results.length, 2);
    assert.deepStrictEqual(r.results[0], {
      title: "Gas prices in Miami",
      source: "gasbuddy.com",
      published: "2026-10-26",
      snippet: "Average regular gas in Miami is $3.12 per gallon today.",
    });
    assert.strictEqual(r.results[1].source, "gasprices.aaa.com");
  });

  await check("same question again is served from cache (no second request)", async () => {
    const svc = fresh();
    await svc.search("Gas price  Miami today");
    const again = await svc.search("gas price miami today");
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(again.results.length, 2);
  });

  await check("cache expires after 10 minutes", async () => {
    let t = 0;
    const svc = fresh({ now: () => t });
    await svc.search("bogota airport open");
    t = 9 * 60 * 1000;
    await svc.search("bogota airport open");
    assert.strictEqual(posts.length, 1);
    t = 11 * 60 * 1000;
    await svc.search("bogota airport open");
    assert.strictEqual(posts.length, 2);
  });

  await check("daily limit: stops calling Exa once the day's requests are used", async () => {
    const svc = fresh({ dailyLimit: 2 });
    await svc.search("q1");
    await svc.search("q2");
    const third = await svc.search("q3");
    assert.strictEqual(posts.length, 2);
    assert.ok(/limit/i.test(third.error), third.error);
  });

  await check("daily limit counts failed requests and resets the next UTC day", async () => {
    let t = Date.UTC(2026, 9, 27, 23, 0);
    const svc = fresh({ dailyLimit: 1, now: () => t });
    reply = () => {
      throw Object.assign(new Error("timeout of 1500ms exceeded"), { code: "ECONNABORTED" });
    };
    await svc.search("q1");
    reply = sample;
    assert.ok((await svc.search("q2")).error);
    assert.strictEqual(posts.length, 1);
    t = Date.UTC(2026, 9, 28, 0, 5);
    assert.ok((await svc.search("q2")).results);
    assert.strictEqual(posts.length, 2);
  });

  await check("cache hits do not use the daily limit", async () => {
    const svc = fresh({ dailyLimit: 1 });
    await svc.search("same");
    await svc.search("same");
    await svc.search("same");
    assert.strictEqual(posts.length, 1);
  });

  await check("timeout or HTTP error → { error }, never throws", async () => {
    const svc = fresh();
    reply = () => {
      throw Object.assign(new Error("timeout of 1500ms exceeded"), { code: "ECONNABORTED" });
    };
    const r = await svc.search("anything");
    assert.ok(r.error);
    assert.ok(!r.results);
  });

  await check("no results → { error }; empty query → { error } without a request", async () => {
    const svc = fresh();
    reply = exaReply([]);
    assert.ok((await svc.search("zzzz")).error);
    posts = [];
    assert.ok((await svc.search("   ")).error);
    assert.strictEqual(posts.length, 0);
  });

  await check("long queries are capped before sending", async () => {
    const svc = fresh();
    await svc.search("x".repeat(1000));
    assert.ok(posts[0].body.query.length <= 200);
  });

  await check("parseWebSearchDailyLimit: positive whole number, else default 40", async () => {
    assert.strictEqual(parseWebSearchDailyLimit("100"), 100);
    assert.strictEqual(parseWebSearchDailyLimit(undefined), 40);
    assert.strictEqual(parseWebSearchDailyLimit("0"), 40);
    assert.strictEqual(parseWebSearchDailyLimit("abc"), 40);
  });

  console.log(`\n${process.exitCode ? "Some checks failed" : `All ${passed} checks passed`}`);
})();
