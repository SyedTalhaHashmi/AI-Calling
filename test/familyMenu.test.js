/**
 * Family Premium menu on a call: consent (keypad or yes/no), sharing choice,
 * stopping the daily calls; check-in opening line.
 * Run: node test/familyMenu.test.js
 */
const assert = require("assert");
const { createFamilyMenu, checkinOpening } = require("../handlers/familyMenu");

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

function platform(fail = false) {
  const sent = [];
  return {
    sent,
    enabled: true,
    family: async (action, payload) => {
      sent.push([action, payload]);
      if (fail) return { ok: false, error: "down" };
      if (action === "consent") return { ok: true, data: { ok: true, consent: payload.agree ? "agreed" : "declined" } };
      if (action === "sharing") return { ok: true, data: { ok: true, sharingLevel: payload.level } };
      return { ok: true, data: { ok: true, consent: "declined" } };
    },
  };
}
const member = (consent = "pending", extra = {}) => ({
  platformUserId: "u1",
  callerNumber: "+15550001111",
  family: { consent, memberName: "Rosa", holderName: "Ana Lopez", time: "9:00 AM", sharingLevel: "status", language: "en" },
  ...extra,
});

(async () => {
  console.log("family menu\n");

  await check("first call: the consent question from the approved wording", async () => {
    const s = member();
    const m = createFamilyMenu({ platformApi: platform(), session: s, callSid: "CA1", logger: silent });
    const line = m.openingLine();
    assert.match(line, /^Hi Rosa, I'm Buddy\. Ana Lopez set me up for you\. If it's OK with you, I'll call you every day at 9:00 AM/);
    assert.match(line, /made by an AI assistant and are transcribed/);
    assert.strictEqual(s.familyMenu, "consent");
  });

  await check("consent already given, or a call Buddy placed: the usual opening", async () => {
    assert.strictEqual(createFamilyMenu({ platformApi: platform(), session: member("agreed"), callSid: "CA1", logger: silent }).openingLine(), null);
    assert.strictEqual(createFamilyMenu({ platformApi: platform(), session: member("pending", { outbound: { kind: "reminder" } }), callSid: "CA1", logger: silent }).openingLine(), null);
  });

  await check("keypad 1 then 2: consent agreed by keypad, summaries shared", async () => {
    const api = platform();
    const s = member();
    const m = createFamilyMenu({ platformApi: api, session: s, callSid: "CA1", logger: silent });
    m.openingLine();
    assert.match(await m.handleDigit("1"), /only whether you answered, a short summary/);
    assert.match(await m.handleDigit("2"), /short summaries/);
    assert.deepStrictEqual(api.sent.map((x) => [x[0], x[1].agree ?? x[1].level, x[1].method ?? null]), [["consent", true, "keypad"], ["sharing", "summaries", null]]);
    assert.strictEqual(s.familyMenu, null);
    assert.strictEqual(await m.handleDigit("1"), null, "menu closed");
  });

  await check("saying yes, then 'the full transcripts'", async () => {
    const api = platform();
    const s = member();
    const m = createFamilyMenu({ platformApi: api, session: s, callSid: "CA1", logger: silent });
    m.openingLine();
    await m.handleSpeech("Yes, that's fine.");
    assert.match(await m.handleSpeech("The full transcripts, I don't mind."), /full transcripts/);
    assert.strictEqual(api.sent[0][1].method, "voice");
    assert.strictEqual(api.sent[1][1].level, "transcripts");
  });

  await check("saying no: declined, nothing more asked", async () => {
    const api = platform();
    const s = member();
    const m = createFamilyMenu({ platformApi: api, session: s, callSid: "CA1", logger: silent });
    m.openingLine();
    assert.match(await m.handleSpeech("No, thank you."), /I won't call you/);
    assert.strictEqual(s.familyMenu, null);
    assert.strictEqual(api.sent.length, 1);
  });

  await check("words that aren't an answer leave the question open (normal chat)", async () => {
    const s = member();
    const m = createFamilyMenu({ platformApi: platform(), session: s, callSid: "CA1", logger: silent });
    m.openingLine();
    assert.strictEqual(await m.handleSpeech("Who are you again?"), null);
    assert.strictEqual(s.familyMenu, "consent");
  });

  await check("later: 'stop my daily calls' asks to confirm, 1 stops them", async () => {
    const api = platform();
    const s = member("agreed");
    const m = createFamilyMenu({ platformApi: api, session: s, callSid: "CA1", logger: silent });
    assert.match(await m.handleSpeech("Please stop my daily calls."), /stop your daily check-in calls\?/);
    assert.match(await m.handleDigit("1"), /stopped your daily check-in calls/);
    assert.deepStrictEqual(api.sent.map((x) => x[0]), ["withdraw"]);
  });

  await check("later: 'change what my family can see' opens the sharing choice", async () => {
    const api = platform();
    const s = member("agreed");
    const m = createFamilyMenu({ platformApi: api, session: s, callSid: "CA1", logger: silent });
    assert.match(await m.handleSpeech("Can I change what my family can see?"), /^Would you like your family/);
    assert.match(await m.handleDigit("1"), /only see whether you answered/);
    assert.strictEqual(api.sent[0][1].level, "status");
  });

  await check("Spanish member: Spanish wording", async () => {
    const s = member("pending");
    s.family.language = "es";
    const m = createFamilyMenu({ platformApi: platform(), session: s, callSid: "CA1", logger: silent });
    assert.match(m.openingLine(), /^Hola Rosa, soy Buddy\. Ana Lopez me configuró para ti/);
    assert.match(await m.handleSpeech("Sí, claro."), /tu familia vea solo si contestaste/);
  });

  await check("platform down: an honest sentence, the question can be asked again", async () => {
    const s = member();
    const m = createFamilyMenu({ platformApi: platform(true), session: s, callSid: "CA1", logger: silent });
    m.openingLine();
    assert.match(await m.handleDigit("1"), /couldn't save that/);
    assert.strictEqual(s.family.consent, "pending");
  });

  await check("not a member line (no family info): nothing happens", async () => {
    const m = createFamilyMenu({ platformApi: platform(), session: { platformUserId: "u1" }, callSid: "CA1", logger: silent });
    assert.strictEqual(m.openingLine(), null);
    assert.strictEqual(await m.handleSpeech("stop my daily calls"), null);
  });

  await check("yes/no only as a short whole reply", async () => {
    const { yesNo } = require("../handlers/familyMenu");
    for (const t of ["Yes", "yes please", "Sure, that's fine.", "Okay!", "Of course", "Sí, claro.", "Está bien", "That's okay"]) assert.strictEqual(yesNo(t), "yes", t);
    for (const t of ["No", "No thanks.", "No, thank you", "Nope", "No gracias"]) assert.strictEqual(yesNo(t), "no", t);
    for (const t of ["No problem", "No sé", "no se", "Okay so what's the weather like in Miami today", "Yes but I don't want calls", "No worries", "Sure I'd like to know the news", "I don't know"]) {
      assert.strictEqual(yesNo(t), null, t);
    }
  });

  await check("sharing only with clear words: 'everything's fine' or 'I'm full' choose nothing", async () => {
    const { sharingFromSpeech } = require("../handlers/familyMenu");
    assert.strictEqual(sharingFromSpeech("Everything's fine"), null);
    assert.strictEqual(sharingFromSpeech("I'm full, I just ate"), null);
    assert.strictEqual(sharingFromSpeech("I answered the door"), null);
    assert.strictEqual(sharingFromSpeech("The full transcripts"), "transcripts");
    assert.strictEqual(sharingFromSpeech("Just a summary"), "summaries");
    assert.strictEqual(sharingFromSpeech("Only whether I answered"), "status");
  });

  await check("the consent question is dropped after two replies that don't answer it; a later 'No' means nothing", async () => {
    const api = platform();
    const s = member();
    const m = createFamilyMenu({ platformApi: api, session: s, callSid: "CA1", logger: silent });
    m.openingLine();
    assert.strictEqual(await m.handleSpeech("What's the weather in Miami?"), null);
    assert.strictEqual(s.familyMenu, "consent", "kept for one more turn");
    assert.strictEqual(await m.handleSpeech("And tomorrow?"), null);
    assert.strictEqual(s.familyMenu, null, "dropped");
    assert.strictEqual(m.wants("No."), false);
    assert.strictEqual(api.sent.length, 0);
  });

  await check("after a no: 'start my daily calls' asks the consent question again", async () => {
    const api = platform();
    api.family = async (action, payload) => (api.sent.push([action, payload]), { ok: true, data: { ok: true, consent: action === "consent" ? "agreed" : "pending" } });
    const s = member("declined");
    const m = createFamilyMenu({ platformApi: api, session: s, callSid: "CA1", logger: silent });
    assert.strictEqual(m.wants("Can you start my daily calls again?"), true);
    assert.match(await m.handleSpeech("Can you start my daily calls again?"), /I'll call you every day at 9:00 AM/);
    assert.strictEqual(s.familyMenu, "consent");
    await m.handleDigit("1");
    assert.deepStrictEqual(api.sent.map((x) => x[0]), ["reopen", "consent"]);
  });

  await check("check-in opening by the member's local time and language", async () => {
    const nine = new Date("2026-11-17T15:00:00Z"); // 9:00 in Chicago
    assert.strictEqual(checkinOpening({ memberName: "Rosa", language: "en", timezone: "America/Chicago" }, nine), "Good morning Rosa, it's Buddy with your daily call. How are you today?");
    assert.strictEqual(checkinOpening({ memberName: "Rosa", language: "es", timezone: "America/Chicago" }, nine), "Buenos días Rosa, soy Buddy con tu llamada de hoy. ¿Cómo estás?");
    assert.match(checkinOpening({ memberName: "Rosa", language: "en", timezone: "America/Chicago" }, new Date("2026-11-17T21:00:00Z")), /^Good afternoon/);
  });

  console.log(`\n${passed} passed`);
})();
