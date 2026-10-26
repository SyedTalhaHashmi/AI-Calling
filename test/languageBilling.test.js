/**
 * Tests for language lock + billing honesty helpers.
 * Run: node test/languageBilling.test.js
 */
const assert = require("assert");
const {
  detectLanguage,
  explicitLanguageSwitch,
  updateReplyLanguage,
} = require("../utils/replyLanguage");
const {
  isBillingQuestion,
  billingReply,
} = require("../utils/billingReply");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("language + billing\n");

check("short Hello? does not detect language flip", () => {
  assert.strictEqual(detectLanguage("Hello?"), null);
  assert.strictEqual(detectLanguage("Nah."), null);
});

check("Spanish weather locks es", () => {
  assert.strictEqual(
    detectLanguage("Oye, hazme un favor, ¿tú me puedes dar el clima en Toronto?"),
    "es"
  );
});

check("explicit speak English", () => {
  assert.strictEqual(explicitLanguageSwitch("speak in English please"), "en");
  assert.strictEqual(explicitLanguageSwitch("do you speak English as well?"), "en");
});

check("do you speak Spanish locks es", () => {
  assert.strictEqual(explicitLanguageSwitch("Do you speak Spanish?"), "es");
});

check("Yiddish capability ask locks yi", () => {
  assert.strictEqual(
    explicitLanguageSwitch(
      "And he goes, what I know, I want to know if you can speak Yiddish."
    ),
    "yi"
  );
  assert.strictEqual(
    explicitLanguageSwitch(
      "But I want you should speak Yiddish for me, and when you're gonna speak Yiddish for me"
    ),
    "yi"
  );
  const session = { replyLanguage: "en" };
  const r = updateReplyLanguage(
    session,
    "I want to know if you can speak Yiddish."
  );
  assert.strictEqual(session.replyLanguage, "yi");
  assert.strictEqual(r.changed, true);
});

check("session: Hello after Spanish stay es", () => {
  const session = { replyLanguage: "es" };
  const r = updateReplyLanguage(session, "Hello?");
  assert.strictEqual(r.changed, false);
  assert.strictEqual(session.replyLanguage, "es");
});

check("session: first clear English locks en", () => {
  const session = {};
  const r = updateReplyLanguage(
    session,
    "How long could I talk to you for free?"
  );
  assert.strictEqual(session.replyLanguage, "en");
  assert.strictEqual(r.changed, true);
});

check("session: switch to English on ask", () => {
  const session = { replyLanguage: "es" };
  updateReplyLanguage(session, "Okay, do you speak English as well, correct?");
  assert.strictEqual(session.replyLanguage, "en");
});

check("billing question detected", () => {
  assert.ok(isBillingQuestion("How long could I talk to you for free?"));
  assert.ok(isBillingQuestion("is there a free trial?"));
  assert.ok(isBillingQuestion("do I have to pay for this"));
  assert.ok(isBillingQuestion("Do I have to pay for this?"));
  assert.ok(isBillingQuestion("Do I have a monthly limit?"));
  assert.ok(isBillingQuestion("Do I have a monthly limit to speak to?"));
  assert.ok(!isBillingQuestion("I am talking about Buddy Call AI."));
});

check("trial billing reply uses seconds", () => {
  const reply = billingReply({ billingMode: "trial", maxBillableSeconds: 60 });
  assert.ok(/60 seconds/i.test(reply));
  assert.ok(!/unlimited|as long as you like|no charge at all/i.test(reply));
});

check("subscriber billing reply", () => {
  const reply = billingReply({
    billingMode: "subscriber",
    maxBillableSeconds: 830,
  });
  assert.ok(/remaining|plan/i.test(reply));
  assert.ok(!/unlimited free/i.test(reply));
});

check("flight how-long is not billing", () => {
  assert.ok(!isBillingQuestion("how long is the flight from Bogota to Miami?"));
});

check("is-this-call-free questions are billing (baseline miss)", () => {
  assert.ok(isBillingQuestion("Is this call free?"));
  assert.ok(isBillingQuestion("is this phone call free"));
  assert.ok(isBillingQuestion("Is the call free?"));
  assert.ok(isBillingQuestion("Are these calls free?"));
  assert.ok(isBillingQuestion("Is this service free?"));
  assert.ok(isBillingQuestion("Is calling you free?"));
  assert.ok(isBillingQuestion("Is talking to you free?"));
  assert.ok(isBillingQuestion("¿Esta llamada es gratis?"));
  assert.ok(isBillingQuestion("¿Es gratis esta llamada?"));
});

check("free things that are not our call stay out of billing", () => {
  assert.ok(!isBillingQuestion("Is the museum free on Sundays?"));
  assert.ok(!isBillingQuestion("Is parking at the airport free?"));
  assert.ok(!isBillingQuestion("Is the wifi free at the hotel?"));
  assert.ok(!isBillingQuestion("¿El museo es gratis los domingos?"));
});

check("fallback billing reply is caller-facing (no internal rules spoken)", () => {
  for (const session of [undefined, {}, { billingMode: "legacy" }]) {
    const reply = billingReply(session);
    assert.ok(!/never assume|never say|do not invent|authoritative/i.test(reply), reply);
    assert.ok(/buddycallai dot com/i.test(reply), reply);
    assert.ok(!/unlimited|no charge|completely free/i.test(reply), reply);
  }
});

if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
