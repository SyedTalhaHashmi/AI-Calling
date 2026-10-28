/**
 * Turn latency metrics (logging only).
 * Run: node test/turnMetrics.test.js
 */
const assert = require("assert");
const { createTurnMetrics, percentile } = require("../utils/turnMetrics");

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

function setup(opts = {}) {
  let clock = 0;
  const lines = [];
  const logger = { info: (obj) => lines.push(obj) };
  const metrics = createTurnMetrics({ logger, now: () => clock, ...opts });
  metrics.setCallSid("CAtest");
  return {
    metrics,
    lines,
    at(ms) {
      clock = ms;
    },
    turns: () => lines.filter((l) => l.metric === "turn_latency"),
    summary: () => lines.find((l) => l.metric === "call_latency"),
  };
}

(async () => {
  console.log("turnMetrics\n");

  await check("fast-path turn computes all stage latencies", async () => {
    const s = setup();
    const m = s.metrics;
    s.at(1000); m.onSpeechStarted("item1");
    s.at(2500); m.onSpeechStopped("item1");
    s.at(2600); m.onCommitted("item1");
    s.at(3300); m.onTranscript("item1", "weather in Bogota");
    m.setRoute("item1", "fast_path", "weather");
    s.at(3300);
    await m.time("item1", "weather", async () => {
      s.at(3700);
      return { temp: 18 };
    });
    s.at(3710); m.onResponseCreateSent("item1", 4);
    s.at(3800); m.onResponseCreated("resp1", "4");
    s.at(4400); m.onAudioSent("resp1");
    s.at(4450); m.onAudioSent("resp1");
    s.at(6000); m.onResponseEnded("resp1", "completed");

    const [t] = s.turns();
    assert.strictEqual(t.outcome, "replied");
    assert.strictEqual(t.path, "fast_path");
    assert.strictEqual(t.intent, "weather");
    assert.strictEqual(t.endOfSpeechToTranscriptMs, 800);
    assert.strictEqual(t.transcriptToResponseCreateMs, 410);
    assert.strictEqual(t.fetchTotalMs, 400);
    assert.strictEqual(t.responseCreateToFirstAudioMs, 690);
    assert.strictEqual(t.endOfSpeechToFirstAudioMs, 1900);
    assert.strictEqual(t.speechMs, 1500);
    assert.deepStrictEqual(t.fetches, [
      { label: "weather", ms: 400, status: "ok", likelyCached: false },
    ]);
  });

  await check("tool turn separates acknowledgement audio from answer audio", async () => {
    const s = setup();
    const m = s.metrics;
    s.at(0); m.onSpeechStopped("item10");
    s.at(1200); m.onTranscript("item10", "weather in Bogota");
    m.onResponseCreateSent("item10", 1);
    m.onResponseCreated("ack", "1");
    s.at(1800); m.onAudioSent("ack");
    m.onResponseEnded("ack", "completed", { functionCall: true });
    s.at(2000); m.onToolResultsSent("item10");
    m.onResponseCreateSent("item10", 2);
    m.onResponseCreated("answer", "2");
    s.at(2600); m.onAudioSent("answer");
    m.onResponseEnded("answer", "completed");
    const [t] = s.turns();
    assert.strictEqual(t.endOfSpeechToFirstAudioMs, 1800);
    assert.strictEqual(t.endOfSpeechToAnswerAudioMs, 2600);
  });

  await check("without tools, answer audio equals first audio", async () => {
    const s = setup();
    const m = s.metrics;
    s.at(0); m.onSpeechStopped("item11");
    m.onTranscript("item11", "hi");
    m.onResponseCreateSent("item11", 1);
    m.onResponseCreated("r11", "1");
    s.at(900); m.onAudioSent("r11");
    m.onResponseEnded("r11", "completed");
    assert.strictEqual(s.turns()[0].endOfSpeechToAnswerAudioMs, 900);
  });

  await check("deferred turn logs without a reply", async () => {
    const s = setup();
    const m = s.metrics;
    m.onSpeechStopped("item2");
    m.onTranscript("item2", "let me think");
    m.setRoute("item2", "deferred");
    m.finishWithoutReply("item2", "deferred");
    const [t] = s.turns();
    assert.strictEqual(t.outcome, "deferred");
    assert.strictEqual(t.endOfSpeechToFirstAudioMs, null);
  });

  await check("barge-in after audio counts toward call summary", async () => {
    const s = setup();
    const m = s.metrics;
    s.at(0); m.onSpeechStopped("item3");
    s.at(500); m.onTranscript("item3", "hello");
    m.onResponseCreateSent("item3", 1);
    m.onResponseCreated("resp3", "1");
    s.at(1200); m.onAudioSent("resp3");
    m.onResponseEnded("resp3", "cancelled");
    m.flush();
    assert.strictEqual(s.turns()[0].outcome, "cancelled");
    assert.strictEqual(s.summary().repliedUserTurns, 1);
    assert.strictEqual(s.summary().endOfSpeechToFirstAudioP50Ms, 1200);
  });

  await check("function-call response keeps turn open for follow-up", async () => {
    const s = setup();
    const m = s.metrics;
    s.at(0); m.onSpeechStopped("item4");
    m.onTranscript("item4", "weather");
    m.onResponseCreateSent("item4", 1);
    m.onResponseCreated("respA", "1");
    const turnId = m.turnForResponse("respA");
    m.onResponseEnded("respA", "completed", { functionCall: true });
    assert.strictEqual(s.turns().length, 0);
    m.onResponseCreateSent(turnId, 2);
    m.onResponseCreated("respB", "2");
    s.at(900); m.onAudioSent("respB");
    m.onResponseEnded("respB", "completed");
    assert.strictEqual(s.turns()[0].outcome, "replied");
    assert.strictEqual(s.turns()[0].endOfSpeechToFirstAudioMs, 900);
  });

  await check("time() passes results and errors through unchanged", async () => {
    const s = setup();
    const m = s.metrics;
    m.onTranscript("item5", "x");
    const r = await m.time("item5", "fx", async () => ({ error: "nope" }));
    assert.deepStrictEqual(r, { error: "nope" });
    await assert.rejects(
      m.time("item5", "news", async () => {
        throw new Error("boom");
      }),
      /boom/
    );
    m.finishWithoutReply("item5", "test");
    const statuses = s.turns()[0].fetches.map((f) => f.status);
    assert.deepStrictEqual(statuses, ["error", "threw"]);
  });

  await check("system turns (greeting) are tracked separately", async () => {
    const s = setup();
    const m = s.metrics;
    const id = m.beginSystemTurn("greeting");
    s.at(100); m.onResponseCreateSent(id, 1);
    m.onResponseCreated("g1", "1");
    s.at(700); m.onAudioSent("g1");
    m.onResponseEnded("g1", "completed");
    const [t] = s.turns();
    assert.strictEqual(t.kind, "system");
    assert.strictEqual(t.path, "greeting");
    assert.strictEqual(t.responseCreateToFirstAudioMs, 600);
  });

  await check("flush is idempotent and logs unfinished turns", async () => {
    const s = setup();
    const m = s.metrics;
    m.onSpeechStopped("item6");
    m.flush();
    m.flush();
    assert.strictEqual(s.turns().length, 1);
    assert.strictEqual(s.turns()[0].outcome, "unfinished");
    assert.strictEqual(s.lines.filter((l) => l.metric === "call_latency").length, 1);
  });

  await check("disabled metrics log nothing and still run fetches", async () => {
    const s = setup({ enabled: false });
    const m = s.metrics;
    m.onSpeechStopped("item7");
    const r = await m.time("item7", "fx", async () => 42);
    m.flush();
    assert.strictEqual(r, 42);
    assert.strictEqual(s.lines.length, 0);
  });

  await check("metrics errors never escape into the call", async () => {
    const warns = [];
    const logger = {
      info() {
        throw new Error("log sink down");
      },
      warn: (o) => warns.push(o),
    };
    const m = createTurnMetrics({ logger });
    m.onTranscript("item8", "hi");
    m.finishWithoutReply("item8", "test");
    m.flush();
    const r = await m.time("item9", "fx", async () => 7);
    assert.strictEqual(r, 7);
    assert.ok(warns.length >= 1);
  });

  await check("percentile helper", async () => {
    assert.strictEqual(percentile([5, 1, 3, 2, 4], 50), 3);
    assert.strictEqual(percentile([5, 1, 3, 2, 4], 90), 5);
    assert.strictEqual(percentile([null, undefined], 50), null);
  });

  console.log(`\n${process.exitCode ? "Some checks failed" : `All ${passed} checks passed`}`);
})();
