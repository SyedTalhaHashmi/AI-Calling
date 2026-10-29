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
  toolResultLogFields,
  carriedOverPlace,
  marketClock,
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
    travelService: {
      enabled: true,
      cheapestRoute: rec("travel.cheapestRoute", { price: 376 }),
      fareForTrip: rec("travel.fareForTrip", { price: 446, match: "exact" }),
    },
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

  await check("get_flight_fare with dates prices those dates (one-way unless a return date)", async () => {
    const { services, calls } = stubServices();
    const ex = createToolExecutor({ services, logger, deadlineMs: 1000 });
    await ex.execute("get_flight_fare", { origin: "bog", destination: "mia", departure_date: "2026-11-02", return_date: "2026-11-06" });
    await ex.execute("get_flight_fare", { origin: "bog", destination: "mia", departure_date: "2026-12" });
    assert.deepStrictEqual(calls, [
      ["travel.fareForTrip", "BOG", "MIA", { departDate: "2026-11-02", returnDate: "2026-11-06", departMonth: null, oneWay: false }],
      ["travel.fareForTrip", "BOG", "MIA", { departDate: null, returnDate: null, departMonth: "2026-12", oneWay: true }],
    ]);
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

  // "What time does Walmart close tonight?" after Miami questions was searched as "… in Miami …"
  await check("web_search examples name no city (the old 'gas price Miami today' biased queries to Miami)", async () => {
    const { services, calls } = stubServices();
    services.webSearchService = webSearchStub(calls);
    const def = buildToolDefinitions(services).find((t) => t.name === "web_search");
    const text = `${def.description} ${def.parameters.properties.query.description}`;
    assert.ok(!/miami|bogota|cartagena|london/i.test(text), text);
    assert.ok(/only if the caller (named|gave) it/i.test(def.parameters.properties.query.description), text);
    // Live replay: a turn-level rule alone still produced "Walmart closing time in Miami tonight"
    assert.ok(/didn't name one/i.test(def.description) && /ask which city/i.test(def.description), def.description);
  });

  // Live replay: with the UTC clock in the prompt, "15:15" from LaLiga became "15:15 UTC"
  await check("follow-up forbids adding a time zone the results don't state", async () => {
    const f = toolsFollowUpInstruction("English", { now: Date.UTC(2026, 9, 27) });
    assert.ok(/never add a time zone/i.test(f), f);
  });

  await check("location rule: reuse an earlier place only when clearly continuing, otherwise ask", async () => {
    for (const text of [TOOLS_SESSION_RULES, toolsTurnInstruction("English")]) {
      assert.ok(/didn't name|doesn't name/i.test(text), text);
      assert.ok(/clearly continuing/i.test(text), text);
      assert.ok(/ask which city/i.test(text), text);
    }
  });

  await check("follow-up gives the current UTC date and time so 'today' and 'now' can be judged", async () => {
    const f = toolsFollowUpInstruction("English", { now: Date.UTC(2026, 9, 27, 9, 25) });
    assert.ok(/Tuesday, October 27, 2026/.test(f), f);
    assert.ok(/09:25 UTC/.test(f), f);
    assert.ok(/which place/i.test(f), f);
  });

  await check("follow-up after web search: name the source, no 'most'/'all', conflicting or undated → couldn't confirm", async () => {
    const f = toolsFollowUpInstruction("English", { now: Date.UTC(2026, 9, 27), webSearch: true });
    assert.ok(/name the source/i.test(f), f);
    assert.ok(/"most" or "all"/i.test(f), f);
    assert.ok(/disagree/i.test(f) && /current/i.test(f) && /couldn't confirm/i.test(f), f);
    assert.ok(!/miami/i.test(f), "example must not bias toward a city");
    const plain = toolsFollowUpInstruction("English", { now: Date.UTC(2026, 9, 27) });
    assert.ok(!/name the source/i.test(plain), "source rule only after a web search");
  });

  await check("web_search log fields keep query and sources, never titles or snippet text", async () => {
    const result = {
      results: [
        { title: "Title-AAA", source: "miamiherald.com", published: "2026-10-27", snippet: "SNIPPET-BODY $4.07" },
        { title: "Title-BBB", source: "gasolytics.com", snippet: "SNIPPET-BODY-2" },
      ],
    };
    const fields = toolResultLogFields("web_search", { query: "gas price Miami today" }, result);
    const json = JSON.stringify(fields);
    assert.ok(!/SNIPPET|Title-/.test(json), json);
    assert.deepStrictEqual(fields, {
      args: { query: "gas price Miami today" },
      result: { count: 2, sources: ["miamiherald.com", "gasolytics.com"], published: ["2026-10-27", null] },
    });
    assert.deepStrictEqual(toolResultLogFields("web_search", { query: "q" }, { error: "No web results found." }), {
      args: { query: "q" },
      result: { error: "No web results found." },
    });
  });

  // Location guard: a place the caller named only in an earlier request is not searched unless they continue that topic
  const miamiEarlier = ["Is it hot in Miami or Orlando today?", "What is the average gas price in Miami today?"];
  const walmartQuery = { query: "Walmart closing time in Miami tonight" };

  await check("guard: unrelated follow-up — web search with an earlier city is blocked", async () => {
    const ctx = { latest: "What time does Walmart close tonight?", earlier: miamiEarlier };
    assert.strictEqual(carriedOverPlace("web_search", walmartQuery, ctx), "Miami");
    assert.strictEqual(
      carriedOverPlace("web_search", { query: "Walmart hours Orlando today" }, ctx),
      "Orlando"
    );
  });

  await check("guard: unrelated follow-up — place search with an earlier city is blocked", async () => {
    const ctx = { latest: "Find me a hotel", earlier: ["What's the weather in Bogota?"] };
    assert.strictEqual(carriedOverPlace("find_places", { kind: "hotel", location: "Bogota" }, ctx), "Bogota");
    assert.strictEqual(
      carriedOverPlace("find_places", { kind: "local_service", location: "Miami, FL", query: "pharmacy" }, {
        latest: "I need a pharmacy",
        earlier: ["Is Miami airport open today?"],
      }),
      "Miami"
    );
    // "Is there …" is not "there" the place
    assert.strictEqual(
      carriedOverPlace("find_places", { kind: "local_service", location: "Miami", query: "pharmacy" }, {
        latest: "Is there a pharmacy open tonight?",
        earlier: miamiEarlier,
      }),
      "Miami"
    );
  });

  await check("follow-up: a place question from the guard is asked, not reported as a failed lookup", async () => {
    assert.ok(/askCaller/.test(toolsFollowUpInstruction("English", { now: 0 })));
  });

  await check("guard: clear continuations may reuse the earlier city", async () => {
    for (const latest of [
      "Is there a Walmart there?",
      "What time does it close?",
      "And the Walmart?",
      "What about Walmart?",
      "Same city, what time does Walmart close?",
      "¿Y a qué hora cierra el Walmart allí?",
    ]) {
      assert.strictEqual(carriedOverPlace("web_search", walmartQuery, { latest, earlier: miamiEarlier }), null, latest);
    }
  });

  await check("guard: allows places named now, searches without a place, and new places", async () => {
    const earlier = miamiEarlier;
    const allowed = [
      ["web_search", walmartQuery, "What time does the Walmart in Miami close tonight?"],
      ["web_search", { query: "Walmart closing time tonight" }, "What time does Walmart close tonight?"],
      ["web_search", { query: "gas price Tampa today" }, "What's the gas price in Tampa?"],
      ["find_places", { kind: "hotel", location: "Miami" }, "Find me a hotel in miami"],
      ["web_search", { query: "Is the stock market open today" }, "Is the stock market open today?"],
    ];
    for (const [name, args, latest] of allowed) {
      assert.strictEqual(carriedOverPlace(name, args, { latest, earlier }), null, latest);
    }
    assert.strictEqual(carriedOverPlace("web_search", walmartQuery, { latest: "Walmart hours?", earlier: [] }), null);
  });

  await check("guard: only web_search and find_places, and non-place names (teams, days) are not places", async () => {
    const ctx = { latest: "What time does Walmart close tonight?", earlier: miamiEarlier };
    assert.strictEqual(carriedOverPlace("get_weather", { city: "Miami" }, ctx), null);
    assert.strictEqual(
      carriedOverPlace("web_search", { query: "Real Madrid last match result" }, {
        latest: "Who won the last match?",
        earlier: ["When is the next Real Madrid match?"],
      }),
      null
    );
    assert.strictEqual(
      carriedOverPlace("web_search", { query: "Walmart hours Monday" }, {
        latest: "Is Walmart open?",
        earlier: ["I fly to Miami on Monday"],
      }),
      null
    );
  });

  await check("runToolCalls: a guard result replaces the lookup (service never called)", async () => {
    const executed = [];
    const executor = { execute: async (name) => (executed.push(name), { ok: true }) };
    const calls = [
      { call_id: "a", name: "web_search", arguments: JSON.stringify(walmartQuery) },
      { call_id: "b", name: "get_weather", arguments: JSON.stringify({ city: "Miami" }) },
    ];
    const guard = (name) => (name === "web_search" ? { error: "ask which city" } : null);
    const out = await runToolCalls(calls, executor, { guard });
    assert.deepStrictEqual(executed, ["get_weather"]);
    assert.deepStrictEqual(out[0].result, { error: "ask which city" });
    assert.deepStrictEqual(out[1].result, { ok: true });
  });

  // Stock market: "open… ongoing" was said at 7:58 AM ET from a "regular trading day" snippet
  await check("marketClock: New York time and regular-session flag (DST-aware, weekends closed)", async () => {
    const pre = marketClock(Date.UTC(2026, 9, 27, 11, 58)); // Tue 7:58 AM EDT
    assert.strictEqual(pre.withinRegularHours, false);
    assert.ok(/Tuesday/.test(pre.newYorkTime) && /7:58 AM/.test(pre.newYorkTime), pre.newYorkTime);
    assert.strictEqual(marketClock(Date.UTC(2026, 9, 27, 13, 30)).withinRegularHours, true); // 9:30 AM
    assert.strictEqual(marketClock(Date.UTC(2026, 9, 27, 19, 59)).withinRegularHours, true); // 3:59 PM
    assert.strictEqual(marketClock(Date.UTC(2026, 9, 27, 20, 0)).withinRegularHours, false); // 4:00 PM
    assert.strictEqual(marketClock(Date.UTC(2026, 9, 31, 15, 0)).withinRegularHours, false); // Saturday
    assert.strictEqual(marketClock(Date.UTC(2026, 11, 1, 14, 45)).withinRegularHours, true); // 9:45 AM EST
    assert.strictEqual(marketClock(Date.UTC(2026, 11, 1, 14, 15)).withinRegularHours, false); // 9:15 AM EST
  });

  await check("web_search about stock market hours adds the market clock and the no-claim rule", async () => {
    const { services, calls } = stubServices();
    services.webSearchService = webSearchStub(calls);
    const ex = createToolExecutor({ services, logger, now: () => Date.UTC(2026, 9, 27, 11, 58) });
    const r = await ex.execute("web_search", { query: "Is the stock market open today" });
    assert.strictEqual(r.results.length, 1);
    assert.strictEqual(r.marketClock.withinRegularHours, false);
    assert.ok(/couldn't confirm/i.test(r.marketClock.rule) && /open right now/i.test(r.marketClock.rule), r.marketClock.rule);
    const nyse = await ex.execute("web_search", { query: "NYSE hours today" });
    assert.ok(nyse.marketClock);
    const gas = await ex.execute("web_search", { query: "gas price Tampa today" });
    assert.strictEqual(gas.marketClock, undefined);
    const quote = await ex.execute("web_search", { query: "Apple stock price today" });
    assert.strictEqual(quote.marketClock, undefined, "a price lookup is not a market-status question");
  });

  await check("market clock is also added when the search fails, so 'couldn't confirm' still applies", async () => {
    const { services, calls } = stubServices();
    services.webSearchService = webSearchStub(calls, { error: "No web results found." });
    const ex = createToolExecutor({ services, logger, now: () => Date.UTC(2026, 9, 27, 14, 0) });
    const r = await ex.execute("web_search", { query: "is the stock market open right now" });
    assert.strictEqual(r.error, "No web results found.");
    assert.strictEqual(r.marketClock.withinRegularHours, true);
  });

  // Local test call: "and any rain prediction" got "no rain predicted" from the current sky alone
  await check("weather tool: returns today/tomorrow forecast, nothing later is guessed", async () => {
    const { services } = stubServices();
    const w = buildToolDefinitions(services).find((t) => t.name === "get_weather");
    assert.ok(/today's and tomorrow's/i.test(w.description), w.description);
    assert.ok(/chance of rain/i.test(w.description), w.description);
    assert.ok(/only check today and tomorrow/i.test(w.description), w.description);
  });

  // Local test call: asked for PIA, got a 9P (Fly Jinnah) fare with no airline named
  await check("fare tool: cheapest across all airlines; say the airline and flag a different one", async () => {
    const { services } = stubServices();
    const f = buildToolDefinitions(services).find((t) => t.name === "get_flight_fare");
    assert.ok(/all airlines/i.test(f.description), f.description);
    assert.ok(/say the airline/i.test(f.description), f.description);
    assert.ok(/asked for a specific airline/i.test(f.description), f.description);
  });

  // Local test call: hotel list was described as "ready for booking"
  await check("places tool: results never prove availability, booking, or open status", async () => {
    const { services } = stubServices();
    const p = buildToolDefinitions(services).find((t) => t.name === "find_places");
    assert.ok(/names, addresses, and ratings only/i.test(p.description), p.description);
    assert.ok(/available|bookable/i.test(p.description), p.description);
  });

  await check("other tools' log fields are unchanged", async () => {
    const r = { city: "Miami", temp: 24 };
    assert.deepStrictEqual(toolResultLogFields("get_weather", { city: "Miami" }, r), {
      args: { city: "Miami" },
      result: r,
    });
  });

  console.log(`\n${process.exitCode ? "Some checks failed" : `All ${passed} checks passed`}`);
})();
