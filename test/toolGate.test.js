/**
 * Live-tool gate: asks the platform before a paid lookup, says why when a tool is
 * not in the plan or used up, gives the unit back when the lookup fails, and keeps
 * answering (counting later) when the platform can't be reached.
 * Run: node test/toolGate.test.js
 */
const assert = require("assert");
const { createToolGate, toolLimitKey, labelLimitKey } = require("../services/toolGate");

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
const silent = { info() {}, warn() {}, error() {} };

function fakeApi(answer) {
  const sent = [];
  const queued = [];
  return {
    sent,
    queued,
    enabled: true,
    toolUse: async (payload) => {
      sent.push(payload);
      return typeof answer === "function" ? answer(payload) : answer;
    },
    queueToolReport: (kind, payload) => queued.push({ kind, payload }),
  };
}
const session = (tools, extra = {}) => ({ platformUserId: "u1", billingMode: "subscriber_platinum", toolAccess: tools, ...extra });

(async () => {
  console.log("tool gate\n");

  await check("tool names map to plan limit keys; time is free", async () => {
    assert.strictEqual(toolLimitKey("get_weather", {}), "weather");
    assert.strictEqual(toolLimitKey("find_places", { kind: "hotel" }), "hotels");
    assert.strictEqual(toolLimitKey("find_places", { kind: "food" }), "maps");
    assert.strictEqual(toolLimitKey("find_places", { kind: "local_service" }), "maps");
    assert.strictEqual(toolLimitKey("get_flight_fare", {}), "flights");
    assert.strictEqual(toolLimitKey("get_flight_status", {}), "flights");
    for (const t of ["web_search", "get_news", "get_sports_scores", "get_crypto_price", "get_stock_quote", "get_us_interest_rate", "get_exchange_rate"]) {
      assert.strictEqual(toolLimitKey(t, {}), "research", t);
    }
    assert.strictEqual(toolLimitKey("get_time", {}), null);
    assert.strictEqual(labelLimitKey("places_hotels"), "hotels");
    assert.strictEqual(labelLimitKey("travel_fare"), "flights");
    assert.strictEqual(labelLimitKey("world_time"), null);
  });

  await check("unlimited (old plans): no question asked", async () => {
    const api = fakeApi({ ok: true, data: { allowed: true } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "unlimited", limits: {} }), callSid: "CA1", logger: silent });
    const g = await gate.check("weather", "get_weather");
    assert.strictEqual(g.ok, true);
    assert.strictEqual(api.sent.length, 0);
  });

  await check("an older platform that sends no tool info: tools stay on", async () => {
    const api = fakeApi({ ok: true, data: { allowed: true } });
    const gate = createToolGate({ platformApi: api, session: session(undefined), callSid: "CA1", logger: silent });
    assert.strictEqual((await gate.check("weather", "get_weather")).ok, true);
    assert.strictEqual(api.sent.length, 0);
  });

  await check("Basic: refused at once with an upgrade offer, nothing sent", async () => {
    const api = fakeApi({ ok: true, data: { allowed: true } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "none", limits: {} }), callSid: "CA1", logger: silent });
    const g = await gate.check("weather", "get_weather");
    assert.strictEqual(g.ok, false);
    assert.match(g.say, /isn't included in your plan/);
    assert.match(g.say, /upgrade/);
    assert.strictEqual(api.sent.length, 0);
  });

  await check("free minute: members only", async () => {
    const api = fakeApi({ ok: true, data: { allowed: true } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "none", limits: {} }, { billingMode: "trial", platformUserId: null }), callSid: "CA1", logger: silent });
    const g = await gate.check("flights", "get_flight_fare");
    assert.strictEqual(g.ok, false);
    assert.match(g.say, /for members/);
  });

  await check("Plus: reserves with a unique key per request", async () => {
    const api = fakeApi({ ok: true, data: { allowed: true, limit: 50, used: 3 } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "limited", limits: { weather: 50 } }), callSid: "CA9", logger: silent });
    assert.strictEqual((await gate.check("weather", "get_weather")).ok, true);
    assert.strictEqual((await gate.check("weather", "get_weather")).ok, true);
    assert.strictEqual(api.sent.length, 2);
    assert.strictEqual(api.sent[0].action, "reserve");
    assert.strictEqual(api.sent[0].userId, "u1");
    assert.strictEqual(api.sent[0].tool, "weather");
    assert.notStrictEqual(api.sent[0].key, api.sent[1].key);
    assert.ok(api.sent[0].key.startsWith("CA9:"));
  });

  await check("a tool the plan has no number for is refused without asking", async () => {
    const api = fakeApi({ ok: true, data: { allowed: true } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "limited", limits: { weather: 50 } }), callSid: "CA1", logger: silent });
    const g = await gate.check("flights", "get_flight_fare");
    assert.strictEqual(g.ok, false);
    assert.strictEqual(api.sent.length, 0);
  });

  await check("limit reached: says how many, when they reset, and offers an upgrade", async () => {
    const api = fakeApi({ ok: true, data: { allowed: false, reason: "limit_reached", limit: 50, used: 50, resetsAt: "2026-12-10T00:00:00.000Z", canUpgrade: true } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "limited", limits: { weather: 50 } }), callSid: "CA1", logger: silent });
    const g = await gate.check("weather", "get_weather");
    assert.strictEqual(g.ok, false);
    assert.match(g.say, /all 50 weather checks/);
    assert.match(g.say, /December 10/);
    assert.match(g.say, /upgrade/);
  });

  await check("Family Premium at its limit: no upgrade offer", async () => {
    const api = fakeApi({ ok: true, data: { allowed: false, reason: "limit_reached", limit: 100, resetsAt: "2026-12-10T00:00:00.000Z", canUpgrade: false } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "limited", limits: { weather: 100 } }), callSid: "CA1", logger: silent });
    const g = await gate.check("weather", "get_weather");
    assert.ok(!/upgrade/.test(g.say));
  });

  await check("lookup failed: the unit is given back, through the outbox", async () => {
    const api = fakeApi({ ok: true, data: { allowed: true } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "limited", limits: { maps: 10 } }), callSid: "CA1", logger: silent });
    const g = await gate.check("maps", "find_places");
    g.done({ error: "That lookup isn't available right now." });
    g.done({ error: "again" }); // only once
    assert.strictEqual(api.queued.length, 1);
    assert.strictEqual(api.queued[0].kind, "tool-release");
    assert.strictEqual(api.queued[0].payload.key, api.sent[0].key);
  });

  await check("lookup worked: nothing given back", async () => {
    const api = fakeApi({ ok: true, data: { allowed: true } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "limited", limits: { maps: 10 } }), callSid: "CA1", logger: silent });
    const g = await gate.check("maps", "find_places");
    g.done({ places: [{ name: "Cafe" }] });
    assert.strictEqual(api.queued.length, 0);
  });

  await check("platform down or slow: the caller still gets the answer, the use is counted later", async () => {
    const api = fakeApi(() => new Promise(() => {})); // never answers
    const gate = createToolGate({ platformApi: api, session: session({ mode: "limited", limits: { research: 20 } }), callSid: "CA1", logger: silent, timeoutMs: 30 });
    const started = Date.now();
    const g = await gate.check("research", "web_search");
    assert.strictEqual(g.ok, true);
    assert.ok(Date.now() - started < 500);
    assert.strictEqual(api.queued.length, 0);
    g.done({ temperature: 72 });
    g.done({ temperature: 72 });
    assert.strictEqual(api.queued.length, 1);
    assert.strictEqual(api.queued[0].kind, "tool-record");
    assert.strictEqual(api.queued[0].payload.key, api.sent[0].key);
  });

  await check("platform down and the lookup failed: the unit is given back in case the reserve did arrive", async () => {
    const api = fakeApi(() => new Promise(() => {}));
    const gate = createToolGate({ platformApi: api, session: session({ mode: "limited", limits: { research: 20 } }), callSid: "CA1", logger: silent, timeoutMs: 20 });
    const g = await gate.check("research", "web_search");
    g.done({ error: "failed" });
    assert.strictEqual(api.queued.length, 1);
    assert.strictEqual(api.queued[0].kind, "tool-release");
  });

  await check("platform error answer: also fail-open and counted later", async () => {
    const api = fakeApi({ ok: false, status: 503 });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "limited", limits: { research: 20 } }), callSid: "CA1", logger: silent });
    const g = await gate.check("research", "web_search");
    assert.strictEqual(g.ok, true);
    g.done({ results: [] });
    assert.strictEqual(api.queued[0].kind, "tool-record");
  });

  await check("tool info unknown on the platform side (check): asks every time", async () => {
    const api = fakeApi({ ok: true, data: { allowed: false, reason: "not_in_plan", canUpgrade: true } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "check", limits: {} }), callSid: "CA1", logger: silent });
    const g = await gate.check("hotels", "find_places");
    assert.strictEqual(api.sent.length, 1);
    assert.strictEqual(g.ok, false);
    assert.match(g.say, /isn't included in your plan/);
  });

  await check("keys differ between two streams of the same call", async () => {
    const api = fakeApi({ ok: true, data: { allowed: true } });
    const s = session({ mode: "limited", limits: { weather: 50 } });
    await createToolGate({ platformApi: api, session: s, callSid: "CA1", logger: silent }).check("weather", "get_weather");
    await createToolGate({ platformApi: api, session: s, callSid: "CA1", logger: silent }).check("weather", "get_weather");
    assert.notStrictEqual(api.sent[0].key, api.sent[1].key);
  });

  await check("Family Premium without a tool in its limits: no upgrade offer", async () => {
    const api = fakeApi({ ok: true, data: { allowed: true } });
    const gate = createToolGate({ platformApi: api, session: session({ mode: "limited", limits: { weather: 100 }, canUpgrade: false }), callSid: "CA1", logger: silent });
    const g = await gate.check("flights", "get_flight_fare");
    assert.ok(!/upgrade/.test(g.say), g.say);
  });

  console.log(`\n${passed} passed`);
})();
