/**
 * End-to-end call replay: plays a scripted caller (spoken audio, real-time μ-law frames, as Twilio
 * sends them) into the REAL call handler, with the live OpenAI Realtime model and the real data
 * services (Open-Meteo, Travelpayouts, Google Places, Frankfurter). For each setup it reports:
 * per-turn pass/fail against a check, caller-finishes → first-audio latency, and the estimated
 * OpenAI cost (from the handler's own "Call usage" line). Buddy's audio is saved as a WAV per setup.
 *
 * Costs real money (OpenAI + a few Places/TTS requests per run). No Alpha Vantage questions.
 *
 * Usage:
 *   node dev/callReplay.js                       # all setups below
 *   node dev/callReplay.js regex:gpt-realtime tools:gpt-realtime-2.1:low   # mode:model[:effort]
 * Options: --out <dir> (default dev/replay-out), --runs <n> (default 1), --logs (save every
 * handler log line per run), --turns <n> (only the first n caller turns)
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const axios = require("axios");
const alawmulaw = require("alawmulaw");
const createMediaStreamHandler = require("../handlers/mediaStream");
const { CallStore } = require("../utils/callStore");
const { openAIToTwilio } = require("../services/audioConvert");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const OUT = path.resolve(opt("out", path.join(__dirname, "replay-out")));
const RUNS = Number(opt("runs", 1));
const CLIP_DIR = path.join(OUT, "clips");
fs.mkdirSync(CLIP_DIR, { recursive: true });

// Positional args that aren't an option's value: "mode:model[:effort]"
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const SETUPS = (positional.length
  ? positional
  : [
      "regex:gpt-realtime",
      "regex:gpt-realtime-2.1:minimal",
      "regex:gpt-realtime-2.1:low",
      "regex:gpt-realtime-2.1-mini:low",
      "tools:gpt-realtime",
      "tools:gpt-realtime-2.1:minimal",
      "tools:gpt-realtime-2.1:low",
      "tools:gpt-realtime-2.1-mini:low",
    ]
).map((s) => {
  const [mode, model, effort] = s.split(":");
  return { id: s, mode, model, effort: effort || null };
});

const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
/** A number, as digits or words ("18", "eighteen", "diciotto"). */
const NUM = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|trenta)\b/i;
const NO_STALL = (r) => !/\b(hold on|one moment|just a moment|let me (look|find|check) (that|it|this) (up|for you))\b/i.test(r);

/** The scripted caller. check(reply) — the whole spoken answer for that turn. */
/**
 * needs: the lookup that must have run (regex route intent, or the tools-mode tool) — otherwise
 * a fluent answer was made up and fails.
 */
const TURNS = [
  { say: "Hi Buddy, what's the weather in Medellín, Colombia?", needs: ["weather", "get_weather"], check: (r) => /medell/i.test(r) && NUM.test(r) && /degree|celsius|fahrenheit|°|gradi/i.test(r) },
  { say: "Will it rain there today?", needs: ["weather", "get_weather"], check: (r) => /\d+\s*(%|percent)/i.test(r) || /chance/i.test(r) },
  { say: "How much is a one-way flight from Bogotá to Miami next Friday?", needs: ["travel_price", "get_flight_fare"], check: (r) => /dollar|\$|usd/i.test(r) && /friday|november|december/i.test(r) && /miami/i.test(r) },
  { say: "I need a cheap hotel in Miami for three nights. What would that cost?", needs: ["hotel", "find_places"], check: (r) => NUM.test(r) && /night|total|stay/i.test(r) && /booking|expedia|typical|not live/i.test(r) },
  { say: "Is this call being recorded?", check: (r) => /(not|isn't|isn’t|aren't|no)\b.{0,20}record/i.test(r) && !/\bis being recorded\b/i.test(r) },
  { say: "Are you free?", check: (r) => /never charged|free trial|isn't charged|not charged|no charge/i.test(r) && !/charges may apply/i.test(r) },
  { say: "How many Colombian pesos is one US dollar today?", needs: ["fx", "get_exchange_rate"], check: (r) => NUM.test(r) && /peso/i.test(r) },
  { say: "Tell me a fun fact about octopuses.", check: (r) => /octop/i.test(r) && words(r) <= 60 },
  { say: "¿Podemos hablar en italiano, por favor?", check: (r) => /\b(certo|sì|si|parliamo|italiano|posso|volentieri|ciao|aiutarti)\b/i.test(r) && !/\b(no puedo|lo siento)\b/i.test(r) },
  { say: "Che tempo fa a Roma oggi?", needs: ["weather", "get_weather"], check: (r) => /rom/i.test(r) && NUM.test(r) && /\b(gradi|oggi|cielo|nuvol|sole|pioggia|temperatura)\b/i.test(r) },
];

/** TTS clip → μ-law 8 kHz bytes (cached). */
async function clip(text, i) {
  const file = path.join(CLIP_DIR, `turn${i}.ulaw`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const res = await axios.post(
    "https://api.openai.com/v1/audio/speech",
    { model: "gpt-4o-mini-tts", voice: "ash", input: text, response_format: "pcm" },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, responseType: "arraybuffer", timeout: 30000 }
  );
  const mulaw = Buffer.from(openAIToTwilio(Buffer.from(res.data).toString("base64")), "base64");
  fs.writeFileSync(file, mulaw);
  return mulaw;
}

function buildServices() {
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  return {
    weatherService: require("../services/weather")(process.env.OPENWEATHER_API_KEY || "", logger),
    openMeteoService: require("../services/openMeteo")(process.env.OPEN_METEO_ENABLED !== "false", logger),
    timeService: require("../services/time")(),
    worldTimeService: { enabled: false },
    placesService: require("../services/places")(process.env.GOOGLE_PLACES_API_KEY || "", logger),
    travelService: require("../services/travel")(process.env.TRAVELPAYOUTS_TOKEN || "", logger),
    newsService: { enabled: false },
    fxService: require("../services/fx")(process.env.FRANKFURTER_ENABLED !== "false", logger),
    sportsService: { enabled: false, detectSport: () => "football" },
    flightsService: { enabled: false },
    // No stock / crypto / rates: the Alpha Vantage key is shared with production (25 a day)
    stocksService: { enabled: false },
    webSearchService: { enabled: false },
  };
}

/**
 * Twilio stand-in. Buddy's audio arrives faster than it plays, so a play clock tracks when the
 * caller would actually hear it end (8000 μ-law bytes per second); "clear" stops playback.
 */
class FakeTwilio extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.out = [];
    this.playsUntil = 0;
  }
  send(data) {
    const m = JSON.parse(data);
    if (m.event === "media") {
      const chunk = Buffer.from(m.media.payload, "base64");
      this.out.push(chunk);
      this.playsUntil = Math.max(this.playsUntil, Date.now()) + (chunk.length / 8000) * 1000;
    }
    if (m.event === "clear") this.playsUntil = Date.now();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SILENCE = Buffer.alloc(160, 0xff);

function wav8kMulaw(chunks) {
  const pcm = Buffer.from(alawmulaw.mulaw.decode(new Uint8Array(Buffer.concat(chunks))).buffer);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function runCall(setup, clips, run) {
  const logs = [];
  const logger = {
    info: (f, m) => logs.push({ ...(typeof f === "object" ? f : {}), msg: m ?? f, at: Date.now() }),
    warn: (f, m) => logs.push({ ...(typeof f === "object" ? f : {}), msg: m ?? f, at: Date.now(), level: "warn" }),
    error: (f, m) => logs.push({ ...(typeof f === "object" ? f : {}), msg: m ?? f, at: Date.now(), level: "error" }),
    debug() {},
  };
  const callStore = new CallStore();
  const callSid = `CAreplay${Date.now()}`;
  Object.assign(callStore.getOrCreate(callSid), { billingMode: "trial", maxBillableSeconds: 600 });
  const handler = createMediaStreamHandler({
    callStore,
    logger,
    openaiApiKey: process.env.OPENAI_API_KEY,
    ...buildServices(),
    twilioClient: null,
    latencyMetricsEnabled: true,
    routerMode: setup.mode,
    realtime: { model: setup.model, reasoningEffort: setup.effort || undefined },
  });
  const tw = new FakeTwilio();
  handler(tw, {});
  tw.emit("message", JSON.stringify({ event: "start", start: { callSid, streamSid: "MZreplay" } }));

  // Twilio sends audio all the time (silence included): keep a 20 ms clock running
  let queue = [];
  const ticker = setInterval(() => {
    const frame = queue.length ? queue.shift() : SILENCE;
    tw.emit("message", JSON.stringify({ event: "media", media: { track: "inbound", payload: frame.toString("base64") } }));
  }, 20);

  const waitFor = async (pred, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return true;
      await sleep(50);
    }
    return false;
  };
  // Greeting
  await waitFor(() => logs.some((l) => /^AI: Hi! I'm Buddy/.test(l.msg)), 15000);
  await sleep(1500);

  const results = [];
  const turnCount = Math.min(TURNS.length, Number(opt("turns", TURNS.length)));
  for (let i = 0; i < turnCount; i++) {
    const mark = logs.length;
    for (let o = 0; o < clips[i].length; o += 160) queue.push(clips[i].subarray(o, o + 160));
    // Done when a caller turn has been answered AND Buddy's audio has finished playing — like a
    // real caller, who waits for Buddy to stop talking (a split sentence gives two turn lines)
    const clipEnds = Date.now() + (clips[i].length / 8000) * 1000;
    // Every transcribed piece of the clip must be handled (a held greeting counts), and one answered
    const finished = await waitFor(() => {
      const since = logs.slice(mark);
      const pieces = since.filter((l) => /^USER: /.test(l.msg)).length;
      const turnLines = since.filter((l) => l.metric === "turn_latency" && l.kind === "user");
      const answered = turnLines.some((l) => !["deferred", "greeting_merged", "echo", "duplicate", "empty"].includes(l.outcome));
      return Date.now() > clipEnds + 1000 && pieces > 0 && turnLines.length >= pieces && answered && Date.now() > tw.playsUntil + 1200;
    }, 40000);
    const turnLogs = logs.slice(mark);
    const reply = turnLogs.filter((l) => /^AI: /.test(l.msg)).map((l) => l.reply).join(" ");
    const heard = turnLogs.filter((l) => /^USER: /.test(l.msg)).map((l) => l.transcript).join(" | ");
    const facts = turnLogs.filter((l) => /^Fast-path fact/.test(l.msg)).map((l) => l.fact);
    // The answered piece of the turn (not a held greeting or a filler)
    const tl =
      turnLogs.find(
        (l) => l.metric === "turn_latency" && l.kind === "user" && !["deferred", "greeting_merged", "echo", "duplicate", "empty"].includes(l.outcome)
      ) || {};
    const tools = turnLogs.filter((l) => l.msg === "Tool result").map((l) => l.tool);
    const looked = !TURNS[i].needs || tl.intent === TURNS[i].needs[0] || tools.includes(TURNS[i].needs[1]);
    const pass = Boolean(reply) && looked && TURNS[i].check(reply) && NO_STALL(reply.replace(/^(let me check that\.?|un momento\.?)\s*/i, ""));
    results.push({
      turn: i + 1,
      said: TURNS[i].say,
      heard,
      reply,
      pass,
      finished,
      path: tl.path,
      intent: tl.intent,
      tools,
      looked,
      facts,
      firstAudioMs: tl.endOfSpeechToFirstAudioMs ?? null,
      answerAudioMs: tl.endOfSpeechToAnswerAudioMs ?? null,
      errors: turnLogs.filter((l) => l.level === "error").map((l) => l.msg),
    });
    queue.push(...Array(25).fill(SILENCE));
    await sleep(600);
  }

  clearInterval(ticker);
  tw.emit("message", JSON.stringify({ event: "stop" }));
  await sleep(300);
  const usage = logs.find((l) => l.metric === "call_usage") || {};
  // Every handler log line, for debugging a turn (--logs)
  if (args.includes("--logs")) {
    fs.writeFileSync(path.join(OUT, `${setup.id.replace(/[:.]/g, "_")}-run${run}-logs.json`), JSON.stringify(logs, null, 1));
  }
  fs.writeFileSync(path.join(OUT, `${setup.id.replace(/[:.]/g, "_")}-run${run}.wav`), wav8kMulaw(tw.out));
  return { results, usage };
}

(async () => {
  const clips = [];
  for (let i = 0; i < TURNS.length; i++) clips.push(await clip(TURNS[i].say, i));
  const summary = [];
  for (const setup of SETUPS) {
    for (let run = 1; run <= RUNS; run++) {
      process.stdout.write(`\n=== ${setup.id} (run ${run}) ===\n`);
      const { results, usage } = await runCall(setup, clips, run);
      for (const r of results) {
        console.log(
          `${r.pass ? "PASS" : "FAIL"} ${String(r.turn).padStart(2)} [${r.path || "-"}${r.intent ? `:${r.intent}` : ""}${r.tools.length ? ` ${r.tools.join(",")}` : ""}]` +
            `${r.looked ? "" : " NO LOOKUP"} ${r.firstAudioMs ?? "–"} ms  heard: ${r.heard}`
        );
        console.log(`        → ${r.reply || "(no reply)"}${r.errors.length ? `  ERRORS: ${r.errors.join("; ")}` : ""}`);
      }
      const lat = results.map((r) => r.answerAudioMs ?? r.firstAudioMs).filter((x) => x != null).sort((a, b) => a - b);
      const first = results.map((r) => r.firstAudioMs).filter((x) => x != null).sort((a, b) => a - b);
      const row = {
        setup: setup.id,
        run,
        passed: results.filter((r) => r.pass).length,
        turns: results.length,
        firstAudioMedianMs: first[Math.floor(first.length / 2)] ?? null,
        answerAudioMedianMs: lat[Math.floor(lat.length / 2)] ?? null,
        answerAudioP90Ms: lat[Math.floor(lat.length * 0.9)] ?? null,
        estUsd: usage.estUsd ?? null,
        estUsdPerMinute: usage.estUsdPerMinute ?? null,
        cachedShare: usage.cachedShare ?? null,
        audioOut: usage.audioOut ?? null,
        results,
      };
      summary.push(row);
      console.log(
        `→ ${row.passed}/${row.turns} passed, first audio median ${row.firstAudioMedianMs} ms, answer audio median ${row.answerAudioMedianMs} ms (p90 ${row.answerAudioP90Ms}), ` +
          `est $${row.estUsd} ($${row.estUsdPerMinute}/min), cached ${Math.round((row.cachedShare || 0) * 100)}%`
      );
    }
  }
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("\nSetup                              Passed  1st audio  Answer audio (p90)   Est $/call  $/min   cached");
  for (const s of summary) {
    console.log(
      `${s.setup.padEnd(34)} ${`${s.passed}/${s.turns}`.padEnd(7)} ${String(s.firstAudioMedianMs ?? "–").padEnd(10)} ${`${s.answerAudioMedianMs ?? "–"} (${s.answerAudioP90Ms ?? "–"})`.padEnd(20)} ${String(s.estUsd ?? "–").padEnd(11)} ${String(s.estUsdPerMinute ?? "–").padEnd(7)} ${Math.round((s.cachedShare || 0) * 100)}%`
    );
  }
  console.log(`\nSaved ${path.join(OUT, "summary.json")} and one WAV of Buddy's audio per setup.`);
  process.exit(0);
})();
