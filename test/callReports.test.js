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
          notifyCallEnd: async () => ({ ok: true }),
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
  return { usage, trials, callStore, post, close };
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

  console.log(`\n${passed} passed`);
})();
