/**
 * Phase 1 tools mode: tool definitions + executor over the EXISTING services (stubbed here, no network).
 * Run: node test/realtimeTools.test.js
 */
const assert = require("assert");
const {
  buildToolDefinitions,
  createToolExecutor,
  collectFunctionCalls,
  runToolCalls,
  fetchWeatherForPlaces,
  toolsTurnInstruction,
  toolsFollowUpInstruction,
  parseRouterMode,
  parseToolDeadlineMs,
  toolChoiceAgreement,
  TOOLS_SESSION_RULES,
  WEB_SEARCH_SESSION_RULE,
} = require("../handlers/realtimeTools");

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stub services with the same method names as services/*.js; records calls. */
function stubServices(overrides = {}) {
  const calls = [];
  const rec = (name, value) => (...args) => {
    calls.push([name, ...args]);
    return Promise.resolve(typeof value === "function" ? value(...args) : value);
  };
  const services = {
    openMeteoService: { enabled: true, getByCity: rec("openMeteo.getByCity", { temp: 18, city: "Bogotá" }) },
    weatherService: { enabled: true, getByCity: rec("openWeather.getByCity", { temp: 1 }) },
    timeService: {
      enabled: true,
      getCurrentTime: (tz) => {
        calls.push(["time.getCurrentTime", tz]);
        return { time: "7:48 PM", timezone: tz || "UTC" };
      },
      resolveTimezone: (text) => (/tokyo/i.test(text) ? "Asia/Tokyo" : null),
    },
    worldTimeService: { enabled: false, getTimeByTimezone: rec("worldTime.get", { error: "x" }) },
    newsService: { enabled: true, topHeadlines: rec("news.topHeadlines", { articles: [{ title: "T", source: "S" }] }) },
    fxService: { enabled: true, getRate: rec("fx.getRate", { base: "USD", quote: "COP", rate: 3163.36 }) },
    placesService: {
      enabled: true,
      searchHotels: rec("places.searchHotels", { places: [{ name: "H" }] }),
      searchFood: rec("places.searchFood", { places: [{ name: "F" }] }),
      searchText: rec("places.searchText", { places: [{ name: "P" }] }),
    },
    travelService: { enabled: true, cheapestRoute: rec("travel.cheapestRoute", { price: 376 }) },
    flightsService: { enabled: true, getFlightStatus: rec("flights.getFlightStatus", { message: "ok" }) },
    sportsService: {
      enabled: true,
      detectSport: (t) => (/nba/i.test(t) ? "nba" : "football"),
      getLiveScores: rec("sports.getLiveScores", { matches: ["A 1 - 0 B"] }),
    },
    stocksService: {
      enabled: true,
      getQuote: rec("stocks.getQuote", { message: "AAPL is $1." }),
      getCryptoQuote: rec("stocks.getCryptoQuote", { message: "BTC is $1." }),
      getUsInterestRate: rec("stocks.getUsInterestRate", { message: "3.75" }),
    },
    ...overrides,
  };
  return { services, calls };
}

const ALL_TOOLS = [
  "get_weather",
  "get_time",
  "get_news",
  "get_exchange_rate",
  "find_places",
  "get_flight_fare",
  "get_flight_status",
  "get_sports_scores",
  "get_crypto_price",
  "get_stock_quote",
  "get_us_interest_rate",
];

(async () => {
  console.log("realtimeTools\n");

  await check("all tools offered when every service is enabled", async () => {
    const { services } = stubServices();
    const names = buildToolDefinitions(services).map((t) => t.name);
    assert.deepStrictEqual(names.sort(), [...ALL_TOOLS].sort());
  });

  await check("tool definitions are Realtime function tools with schemas", async () => {
    const { services } = stubServices();
    for (const t of buildToolDefinitions(services)) {
      assert.strictEqual(t.type, "function", t.name);
      assert.ok(t.description && t.description.length > 20, t.name);
      assert.strictEqual(t.parameters.type, "object", t.name);
    }
  });

  await check("tools for unconfigured services are not offered", async () => {
    const { services } = stubServices({
      stocksService: { enabled: false },
      placesService: { enabled: false },
      newsService: { enabled: false },
    });
    const names = buildToolDefinitions(services).map((t) => t.name);
    for (const gone of ["get_stock_quote", "get_crypto_price", "get_us_interest_rate", "find_places", "get_news"]) {
      assert.ok(!names.includes(gone), gone);
    }
    assert.ok(names.includes("get_weather"));
  });

  await check("weather offered when only OpenWeather is configured", async () => {
    const { services } = stubServices({ openMeteoService: { enabled: false } });
    assert.ok(buildToolDefinitions(services).some((t) => t.name === "get_weather"));
  });

  await check("get_weather prefers Open-Meteo and normalizes country names", async () => {
    const { services, calls } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    const r = await ex.execute("get_weather", { city: "Bogota", country: "Colombia" });
    assert.strictEqual(r.temp, 18);
    assert.deepStrictEqual(calls, [["openMeteo.getByCity", "Bogota", "CO"]]);
  });

  await check("get_weather with only a country uses its main city", async () => {
    const { services, calls } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    await ex.execute("get_weather", { city: "Puerto Rico" });
    assert.deepStrictEqual(calls, [["openMeteo.getByCity", "San Juan", "PR"]]);
  });

  await check("get_exchange_rate upper-cases ISO codes", async () => {
    const { services, calls } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    const r = await ex.execute("get_exchange_rate", { base: "usd", quote: "cop" });
    assert.strictEqual(r.rate, 3163.36);
    assert.deepStrictEqual(calls, [["fx.getRate", "USD", "COP"]]);
  });

  await check("find_places routes hotel / food / local_service to existing searches", async () => {
    const { services, calls } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    await ex.execute("find_places", { kind: "hotel", location: "Cartagena" });
    await ex.execute("find_places", { kind: "food", location: "Medellin" });
    await ex.execute("find_places", { kind: "local_service", query: "pharmacy", location: "Bogota" });
    assert.deepStrictEqual(calls, [
      ["places.searchHotels", "Cartagena"],
      ["places.searchFood", "Medellin"],
      ["places.searchText", "pharmacy near Bogota"],
    ]);
  });

  await check("get_flight_fare passes model-resolved IATA codes", async () => {
    const { services, calls } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    await ex.execute("get_flight_fare", { origin: "bog", destination: "mia" });
    assert.deepStrictEqual(calls, [["travel.cheapestRoute", "BOG", "MIA"]]);
  });

  await check("get_flight_status strips spaces from flight number", async () => {
    const { services, calls } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    await ex.execute("get_flight_status", { flight_number: "AA 920" });
    assert.deepStrictEqual(calls, [["flights.getFlightStatus", "AA920"]]);
  });

  await check("get_time uses a valid IANA zone on the local clock", async () => {
    const { services, calls } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    const r = await ex.execute("get_time", { timezone: "Asia/Tokyo" });
    assert.strictEqual(r.timezone, "Asia/Tokyo");
    assert.deepStrictEqual(calls, [["time.getCurrentTime", "Asia/Tokyo"]]);
  });

  await check("get_time tries world time API first when enabled, then falls back", async () => {
    const { services, calls } = stubServices({
      worldTimeService: {
        enabled: true,
        getTimeByTimezone: async (tz) => {
          calls.push(["worldTime.get", tz]);
          return { error: "403" };
        },
      },
    });
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    const r = await ex.execute("get_time", { timezone: "Asia/Tokyo" });
    assert.strictEqual(r.time, "7:48 PM");
    assert.deepStrictEqual(calls.map((c) => c[0]), ["worldTime.get", "time.getCurrentTime"]);
  });

  await check("get_time with an invalid zone asks for a place", async () => {
    const { services } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    const r = await ex.execute("get_time", { timezone: "Not/AZone" });
    assert.ok(r.error);
  });

  await check("sports, crypto, stocks, rates, news call the existing methods", async () => {
    const { services, calls } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    await ex.execute("get_sports_scores", { sport: "NBA" });
    await ex.execute("get_crypto_price", { coin: "bitcoin" });
    await ex.execute("get_stock_quote", { company_or_ticker: "Apple" });
    await ex.execute("get_us_interest_rate", {});
    await ex.execute("get_news", { topic: "Colombia" });
    assert.deepStrictEqual(calls, [
      ["sports.getLiveScores", "nba"],
      ["stocks.getCryptoQuote", "bitcoin"],
      ["stocks.getQuote", "Apple"],
      ["stocks.getUsInterestRate"],
      ["news.topHeadlines", "Colombia"],
    ]);
  });

  await check("a slow service is cut off at the deadline with an error result", async () => {
    const { services } = stubServices({
      fxService: { enabled: true, getRate: () => new Promise(() => {}) },
    });
    const ex = createToolExecutor({ services, logger, deadlineMs: 50 });
    const started = Date.now();
    const r = await ex.execute("get_exchange_rate", { base: "USD", quote: "EUR" });
    assert.ok(r.error && /too long/i.test(r.error), JSON.stringify(r));
    assert.ok(Date.now() - started < 500);
  });

  await check("a throwing service becomes an error result (never throws)", async () => {
    const { services } = stubServices({
      newsService: {
        enabled: true,
        topHeadlines: async () => {
          throw new Error("boom");
        },
      },
    });
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    const r = await ex.execute("get_news", {});
    assert.ok(r.error);
  });

  await check("unknown or disabled tool returns an error result", async () => {
    const { services } = stubServices({ stocksService: { enabled: false } });
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    assert.ok((await ex.execute("get_horoscope", {})).error);
    assert.ok((await ex.execute("get_stock_quote", { company_or_ticker: "Apple" })).error);
  });

  await check("collectFunctionCalls returns every function call in order", async () => {
    const response = {
      output: [
        { type: "message", content: [] },
        { type: "function_call", name: "get_weather", call_id: "c1", arguments: '{"city":"Miami"}' },
        { type: "function_call", name: "get_weather", call_id: "c2", arguments: '{"city":"Orlando"}' },
      ],
    };
    const calls = collectFunctionCalls(response);
    assert.deepStrictEqual(calls.map((c) => c.call_id), ["c1", "c2"]);
    assert.deepStrictEqual(collectFunctionCalls({ output: [] }), []);
    assert.deepStrictEqual(collectFunctionCalls(undefined), []);
  });

  await check("runToolCalls runs calls in parallel and keeps call order", async () => {
    const { services } = stubServices({
      openMeteoService: {
        enabled: true,
        getByCity: async (city) => {
          await sleep(city === "Miami" ? 120 : 20);
          return { city };
        },
      },
    });
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    const started = Date.now();
    const outputs = await runToolCalls(
      [
        { name: "get_weather", call_id: "c1", arguments: '{"city":"Miami"}' },
        { name: "get_weather", call_id: "c2", arguments: '{"city":"Orlando"}' },
      ],
      ex
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 200, `took ${elapsed}ms (sequential would be ~140+)`);
    assert.deepStrictEqual(outputs.map((o) => o.call_id), ["c1", "c2"]);
    assert.deepStrictEqual(JSON.parse(outputs[0].output), { city: "Miami" });
  });

  await check("runToolCalls tolerates malformed arguments", async () => {
    const { services } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    const [o] = await runToolCalls([{ name: "get_us_interest_rate", call_id: "c1", arguments: "{bad" }], ex);
    assert.strictEqual(o.call_id, "c1");
    assert.ok(o.output.length > 0);
  });

  await check("runToolCalls caps very large outputs", async () => {
    const { services } = stubServices({
      newsService: { enabled: true, topHeadlines: async () => ({ text: "x".repeat(10000) }) },
    });
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    const [o] = await runToolCalls([{ name: "get_news", call_id: "c1", arguments: "{}" }], ex);
    assert.ok(o.output.length <= 2000, String(o.output.length));
  });

  await check("fetchWeatherForPlaces is parallel and keeps place order", async () => {
    const started = Date.now();
    const results = await fetchWeatherForPlaces(
      [{ city: "Slow" }, { city: "Fast" }],
      async (place) => {
        await sleep(place.city === "Slow" ? 120 : 20);
        return { city: place.city };
      }
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 200, `took ${elapsed}ms`);
    assert.deepStrictEqual(results.map((r) => r.city), ["Slow", "Fast"]);
  });

  await check("turn instruction keeps language, length, and asks for a short acknowledgement", async () => {
    const text = toolsTurnInstruction("Spanish");
    assert.ok(/Spanish only/.test(text));
    assert.ok(/15.25 words/.test(text));
    assert.ok(/acknowledg/i.test(text));
  });

  await check("follow-up instruction forbids guessing and repeats language", async () => {
    const text = toolsFollowUpInstruction("English");
    assert.ok(/English only/.test(text));
    assert.ok(/never guess|do not guess/i.test(text));
  });

  await check("acknowledgement is required before every tool, including place searches", async () => {
    const text = toolsTurnInstruction("English");
    assert.ok(/every tool/i.test(text), text);
    assert.ok(/hotel|restaurant|place/i.test(text), text);
    const { services } = stubServices();
    const places = buildToolDefinitions(services).find((t) => t.name === "find_places");
    assert.ok(/acknowledgement/i.test(places.description), places.description);
  });

  await check("exchange-rate tool: bare 'pesos' means COP, no amount means give the rate", async () => {
    const { services } = stubServices();
    const fx = buildToolDefinitions(services).find((t) => t.name === "get_exchange_rate");
    assert.ok(/pesos[^.]*COP/i.test(fx.description), fx.description);
    assert.ok(/no amount/i.test(fx.description), fx.description);
  });

  await check("ROUTER_MODE defaults to regex; only 'tools' enables tools mode", async () => {
    assert.strictEqual(parseRouterMode(undefined), "regex");
    assert.strictEqual(parseRouterMode(""), "regex");
    assert.strictEqual(parseRouterMode("regex"), "regex");
    assert.strictEqual(parseRouterMode("TOOLS"), "tools");
    assert.strictEqual(parseRouterMode(" tools "), "tools");
    assert.strictEqual(parseRouterMode("auto"), "regex");
  });

  await check("TOOL_DEADLINE_MS defaults to 2500 and rejects junk", async () => {
    assert.strictEqual(parseToolDeadlineMs(undefined), 2500);
    assert.strictEqual(parseToolDeadlineMs("4000"), 4000);
    assert.strictEqual(parseToolDeadlineMs("abc"), 2500);
    assert.strictEqual(parseToolDeadlineMs("0"), 2500);
    assert.strictEqual(parseToolDeadlineMs("-5"), 2500);
  });

  await check("shadow agreement compares regex intent to model tool choice", async () => {
    assert.strictEqual(toolChoiceAgreement("weather", ["get_weather", "get_weather"]), "agree");
    assert.strictEqual(toolChoiceAgreement("hotel", ["find_places"]), "agree");
    assert.strictEqual(toolChoiceAgreement("chat", []), "agree");
    assert.strictEqual(toolChoiceAgreement("chat", ["get_news"]), "model_used_tool");
    assert.strictEqual(toolChoiceAgreement("fx", []), "model_skipped_tool");
    assert.strictEqual(toolChoiceAgreement("fx", ["get_crypto_price"]), "different_tool");
  });

  const webSearchStub = (calls, result = { results: [{ title: "T", source: "s.com", snippet: "x" }] }) => ({
    enabled: true,
    search: (q) => {
      calls.push(["webSearch.search", q]);
      return Promise.resolve(result);
    },
  });

  await check("web_search is not offered unless the web search service is enabled", async () => {
    const { services } = stubServices({ webSearchService: { enabled: false } });
    assert.ok(!buildToolDefinitions(services).some((t) => t.name === "web_search"));
  });

  await check("web_search is offered when enabled, as the fallback, never for billing", async () => {
    const { services, calls } = stubServices();
    services.webSearchService = webSearchStub(calls);
    const def = buildToolDefinitions(services).find((t) => t.name === "web_search");
    assert.ok(def, "web_search offered");
    assert.deepStrictEqual(def.parameters.required, ["query"]);
    assert.ok(/no other tool/i.test(def.description), def.description);
    assert.ok(/(billing|minutes|plan)/i.test(def.description), def.description);
  });

  await check("web_search runs the search service with the model's query", async () => {
    const { services, calls } = stubServices();
    services.webSearchService = webSearchStub(calls);
    const ex = createToolExecutor({ services, logger });
    const r = await ex.execute("web_search", { query: "gas price Miami today" });
    assert.deepStrictEqual(calls, [["webSearch.search", "gas price Miami today"]]);
    assert.strictEqual(r.results.length, 1);
  });

  await check("web_search with no query asks instead of searching", async () => {
    const { services, calls } = stubServices();
    services.webSearchService = webSearchStub(calls);
    const ex = createToolExecutor({ services, logger });
    const r = await ex.execute("web_search", {});
    assert.ok(r.error);
    assert.deepStrictEqual(calls, []);
  });

  await check("tools rules forbid stating unchecked live facts and unrelated tools", async () => {
    assert.ok(/never state live/i.test(TOOLS_SESSION_RULES), TOOLS_SESSION_RULES);
    assert.ok(/open or closed/i.test(TOOLS_SESSION_RULES));
    assert.ok(/unrelated tool/i.test(TOOLS_SESSION_RULES));
    assert.ok(/never state live/i.test(toolsTurnInstruction("English")));
  });

  await check("follow-up answer may only state facts in the results (a place listing doesn't prove it's open)", async () => {
    const f = toolsFollowUpInstruction("English");
    assert.ok(/only facts that appear in the results/i.test(f), f);
    assert.ok(/couldn't confirm/i.test(f), f);
  });

  await check("web search session rule names the tool and is separate from the base rules", async () => {
    assert.ok(/web_search/.test(WEB_SEARCH_SESSION_RULE));
    assert.ok(!/web_search/.test(TOOLS_SESSION_RULES));
  });

  console.log(`\n${process.exitCode ? "Some checks failed" : `All ${passed} checks passed`}`);
})();
