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

if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
