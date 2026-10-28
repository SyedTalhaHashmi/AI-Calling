/**
 * /incoming-call and /call-status (transcript email) with stubbed email + platform API — no network.
 * Run: node test/callRoutes.test.js
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
/** Every server started, closed at the end even when a check fails mid-way. */
const servers = [];
function closeServer(s) {
  s.closeAllConnections();
  s.close();
}

/** Starts the routes on a random port; callerCheck decides allow/deny like the platform API. */
async function startRoutes({ callerCheck = async () => ({ skipped: true }) } = {}) {
  const emails = [];
  const callEnds = [];
  const callStore = new CallStore();
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    createCallRoutes({
      logger: silent,
      callStore,
      config: { publicBaseUrl: "https://example.test", ringDelaySeconds: 0 },
      services: {
        email: { sendTranscript: async (args) => emails.push(args) },
        platformApi: {
          enabled: false,
          callerCheck,
          notifyCallStart: async () => {},
          notifyCallEnd: async (args) => callEnds.push(args),
        },
      },
    })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  const post = (path, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    }).then((r) => r.text());
  return { emails, callEnds, callStore, post, close: () => closeServer(server) };
}

(async () => {
  console.log("call routes\n");

  // Inbox: blocked trial callers produced "No conversation captured." emails
  await check("caller denied by the platform (trial used up): no transcript email", async () => {
    const t = await startRoutes({
      callerCheck: async () => ({ allowed: false, message: "Please subscribe. Goodbye." }),
    });
    const twiml = await t.post("/incoming-call", { CallSid: "CA1", From: "+15550001111", To: "+15550002222" });
    assert.ok(/Please subscribe/.test(twiml) && /<Hangup/.test(twiml), twiml);
    await t.post("/call-status", { CallSid: "CA1", CallStatus: "completed", CallDuration: "9" });
    assert.strictEqual(t.emails.length, 0);
    assert.strictEqual(t.callEnds[0].transcriptSent, false, "call end still reported");
    t.close();
  });

  await check("caller hangs up during the greeting (no caller speech): no transcript email", async () => {
    const t = await startRoutes();
    await t.post("/incoming-call", { CallSid: "CA2", From: "+15550001111" });
    const s = t.callStore.get("CA2");
    s.transcriptLines = ["AI: Hi! I'm Buddy, your AI friend. Ask me anything you want."];
    await t.post("/call-status", { CallSid: "CA2", CallStatus: "completed", CallDuration: "12" });
    assert.strictEqual(t.emails.length, 0);
    assert.strictEqual(t.callEnds[0].transcriptSent, false);
    t.close();
  });

  await check("caller said something: transcript emailed (anonymous trial → EMAIL_TO fallback unchanged)", async () => {
    const t = await startRoutes();
    await t.post("/incoming-call", { CallSid: "CA3", From: "+15550001111" });
    t.callStore.get("CA3").transcriptLines = ["AI: Hi!", "Caller: How long does this last?", "AI: About a minute."];
    await t.post("/call-status", { CallSid: "CA3", CallStatus: "completed", CallDuration: "40" });
    assert.strictEqual(t.emails.length, 1);
    assert.ok(/Caller: How long does this last\?/.test(t.emails[0].transcriptBody));
    assert.strictEqual(t.emails[0].to, undefined, "no line email → service falls back to EMAIL_TO");
    assert.strictEqual(t.callEnds[0].transcriptSent, true);
    t.close();
  });

  await check("registered caller's line email is still used when they spoke", async () => {
    const t = await startRoutes({
      callerCheck: async () => ({ allowed: true, mode: "subscriber", secondsRemaining: 600, transcriptEmail: "user@example.test" }),
    });
    await t.post("/incoming-call", { CallSid: "CA4", From: "+15550001111" });
    t.callStore.get("CA4").transcriptLines = ["Caller: Hi"];
    await t.post("/call-status", { CallSid: "CA4", CallStatus: "completed", CallDuration: "20" });
    assert.strictEqual(t.emails[0].to, "user@example.test");
    t.close();
  });

  servers.forEach(closeServer);
  if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
})();
