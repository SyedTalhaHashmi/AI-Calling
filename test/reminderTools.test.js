/**
 * Reminder tools by voice and the keypad consent.
 * Run: node test/reminderTools.test.js
 */
const assert = require("assert");
const { createReminderExecutor, isReminderAsk, localNow, reminderTurnInstruction } = require("../handlers/reminderTools");

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

function fakePlatform(answers) {
  const sent = [];
  return {
    sent,
    enabled: true,
    reminders: async (action, payload) => {
      sent.push([action, payload]);
      const a = answers[action];
      const data = typeof a === "function" ? a(payload, sent) : a;
      return data === undefined ? { ok: false, error: "down" } : { ok: true, data };
    },
  };
}
const member = (extra = {}) => ({ platformUserId: "u1", billingMode: "subscriber_platinum", callerNumber: "+15550001111", timezone: "America/Chicago", ...extra });

(async () => {
  console.log("reminder tools\n");

  await check("reminder asks are recognised, in English and Spanish", async () => {
    for (const t of ["Remind me tomorrow at 9 to take my pills", "Can you set a reminder?", "What reminders do I have?", "Cancel my reminder", "Recuérdame mañana a las 9", "mis recordatorios"]) {
      assert.ok(isReminderAsk(t), t);
    }
    for (const t of ["What's the weather?", "Remainder of the day", "I remember that"]) assert.ok(!isReminderAsk(t), t);
  });

  await check("the reminder turn gives the model the caller's local time and zone", async () => {
    const ins = reminderTurnInstruction("English", member(), new Date("2026-11-16T20:05:00Z"));
    assert.ok(/Monday 2026-11-16T14:05 \(America\/Chicago\)/.test(ins), ins);
    assert.deepStrictEqual(localNow("Asia/Karachi", new Date("2026-11-16T20:05:00Z")).iso, "2026-11-17T01:05");
  });

  await check("set: sent with the account, the calling line and the local time; the platform's sentence is returned", async () => {
    const api = fakePlatform({ set: { ok: true, say: "Okay. I'll call you Tuesday at 9:00 AM to remind you: pills." } });
    const ex = createReminderExecutor({ platformApi: api, session: member(), callSid: "CA1", logger: silent });
    const r = await ex.execute("set_reminder", { message: "pills", when: "2026-11-17T09:00" });
    assert.strictEqual(r.ok, true);
    assert.match(r.say, /Tuesday at 9:00 AM/);
    assert.deepStrictEqual(api.sent[0], ["set", { userId: "u1", callSid: "CA1", callerNumber: "+15550001111", message: "pills", when: "2026-11-17T09:00" }]);
  });

  await check("no consent yet: asks to press 1, then pressing 1 records consent and sets the reminder", async () => {
    let consented = false;
    const api = fakePlatform({
      set: () => (consented ? { ok: true, say: "Okay. I'll call you Tuesday at 9:00 AM to remind you: pills." } : { ok: false, code: "no_consent", say: "Press 1 on your keypad to agree…" }),
      consent: () => ((consented = true), { ok: true }),
    });
    const s = member();
    const ex = createReminderExecutor({ platformApi: api, session: s, callSid: "CA1", logger: silent });
    const r = await ex.execute("set_reminder", { message: "pills", when: "2026-11-17T09:00" });
    assert.strictEqual(r.needsConsent, true);
    assert.match(r.say, /Press 1/);
    assert.strictEqual(await ex.handleDigit("5"), null);
    const said = await ex.handleDigit("1");
    assert.match(said, /^Thank you\. Okay\. I'll call you Tuesday/);
    assert.deepStrictEqual(api.sent.map((x) => x[0]), ["set", "consent", "set"]);
    assert.strictEqual(s.pendingReminder, null);
    assert.strictEqual(await ex.handleDigit("1"), null, "nothing pending any more");
  });

  await check("pressing 2: no consent recorded, nothing set", async () => {
    const api = fakePlatform({ set: { ok: false, code: "no_consent", say: "Press 1…" } });
    const ex = createReminderExecutor({ platformApi: api, session: member(), callSid: "CA1", logger: silent });
    await ex.execute("set_reminder", { message: "pills", when: "2026-11-17T09:00" });
    assert.match(await ex.handleDigit("2"), /no reminder calls/);
    assert.deepStrictEqual(api.sent.map((x) => x[0]), ["set"]);
  });

  await check("a keypad press with nothing pending is ignored", async () => {
    const api = fakePlatform({});
    const ex = createReminderExecutor({ platformApi: api, session: member(), callSid: "CA1", logger: silent });
    assert.strictEqual(await ex.handleDigit("1"), null);
    assert.strictEqual(api.sent.length, 0);
  });

  await check("free-minute callers: reminders are for members, nothing sent", async () => {
    const api = fakePlatform({});
    const ex = createReminderExecutor({ platformApi: api, session: member({ billingMode: "trial", platformUserId: null }), callSid: "CA1", logger: silent });
    const r = await ex.execute("set_reminder", { message: "x", when: "2026-11-17T09:00" });
    assert.match(r.say, /for members/);
    assert.strictEqual(api.sent.length, 0);
  });

  await check("list, then cancel by number or by words", async () => {
    const reminders = [
      { id: "r1", message: "Take pills", when: "Tuesday, November 17 at 9:00 AM" },
      { id: "r2", message: "Call the dentist", when: "Friday, November 20 at 2:30 PM" },
    ];
    const api = fakePlatform({ list: { reminders }, cancel: { ok: true } });
    const s = member();
    const ex = createReminderExecutor({ platformApi: api, session: s, callSid: "CA1", logger: silent });
    const l = await ex.execute("list_reminders", {});
    assert.match(l.say, /1: Tuesday, November 17 at 9:00 AM, Take pills\. 2: Friday/);
    const c = await ex.execute("cancel_reminder", { number: 2 });
    assert.match(c.say, /cancelled the reminder for Friday, November 20 at 2:30 PM: Call the dentist/);
    assert.deepStrictEqual(api.sent.at(-1), ["cancel", { userId: "u1", callSid: "CA1", reminderId: "r2" }]);
    const c2 = await ex.execute("cancel_reminder", { about: "pills" });
    assert.ok(c2.ok);
    assert.strictEqual(api.sent.at(-1)[1].reminderId, "r1");
  });

  await check("cancel with words matching two reminders asks which one", async () => {
    const api = fakePlatform({ list: { reminders: [{ id: "a", message: "pills morning", when: "Mon" }, { id: "b", message: "pills evening", when: "Tue" }] } });
    const ex = createReminderExecutor({ platformApi: api, session: member(), callSid: "CA1", logger: silent });
    const r = await ex.execute("cancel_reminder", { about: "pills" });
    assert.strictEqual(r.error, "ambiguous");
    assert.ok(!api.sent.some((x) => x[0] === "cancel"));
  });

  await check("platform down: an honest sentence, never 'set'", async () => {
    const api = fakePlatform({});
    const ex = createReminderExecutor({ platformApi: api, session: member(), callSid: "CA1", logger: silent });
    const r = await ex.execute("set_reminder", { message: "pills", when: "2026-11-17T09:00" });
    assert.match(r.say, /couldn't set the reminder/);
  });

  console.log(`\n${passed} passed`);
})();
