/**
 * Call reports to the platform: they carry the call id (so a resend is applied once),
 * and a length cap from the platform (Pay As You Go) is applied to the call.
 * Run: node test/callReports.test.js
 */
const assert = require("assert");
const express = require("express");
const createCallRoutes = require("../routes/calls");
const { CallStore } = require("../utils/callStore");

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

async function start(callerCheck) {
  const usage = [];
  const trials = [];
  const ends = [];
  const callStore = new CallStore();
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    createCallRoutes({
      logger: silent,
      callStore,
      config: { publicBaseUrl: "https://example.test", ringDelaySeconds: 0 },
      services: {
        email: { sendTranscript: async () => {} },
        platformApi: {
          enabled: true,
          callerCheck: async () => callerCheck,
          notifyCallStart: async () => ({ ok: true }),
          notifyCallEnd: async (p) => (ends.push(p), { ok: true }),
          reportUsage: async (p) => (usage.push(p), { ok: true }),
          trialReport: async (p) => (trials.push(p), { ok: true }),
        },
      },
    })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const post = (path, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    }).then((r) => r.text());
  const close = () => {
    server.closeAllConnections();
    server.close();
  };
  return { usage, trials, ends, callStore, post, close };
}

(async () => {
  console.log("call reports\n");

  await check("a Pay As You Go call gets the platform's length cap", async () => {
    const t = await start({ allowed: true, mode: "overage", userId: "u1", maxSecondsThisCall: 3600 });
    await t.post("/incoming-call", { CallSid: "CAP1", From: "+15550001111", To: "+15550002222" });
    assert.strictEqual(t.callStore.get("CAP1").maxBillableSeconds, 3600);
    t.close();
  });

  await check("a plan with extra minutes and no cap stays uncapped", async () => {
    const t = await start({ allowed: true, mode: "subscriber_platinum", userId: "u2", secondsRemaining: 600 });
    await t.post("/incoming-call", { CallSid: "CAP2", From: "+15550001112", To: "+15550002222" });
    assert.strictEqual(t.callStore.get("CAP2").maxBillableSeconds ?? null, null);
    t.close();
  });

  await check("the minutes report carries the call id", async () => {
    const t = await start({ allowed: true, mode: "overage", userId: "u3", maxSecondsThisCall: 3600 });
    await t.post("/incoming-call", { CallSid: "CAR1", From: "+15550001113", To: "+15550002222" });
    await t.post("/call-status", { CallSid: "CAR1", CallStatus: "completed", CallDuration: "95" });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(t.usage.length, 1);
    assert.strictEqual(t.usage[0].callSid, "CAR1");
    assert.strictEqual(t.usage[0].secondsConsumed, 95);
    t.close();
  });

  await check("the free-minute report carries the call id", async () => {
    const t = await start({ allowed: true, mode: "trial", maxSecondsThisCall: 60 });
    await t.post("/incoming-call", { CallSid: "CAT1", From: "+15550001114", To: "+15550002222" });
    await t.post("/call-status", { CallSid: "CAT1", CallStatus: "completed", CallDuration: "40" });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(t.trials[0].callSid, "CAT1");
    t.close();
  });

  await check("the call-end report carries the transcript, language, AI cost and account", async () => {
    const t = await start({ allowed: true, mode: "subscriber_platinum", userId: "u5", secondsRemaining: 600, tools: { mode: "limited", limits: { weather: 50 } } });
    await t.post("/incoming-call", { CallSid: "CAE1", From: "+15550001115", To: "+15550002222" });
    const s = t.callStore.get("CAE1");
    assert.deepStrictEqual(s.toolAccess, { mode: "limited", limits: { weather: 50 } });
    s.transcriptLines = ["AI: Hi.", "Caller: Weather in Austin?", "AI: Sunny."];
    s.replyLanguage = "es";
    s.usage = { responses: 3, textIn: 1000, audioIn: 2000, cachedText: 0, cachedAudio: 0, textOut: 100, audioOut: 900 };
    s.costModels = { model: "gpt-realtime-mini", transcribeModel: "gpt-4o-mini-transcribe" };
    await t.post("/call-status", { CallSid: "CAE1", CallStatus: "completed", CallDuration: "61" });
    await new Promise((r) => setTimeout(r, 20));
    const e = t.ends[0];
    assert.strictEqual(e.callSid, "CAE1");
    assert.strictEqual(e.userId, "u5");
    assert.deepStrictEqual(e.transcript, s.transcriptLines);
    assert.strictEqual(e.language, "es");
    assert.strictEqual(e.durationSeconds, 61);
    assert.strictEqual(typeof e.costUsd, "number");
    assert.ok(e.costUsd > 0 && e.costUsd < 1);
    t.close();
  });

  await check("a call where the caller never spoke sends no transcript", async () => {
    const t = await start({ allowed: true, mode: "trial", maxSecondsThisCall: 60 });
    await t.post("/incoming-call", { CallSid: "CAE2", From: "+15550001116", To: "+15550002222" });
    t.callStore.get("CAE2").transcriptLines = ["AI: Hi."];
    await t.post("/call-status", { CallSid: "CAE2", CallStatus: "completed", CallDuration: "5" });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(t.ends[0].transcript, []);
    assert.strictEqual(t.ends[0].userId, null);
    t.close();
  });

  await check("no tool info from the platform: the call keeps all tools", async () => {
    const t = await start({ allowed: true, mode: "subscriber", userId: "u6", secondsRemaining: 600 });
    await t.post("/incoming-call", { CallSid: "CAE3", From: "+15550001117", To: "+15550002222" });
    assert.strictEqual(t.callStore.get("CAE3").toolAccess, undefined);
    t.close();
  });

  await check("a huge transcript is cut to 200 KB before it is sent", async () => {
    const t = await start({ allowed: true, mode: "subscriber", userId: "u7", secondsRemaining: 600 });
    await t.post("/incoming-call", { CallSid: "CAE4", From: "+15550001118", To: "+15550002222" });
    t.callStore.get("CAE4").transcriptLines = Array.from({ length: 5000 }, (_, i) => `Caller: line ${i} ${"x".repeat(80)}`);
    await t.post("/call-status", { CallSid: "CAE4", CallStatus: "completed", CallDuration: "600" });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(JSON.stringify(t.ends[0].transcript).length <= 200 * 1024);
    assert.ok(t.ends[0].transcript.length > 100);
    t.close();
  });

  console.log(`\n${passed} passed`);
})();
