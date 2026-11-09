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

  // Tavily backup: used only when Exa can't serve the search (no key, daily cap, HTTP error)
  const tavilyReply = { data: { results: [{ title: "Gas today", url: "https://www.aaa.com/gas", content: "Florida average is $3.09." }] } };
  /** Exa and Tavily answer differently; a function reply decides per URL. */
  function byUrl({ exa = sample, tavily = tavilyReply } = {}) {
    return () => {
      const url = posts[posts.length - 1].url;
      const r = url.includes("tavily") ? tavily : exa;
      if (r instanceof Error) throw r;
      return r;
    };
  }
  const httpError = (status) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
  const both = (opts = {}) => {
    posts = [];
    return createWebSearchService({ exaApiKey: "exa-key", tavilyApiKey: "tav-key", enabled: true, logger, ...opts });
  };

  await check("Exa answers first; Tavily isn't called when Exa works", async () => {
    const svc = both();
    reply = byUrl();
    const r = await svc.search("gas price Miami");
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(posts[0].url, "https://api.exa.ai/search");
    assert.strictEqual(r.provider, "exa");
  });

  await check("Exa daily cap used up → Tavily answers (one basic search, 3 results, key in header)", async () => {
    const svc = both({ dailyLimit: 1 });
    reply = byUrl();
    await svc.search("q1");
    const r = await svc.search("q2");
    assert.strictEqual(posts.length, 2);
    const { url, body, opts } = posts[1];
    assert.strictEqual(url, "https://api.tavily.com/search");
    assert.strictEqual(body.query, "q2");
    assert.strictEqual(body.search_depth, "basic");
    assert.strictEqual(body.max_results, 3);
    assert.strictEqual(opts.headers.Authorization, "Bearer tav-key");
    assert.ok(opts.timeout <= 2000);
    assert.strictEqual(r.provider, "tavily");
    assert.deepStrictEqual(r.results[0], { title: "Gas today", source: "aaa.com", published: undefined, snippet: "Florida average is $3.09." });
  });

  await check("Exa HTTP error (out of credit, rate limit, server error) → Tavily answers", async () => {
    for (const status of [402, 429, 500]) {
      const svc = both();
      reply = byUrl({ exa: httpError(status) });
      const r = await svc.search(`question ${status}`);
      assert.strictEqual(r.provider, "tavily", `status ${status}`);
      assert.strictEqual(posts.length, 2);
    }
  });

  await check("Exa timeout → no Tavily (the caller would wait for two searches)", async () => {
    const svc = both();
    reply = byUrl({ exa: Object.assign(new Error("timeout of 1500ms exceeded"), { code: "ECONNABORTED" }) });
    const r = await svc.search("slow one");
    assert.ok(r.error);
    assert.strictEqual(posts.length, 1);
  });

  await check("only a Tavily key → Tavily is the search", async () => {
    posts = [];
    const svc = createWebSearchService({ tavilyApiKey: "tav-key", enabled: true, logger });
    reply = byUrl();
    assert.strictEqual(svc.enabled, true);
    const r = await svc.search("gas price");
    assert.strictEqual(posts[0].url, "https://api.tavily.com/search");
    assert.strictEqual(r.provider, "tavily");
  });

  await check("Tavily has its own daily cap; both used up → limit error, no request", async () => {
    const svc = both({ dailyLimit: 1, tavilyDailyLimit: 1 });
    reply = byUrl();
    await svc.search("a");
    await svc.search("b");
    const third = await svc.search("c");
    assert.strictEqual(posts.length, 2);
    assert.ok(/limit/i.test(third.error), third.error);
  });

  await check("both fail → one { error }, never throws; still off without WEB_SEARCH_ENABLED", async () => {
    const svc = both();
    reply = byUrl({ exa: httpError(500), tavily: httpError(500) });
    const r = await svc.search("x");
    assert.ok(r.error && !r.results);
    const off = createWebSearchService({ exaApiKey: "k", tavilyApiKey: "k", logger });
    assert.strictEqual(off.enabled, false);
  });

  await check("parseWebSearchDailyLimit: positive whole number, else default 40", async () => {
    assert.strictEqual(parseWebSearchDailyLimit("100"), 100);
    assert.strictEqual(parseWebSearchDailyLimit(undefined), 40);
    assert.strictEqual(parseWebSearchDailyLimit("0"), 40);
    assert.strictEqual(parseWebSearchDailyLimit("abc"), 40);
  });

  console.log(`\n${process.exitCode ? "Some checks failed" : `All ${passed} checks passed`}`);
})();
