/**
 * Router modes end-to-end through handlers/mediaStream.js with a fake OpenAI Realtime server
 * and a fake Twilio socket (no network, no OpenAI usage).
 * Run: node test/mediaStreamRouting.test.js
 */
const assert = require("assert");
const { EventEmitter } = require("events");
const WebSocket = require("ws");
const createMediaStreamHandler = require("../handlers/mediaStream");
const { CallStore } = require("../utils/callStore");
const createTimeService = require("../services/time");

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const silent = { info() {}, warn() {}, error() {}, debug() {} };

async function waitFor(pred, timeoutMs = 1500) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await sleep(5);
  }
}

class FakeTwilio extends EventEmitter {
  constructor() {
    super();
    this.readyState = WebSocket.OPEN;
    this.sent = [];
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
}

function stubServices({ weatherDelayMs = 0, webSearch = false, fxError = false, ratesError = false, flights = false } = {}) {
  const calls = [];
  const services = {
    webSearchService: webSearch
      ? {
          enabled: true,
          search: async (q) => {
            calls.push(["webSearch", q]);
            return { results: [{ title: "Title-T", source: "s.com", snippet: "SNIPPET-BODY $4.07" }] };
          },
        }
      : { enabled: false },
    weatherService: { enabled: true, getByCity: async () => ({ temp: 1 }) },
    openMeteoService: {
      enabled: true,
      getByCity: async (city, country) => {
        calls.push(["weather", city, country]);
        if (weatherDelayMs) await sleep(weatherDelayMs);
        return { city, country: country || "CO", temp: 18, description: "foggy" };
      },
    },
    timeService: createTimeService(),
    worldTimeService: {
      enabled: false,
      getTimeByTimezone: async (tz) => {
        calls.push(["worldTime", tz]);
        return { error: "disabled" };
      },
    },
    placesService: { enabled: false },
    travelService: { enabled: false },
    newsService: { enabled: false },
    fxService: fxError
      ? {
          enabled: true,
          parsePairFromUtterance: () => ({ base: null, quote: null }),
          getRate: async () => ({ error: "Could not fetch exchange rate." }),
        }
      : { enabled: false },
    sportsService: { enabled: false, detectSport: () => "football" },
    flightsService: flights
      ? {
          enabled: true,
          getFlightStatus: async (n) => {
            calls.push(["flight", n]);
            return n ? { message: `Flight ${n} is on time.` } : { error: "Please say the flight number." };
          },
        }
      : { enabled: false },
    stocksService: {
      enabled: true,
      getCryptoQuote: async (t) => {
        calls.push(["crypto", t]);
        return { message: "BTC is about $80000 U S D right now." };
      },
      getQuote: async () => ({ message: "AAPL is $1." }),
      getUsInterestRate: async () => {
        if (ratesError) throw new Error("rates down");
        return { message: "3.75" };
      },
    },
  };
  return { services, calls };
}

/** Starts a call against a fake Realtime server; greeting already completed. */
async function startCall({ routerMode, weatherDelayMs, webSearch, fxError, ratesError, flights, logs, session } = {}) {
  const server = new WebSocket.Server({ port: 0 });
  await new Promise((r) => server.on("listening", r));
  const received = [];
  let sock = null;
  server.on("connection", (ws) => {
    sock = ws;
    ws.on("message", (d) => received.push(JSON.parse(d.toString())));
  });

  const { services, calls } = stubServices({ weatherDelayMs, webSearch, fxError, ratesError, flights });
  const callStore = new CallStore();
  // session: billing fields as /incoming-call would set them (e.g. a 60-second trial)
  if (session) Object.assign(callStore.getOrCreate("CAtest"), session);
  const handler = createMediaStreamHandler({
    callStore,
    // logs: optional array that collects [fields, message] for every log line
    logger: logs ? { ...silent, info: (fields, msg) => logs.push([fields, msg]) } : silent,
    openaiApiKey: "test",
    ...services,
    twilioClient: null,
    latencyMetricsEnabled: false,
    routerMode,
    toolDeadlineMs: 1000,
    realtimeUrl: `ws://127.0.0.1:${server.address().port}`,
  });
  const twilio = new FakeTwilio();
  handler(twilio, {});
  twilio.emit("message", JSON.stringify({ event: "start", start: { callSid: "CAtest", streamSid: "MZtest" } }));

  let respSeq = 0;
  const call = {
    received,
    calls,
    creates: () => received.filter((m) => m.type === "response.create"),
    emit: (ev) => sock.send(JSON.stringify(ev)),
    async completeLast(output = []) {
      const create = call.creates().at(-1);
      const gen = create.response.metadata.client_gen;
      const id = `resp${++respSeq}`;
      call.emit({ type: "response.created", response: { id, metadata: { client_gen: gen } } });
      await sleep(10);
      call.emit({
        type: "response.done",
        response: { id, status: "completed", metadata: { client_gen: gen }, output },
      });
      await sleep(20);
    },
    async say(text, itemId = `item${Date.now()}`) {
      call.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: itemId, transcript: text });
      await sleep(30);
    },
    close() {
      twilio.emit("message", JSON.stringify({ event: "stop" }));
      server.close();
    },
  };

  await waitFor(() => sock && call.creates().length === 1);
  await call.completeLast([]);
  return call;
}

const weatherCall = (callId, args) => ({
  type: "function_call",
  name: "get_weather",
  call_id: callId,
  arguments: JSON.stringify(args),
});

(async () => {
  console.log("mediaStream routing\n");

  await check("regex mode (default): session offers only the legacy weather tool", async () => {
    const c = await startCall({});
    const upd = c.received.find((m) => m.type === "session.update");
    assert.deepStrictEqual(upd.session.tools.map((t) => t.name), ["get_weather"]);
    assert.ok(!/Live data tools/.test(upd.session.instructions));
    c.close();
  });

  await check("regex mode: crypto fast path unchanged", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("What's the price of bitcoin?");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    assert.ok(/^Say the following in English only/.test(r.instructions), r.instructions);
    assert.ok(/BTC is about/.test(r.instructions));
    assert.deepStrictEqual(r.tools, []);
    assert.deepStrictEqual(c.calls, [["crypto", "What's the price of bitcoin?"]]);
    c.close();
  });

  await check("regex mode: weather fast path unchanged", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("What's the weather in Bogota?");
    await waitFor(() => c.creates().length === 2);
    assert.ok(/18 degrees and foggy/.test(c.creates()[1].response.instructions));
    c.close();
  });

  await check("regex mode: time in an unlisted city uses its local zone, not UTC", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("What time is it in Bogota?");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    const expected = createTimeService().getCurrentTime("America/Bogota").time;
    assert.ok(r.instructions.includes(`${expected} in Bogota`), r.instructions);
    assert.ok(!/UTC/.test(r.instructions), r.instructions);
    assert.deepStrictEqual(c.calls, [], "world time API not called");
    c.close();
  });

  await check("regex mode: time with no place asks which city", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("What time is it?");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    assert.ok(/Which city/i.test(r.instructions), r.instructions);
    assert.ok(!/\d{1,2}:\d{2}/.test(r.instructions), "no time guessed");
    c.close();
  });

  await check("regex mode: naming a city after 'Which city?' answers the time", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("What time is it?");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([]);
    await c.say("Madrid", "item-city");
    await waitFor(() => c.creates().length === 3);
    const expected = createTimeService().getCurrentTime("Europe/Madrid").time;
    assert.ok(c.creates()[2].response.instructions.includes(`${expected} in Madrid`));
    c.close();
  });

  await check("regex mode: an unrelated reply after 'Which city?' goes to normal chat", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("What time is it?");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([]);
    await c.say("Tell me a fun fact about octopuses.", "item-chat");
    await waitFor(() => c.creates().length === 3);
    assert.ok(/^Reply in English only/.test(c.creates()[2].response.instructions));
    c.close();
  });

  await check("regex mode: business-hours question goes to normal chat, not the time handler", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("What time does the pharmacy open?");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    assert.ok(/^Reply in English only/.test(r.instructions), r.instructions);
    assert.ok(!/Which city/i.test(r.instructions), r.instructions);
    assert.deepStrictEqual(c.calls, [], "no time lookup");
    c.close();
  });

  await check("tools mode: session offers existing-service tools + tool rules", async () => {
    const c = await startCall({ routerMode: "tools" });
    const upd = c.received.find((m) => m.type === "session.update");
    const names = upd.session.tools.map((t) => t.name).sort();
    assert.deepStrictEqual(names, [
      "get_crypto_price",
      "get_stock_quote",
      "get_time",
      "get_us_interest_rate",
      "get_weather",
    ]);
    assert.ok(/Live data tools/.test(upd.session.instructions));
    assert.ok(!/web_search/.test(upd.session.instructions), "no web search rule when search is off");
    c.close();
  });

  await check("tools mode + web search enabled: session offers web_search and its rule", async () => {
    const c = await startCall({ routerMode: "tools", webSearch: true });
    const upd = c.received.find((m) => m.type === "session.update");
    assert.ok(upd.session.tools.some((t) => t.name === "web_search"));
    assert.ok(/web_search/.test(upd.session.instructions));
    c.close();
  });

  await check("tools mode: model's web_search call runs the search and returns its output", async () => {
    const c = await startCall({ routerMode: "tools", webSearch: true });
    await c.say("What's the price of gas in Miami today?");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([
      { type: "function_call", name: "web_search", call_id: "ws1", arguments: JSON.stringify({ query: "gas price Miami today" }) },
    ]);
    await waitFor(() => c.creates().length === 3);
    assert.deepStrictEqual(c.calls, [["webSearch", "gas price Miami today"]]);
    const out = c.received.find((m) => m.type === "conversation.item.create" && m.item?.call_id === "ws1");
    assert.ok(/s\.com/.test(out.item.output), out.item.output);
    c.close();
  });

  await check("tools mode: web search follow-up asks for the source and gives today's date", async () => {
    const c = await startCall({ routerMode: "tools", webSearch: true });
    await c.say("What's the price of gas in Miami today?");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([
      { type: "function_call", name: "web_search", call_id: "ws1", arguments: JSON.stringify({ query: "gas price Miami today" }) },
    ]);
    await waitFor(() => c.creates().length === 3);
    const follow = c.creates()[2].response.instructions;
    assert.ok(/name the source/i.test(follow), follow);
    assert.ok(follow.includes(String(new Date().getUTCFullYear())) && /UTC/.test(follow), follow);
    c.close();
  });

  /** Miami weather turn (lookup + spoken answer), then the next question; returns after the model's first round. */
  async function afterMiamiTurn(c, nextQuestion, searchQuery) {
    await c.say("Is it hot in Miami today?");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([weatherCall("w1", { city: "Miami", country: "US" })]);
    await waitFor(() => c.creates().length === 3);
    await c.completeLast([]);
    await c.say(nextQuestion);
    await waitFor(() => c.creates().length === 4);
    await c.completeLast([
      { type: "function_call", name: "web_search", call_id: "ws2", arguments: JSON.stringify({ query: searchQuery }) },
    ]);
    await waitFor(() => c.creates().length === 5);
    return c.received.find((m) => m.type === "conversation.item.create" && m.item?.call_id === "ws2");
  }

  await check("tools mode: unrelated follow-up — search with the earlier city is not run; model told to ask", async () => {
    const c = await startCall({ routerMode: "tools", webSearch: true });
    const out = await afterMiamiTurn(c, "What time does Walmart close tonight?", "Walmart closing time in Miami tonight");
    assert.ok(!c.calls.some(([n]) => n === "webSearch"), JSON.stringify(c.calls));
    assert.ok(/ask which city/i.test(out.item.output) && /Miami/.test(out.item.output), out.item.output);
    c.close();
  });

  await check("tools mode: clear continuation ('there') — search with the earlier city runs", async () => {
    const c = await startCall({ routerMode: "tools", webSearch: true });
    await afterMiamiTurn(c, "Is there a Walmart open there tonight?", "Walmart open tonight Miami");
    assert.deepStrictEqual(c.calls.filter(([n]) => n === "webSearch"), [["webSearch", "Walmart open tonight Miami"]]);
    c.close();
  });

  await check("tools mode: non-web lookups get the date but no source rule", async () => {
    const c = await startCall({ routerMode: "tools" });
    await c.say("Weather in Bogota?");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([weatherCall("c1", { city: "Bogota" })]);
    await waitFor(() => c.creates().length === 3);
    const follow = c.creates()[2].response.instructions;
    assert.ok(/UTC/.test(follow), follow);
    assert.ok(!/name the source/i.test(follow), follow);
    c.close();
  });

  await check("tools mode: web search log line has query and sources, never snippet text or titles", async () => {
    const logs = [];
    const c = await startCall({ routerMode: "tools", webSearch: true, logs });
    await c.say("What's the price of gas in Miami today?");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([
      { type: "function_call", name: "web_search", call_id: "ws1", arguments: JSON.stringify({ query: "gas price Miami today" }) },
    ]);
    await waitFor(() => c.creates().length === 3);
    const line = logs.find(([, msg]) => msg === "Tool result");
    assert.ok(line, "Tool result logged");
    const json = JSON.stringify(line[0]);
    assert.ok(!/SNIPPET|Title-T/.test(json), json);
    assert.ok(/s\.com/.test(json) && /gas price Miami today/.test(json), json);
    // The model still receives the full snippet
    const out = c.received.find((m) => m.type === "conversation.item.create" && m.item?.call_id === "ws1");
    assert.ok(/SNIPPET-BODY/.test(out.item.output), out.item.output);
    c.close();
  });

  await check("regex mode: normal chat turn forbids unchecked live facts", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("Is the Bogota airport open today?");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    assert.ok(/^Reply in English only/.test(r.instructions), r.instructions);
    assert.ok(/never state live/i.test(r.instructions), r.instructions);
    c.close();
  });

  await check("regex mode: a failed lookup is said as-is, with no added numbers", async () => {
    const c = await startCall({ routerMode: "regex", fxError: true });
    await c.say("What's the exchange rate from USD to COP?");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    // Spoken text is quoted; the guard sits outside the quotes so it is never read aloud
    assert.ok(/"Could not fetch exchange rate\."/.test(r.instructions), r.instructions);
    assert.ok(/^Say only the quoted sentence/.test(r.instructions), r.instructions);
    assert.ok(/no other facts or numbers/i.test(r.instructions.split('"')[0]), r.instructions);
    c.close();
  });

  await check("regex mode: 'Is it hot in Miami or Orlando?' looks up both cities, not Rome", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("Is it hot in Miami or Orlando?");
    await waitFor(() => c.creates().length === 2);
    assert.deepStrictEqual(
      c.calls.filter((x) => x[0] === "weather").map((x) => x[1]),
      ["Miami", "Orlando"]
    );
    c.close();
  });

  await check("regex mode: a crashed rate lookup says so without guessing a number", async () => {
    const c = await startCall({ routerMode: "regex", ratesError: true });
    await c.say("What is the U.S. interest rate?");
    await waitFor(() => c.creates().length === 2);
    const quoted = c.creates()[1].response.instructions.split('"')[1] || "";
    assert.ok(/couldn't/i.test(quoted), quoted);
    assert.ok(!/percent|\d/.test(quoted), quoted);
    c.close();
  });

  await check("regex mode: flight question without a number asks for it, no lookup", async () => {
    const c = await startCall({ routerMode: "regex", flights: true });
    await c.say("Is my flight delayed?");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    // Asked like the time handler's "Which city…?", not read out as a failed lookup
    assert.ok(/^Say the following in English only/.test(r.instructions), r.instructions);
    assert.ok(/which flight number/i.test(r.instructions), r.instructions);
    // No stray full stop after the question mark ("check?.")
    assert.ok(/check\?$/.test(r.instructions), r.instructions);
    assert.deepStrictEqual(c.calls, []);
    c.close();
  });

  await check("regex mode: flight question with a number looks it up", async () => {
    const c = await startCall({ routerMode: "regex", flights: true });
    await c.say("Is flight AA100 on time?");
    await waitFor(() => c.creates().length === 2);
    assert.deepStrictEqual(c.calls, [["flight", "AA100"]]);
    assert.ok(/Flight AA100 is on time/.test(c.creates()[1].response.instructions));
    c.close();
  });

  await check("regex mode with web search enabled: never offered, never called", async () => {
    const c = await startCall({ routerMode: "regex", webSearch: true });
    const upd = c.received.find((m) => m.type === "session.update");
    assert.deepStrictEqual(upd.session.tools.map((t) => t.name), ["get_weather"]);
    await c.say("What's the price of gas in Miami today?");
    await waitFor(() => c.creates().length === 2);
    assert.deepStrictEqual(c.calls, []);
    c.close();
  });

  await check("tools mode: live question → model turn with session tools (no fast path)", async () => {
    const c = await startCall({ routerMode: "tools" });
    await c.say("What's the weather in Bogota?");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    assert.ok(/acknowledgement/.test(r.instructions), r.instructions);
    assert.strictEqual(r.tools, undefined);
    assert.deepStrictEqual(c.calls, []);
    c.close();
  });

  await check("tools mode: function calls run, outputs returned, follow-up requested", async () => {
    const c = await startCall({ routerMode: "tools" });
    await c.say("Is it hot in Miami or Orlando?");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([
      { type: "message", content: [] },
      weatherCall("c1", { city: "Miami", country: "US" }),
      weatherCall("c2", { city: "Orlando", country: "US" }),
    ]);
    await waitFor(() => c.creates().length === 3);
    const outputs = c.received.filter((m) => m.type === "conversation.item.create");
    assert.deepStrictEqual(outputs.map((o) => o.item.call_id), ["c1", "c2"]);
    assert.strictEqual(outputs[0].item.type, "function_call_output");
    assert.strictEqual(JSON.parse(outputs[0].item.output).city, "Miami");
    const follow = c.creates()[2].response;
    assert.ok(/tool results/.test(follow.instructions), follow.instructions);
    assert.strictEqual(follow.tools, undefined);
    assert.deepStrictEqual(c.calls, [["weather", "Miami", "US"], ["weather", "Orlando", "US"]]);
    c.close();
  });

  await check("tools mode: a cancelled response is never looked up or answered", async () => {
    const c = await startCall({ routerMode: "tools", weatherDelayMs: 50 });
    await c.say("Weather in Bogota?");
    await waitFor(() => c.creates().length === 2);
    const gen = c.creates()[1].response.metadata.client_gen;
    c.emit({ type: "response.created", response: { id: "cx1", metadata: { client_gen: gen } } });
    await sleep(10);
    c.emit({ type: "response.output_item.done", response_id: "cx1", item: weatherCall("x1", { city: "Bogota" }) });
    c.emit({ type: "response.cancelled", response: { id: "cx1", metadata: { client_gen: gen } } });
    await sleep(150);
    assert.strictEqual(c.received.filter((m) => m.type === "conversation.item.create").length, 0);
    assert.strictEqual(c.creates().length, 2);
    c.close();
  });

  await check("tools mode: second tool round forces a spoken answer (tools: [])", async () => {
    const c = await startCall({ routerMode: "tools" });
    await c.say("Weather in Bogota?");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([weatherCall("c1", { city: "Bogota" })]);
    await waitFor(() => c.creates().length === 3);
    await c.completeLast([weatherCall("c2", { city: "Bogota" })]);
    await waitFor(() => c.creates().length === 4);
    assert.deepStrictEqual(c.creates()[3].response.tools, []);
    c.close();
  });

  await check("tools mode: billing question still uses the fixed billing reply", async () => {
    const c = await startCall({ routerMode: "tools" });
    await c.say("Is this call free?");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    assert.ok(/^Say the following in English only/.test(r.instructions), r.instructions);
    assert.ok(/buddycallai dot com/.test(r.instructions));
    assert.deepStrictEqual(r.tools, []);
    c.close();
  });

  for (const routerMode of ["tools", "regex"]) {
    await check(`${routerMode} mode: 'buddy call AI packages' gets the plan list, not "check their website"`, async () => {
      const c = await startCall({ routerMode });
      await c.say("can you please let me know the buddy call AI packages");
      await waitFor(() => c.creates().length === 2);
      const r = c.creates()[1].response;
      assert.ok(/^Say the following in English only/.test(r.instructions), r.instructions);
      assert.ok(/Silver/.test(r.instructions) && /69 dollars/.test(r.instructions), r.instructions);
      assert.deepStrictEqual(r.tools, []);
      c.close();
    });
  }

  await check("plan list reply is not squeezed into a 20-word sentence", async () => {
    const c = await startCall({ routerMode: "tools" });
    await c.say("What are the Buddy Call plans?");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    assert.ok(!/15 to 20 words/.test(r.instructions), r.instructions);
    assert.ok(/every name and number/i.test(r.instructions), r.instructions);
    c.close();
  });

  for (const routerMode of ["tools", "regex"]) {
    await check(`${routerMode} mode: "Do you speak Spanish?" offers in English; "Yes" switches to Spanish`, async () => {
      const c = await startCall({ routerMode });
      await c.say("Do you speak Spanish?");
      await waitFor(() => c.creates().length === 2);
      const offer = c.creates()[1].response;
      assert.ok(/^Say the following in English only/.test(offer.instructions), offer.instructions);
      assert.ok(/Would you like me to switch to Spanish/.test(offer.instructions), offer.instructions);
      assert.deepStrictEqual(offer.tools, []);
      await c.completeLast([]);
      await c.say("Yes");
      await waitFor(() => c.creates().length === 3);
      const switched = c.creates()[2].response;
      assert.ok(/^Say the following in Spanish only/.test(switched.instructions), switched.instructions);
      c.close();
    });
  }

  for (const routerMode of ["tools", "regex"]) {
    await check(`${routerMode} mode: "Who created you?" → fixed creator reply, no tools`, async () => {
      const c = await startCall({ routerMode });
      await c.say("Who created you?");
      await waitFor(() => c.creates().length === 2);
      const r = c.creates()[1].response;
      assert.ok(/^Say the following in English only/.test(r.instructions), r.instructions);
      assert.ok(/I was created by Brash3D Media Group\./.test(r.instructions), r.instructions);
      assert.deepStrictEqual(r.tools, []);
      c.close();
    });

    await check(`${routerMode} mode: "What's your name?" → I'm Buddy`, async () => {
      const c = await startCall({ routerMode });
      await c.say("What's your name?");
      await waitFor(() => c.creates().length === 2);
      assert.ok(/I'm Buddy/.test(c.creates()[1].response.instructions), c.creates()[1].response.instructions);
      c.close();
    });
  }

  for (const routerMode of ["tools", "regex"]) {
    await check(`${routerMode} mode: crisis message → caring turn with 988/911, no tools`, async () => {
      const c = await startCall({ routerMode });
      await c.say("I don't want to live anymore");
      await waitFor(() => c.creates().length === 2);
      const r = c.creates()[1].response;
      assert.ok(/988/.test(r.instructions) && /911/.test(r.instructions), r.instructions);
      assert.deepStrictEqual(r.tools, []);
      c.close();
    });
  }

  for (const routerMode of ["tools", "regex"]) {
    await check(`${routerMode} mode: ordinary model turns carry the sensitive-topic / capability note`, async () => {
      const c = await startCall({ routerMode });
      await c.say("Do you have any restrictions?");
      await waitFor(() => c.creates().length === 2);
      const r = c.creates()[1].response.instructions;
      assert.ok(/can check live weather/i.test(r) && /dating or relationships/i.test(r), r);
      c.close();
    });
  }

  await check("regex mode: a crisis message mentioning a city is not routed to weather", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("I want to kill myself, I'm alone in Miami");
    await waitFor(() => c.creates().length === 2);
    assert.ok(/988/.test(c.creates()[1].response.instructions));
    assert.ok(!c.calls.some(([n]) => n === "weather"), JSON.stringify(c.calls));
    c.close();
  });

  const trial = { billingMode: "trial", maxBillableSeconds: 60 };
  for (const routerMode of ["tools", "regex"]) {
    await check(`${routerMode} mode: on a trial call every model turn carries the trial fact`, async () => {
      const c = await startCall({ routerMode, session: trial });
      await c.say("Do you have any restrictions?");
      await waitFor(() => c.creates().length === 2);
      const r = c.creates()[1].response.instructions;
      assert.ok(/free trial/i.test(r) && /60 seconds/.test(r), r);
      c.close();
    });
  }

  await check("regex mode: a normal (non-trial) call gets no trial note", async () => {
    const c = await startCall({ routerMode: "regex" });
    await c.say("Do you have any restrictions?");
    await waitFor(() => c.creates().length === 2);
    assert.ok(!/free trial/i.test(c.creates()[1].response.instructions));
    c.close();
  });

  await check("trial call: 'And it's free.' gets the fixed trial reply, not 'free with no limit'", async () => {
    const c = await startCall({ routerMode: "regex", session: trial });
    await c.say("And it's free.");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    assert.ok(/free trial call lasts/i.test(r.instructions), r.instructions);
    assert.deepStrictEqual(r.tools, []);
    c.close();
  });

  // Production call: "Oh." got "No worries at all. Feel free to chat as long as you'd like!"
  for (const reaction of ["Oh.", "Ah.", "Oh okay.", "Aha."]) {
    await check(`'${reaction}' alone is a reaction, not a question (no reply)`, async () => {
      const c = await startCall({ routerMode: "tools" });
      await c.say(reaction);
      await sleep(150);
      assert.strictEqual(c.creates().length, 1);
      c.close();
    });
  }

  await check("tools mode: plain 'Yes' with no offer pending is still treated as a backchannel", async () => {
    const c = await startCall({ routerMode: "tools" });
    await c.say("Yes");
    await sleep(150);
    assert.strictEqual(c.creates().length, 1);
    c.close();
  });

  await check("tools mode: 'this call is free or what' gets the fixed billing reply", async () => {
    const c = await startCall({ routerMode: "tools" });
    await c.say("this call is free or what");
    await waitFor(() => c.creates().length === 2);
    const r = c.creates()[1].response;
    assert.ok(/buddycallai dot com/.test(r.instructions), r.instructions);
    assert.deepStrictEqual(r.tools, []);
    c.close();
  });

  await check("tools mode: hold phrase still gets no reply", async () => {
    const c = await startCall({ routerMode: "tools" });
    await c.say("Let me think for a second.");
    await sleep(150);
    assert.strictEqual(c.creates().length, 1);
    c.close();
  });

  await check("tools mode: caller speaking during a lookup suppresses the stale answer", async () => {
    const c = await startCall({ routerMode: "tools", weatherDelayMs: 150 });
    await c.say("Weather in Bogota?");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([weatherCall("c1", { city: "Bogota" })]);
    c.emit({ type: "input_audio_buffer.speech_started", item_id: "next" });
    await sleep(300);
    const outputs = c.received.filter((m) => m.type === "conversation.item.create");
    assert.strictEqual(outputs.length, 1, "tool output still recorded in conversation");
    assert.strictEqual(c.creates().length, 2, "no follow-up response after barge-in");
    c.close();
  });

  await check("tools mode: plain answer without tool calls sends nothing extra", async () => {
    const c = await startCall({ routerMode: "tools" });
    await c.say("Tell me a fun fact about octopuses.");
    await waitFor(() => c.creates().length === 2);
    await c.completeLast([{ type: "message", content: [] }]);
    await sleep(50);
    assert.strictEqual(c.creates().length, 2);
    assert.strictEqual(c.received.filter((m) => m.type === "conversation.item.create").length, 0);
    c.close();
  });

  console.log(`\n${process.exitCode ? "Some checks failed" : `All ${passed} checks passed`}`);
  process.exit(process.exitCode || 0);
})();
