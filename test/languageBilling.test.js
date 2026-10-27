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
  isPlanCatalogQuestion,
  billingReply,
  billingInstruction,
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
});

// Asking whether the agent speaks a language is not asking it to switch (was: switched immediately)
check("capability questions do not switch the language", () => {
  for (const t of [
    "Do you speak Spanish?",
    "do you speak English as well?",
    "Can you speak French?",
    "Do you know Portuguese?",
    "And he goes, what I know, I want to know if you can speak Yiddish.",
    "Can you speak Hebrew?",
  ]) {
    assert.strictEqual(explicitLanguageSwitch(t), null, t);
  }
});

check("clear requests still switch at once", () => {
  assert.strictEqual(explicitLanguageSwitch("Can you speak Spanish please?"), "es");
  assert.strictEqual(explicitLanguageSwitch("Switch to Spanish"), "es");
  assert.strictEqual(explicitLanguageSwitch("Let's talk in French"), "fr");
  assert.strictEqual(explicitLanguageSwitch("Please reply in Hindi"), "hi");
  assert.strictEqual(
    explicitLanguageSwitch(
      "But I want you should speak Yiddish for me, and when you're gonna speak Yiddish for me"
    ),
    "yi"
  );
});

check("translation questions do not switch the language", () => {
  for (const t of [
    "How do you say thank you in Spanish?",
    "What is good morning in French?",
    "How would I say hello in Hebrew?",
    "Translate this into Spanish: where is the bathroom",
  ]) {
    assert.strictEqual(explicitLanguageSwitch(t), null, t);
  }
});

check("capability question: offer to switch, keep the current language", () => {
  const session = { replyLanguage: "en" };
  const r = updateReplyLanguage(session, "Do you speak Spanish?");
  assert.deepStrictEqual(r, { changed: false, language: "en", offer: "es" });
  assert.strictEqual(session.replyLanguage, "en");
  assert.strictEqual(session.languageOffer, "es");
});

check("yes to the offer switches; no or another question keeps the language", () => {
  for (const answer of ["Yes", "yes please", "Sure.", "Okay", "Sí, por favor", "Yeah, go ahead"]) {
    const session = { replyLanguage: "en" };
    updateReplyLanguage(session, "Do you speak Spanish?");
    const r = updateReplyLanguage(session, answer);
    assert.deepStrictEqual(r, { changed: true, language: "es", acceptedOffer: true }, answer);
    assert.strictEqual(session.languageOffer, null);
  }
  for (const answer of ["No, English is fine", "No thanks", "What's the weather in Miami?"]) {
    const session = { replyLanguage: "en" };
    updateReplyLanguage(session, "Do you speak Spanish?");
    const r = updateReplyLanguage(session, answer);
    assert.strictEqual(session.replyLanguage, "en", answer);
    assert.ok(!r.acceptedOffer, answer);
    assert.strictEqual(session.languageOffer, null, answer);
  }
});

check("after the offer, simply continuing in that language switches", () => {
  const session = { replyLanguage: "en" };
  updateReplyLanguage(session, "Do you speak Spanish?");
  const r = updateReplyLanguage(session, "¿Qué clima hace en Bogotá?");
  assert.strictEqual(session.replyLanguage, "es");
  assert.strictEqual(r.changed, true);
});

check("asking about the language already in use makes no offer", () => {
  const session = { replyLanguage: "en" };
  const r = updateReplyLanguage(session, "Do you speak English?");
  assert.strictEqual(r.offer, undefined);
  assert.ok(!session.languageOffer);
});

check("Yiddish capability ask offers Yiddish (no immediate switch); asking in Spanish itself still switches", () => {
  const session = { replyLanguage: "en" };
  const r = updateReplyLanguage(session, "I want to know if you can speak Yiddish.");
  assert.strictEqual(r.offer, "yi");
  assert.strictEqual(session.replyLanguage, "en");
  // Caller is already speaking Spanish
  const es = { replyLanguage: "en" };
  updateReplyLanguage(es, "¿Hablas español?");
  assert.strictEqual(es.replyLanguage, "es");
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

check("session: 'do you speak English?' in a Spanish call offers English; yes switches", () => {
  const session = { replyLanguage: "es" };
  const r = updateReplyLanguage(session, "Okay, do you speak English as well, correct?");
  assert.strictEqual(r.offer, "en");
  assert.strictEqual(session.replyLanguage, "es");
  updateReplyLanguage(session, "Yes");
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

// Local test call: "this call is free or what" went to chat ("check with your service provider")
check("'this call is free' word order is billing", () => {
  assert.ok(isBillingQuestion("this call is free or what"));
  assert.ok(isBillingQuestion("So this phone call is free?"));
  assert.ok(isBillingQuestion("the call is free right"));
});

// Local test call: "Let me know the buddy call AI plan" / "packages" got "check their website"
check("plan / package / pricing questions about Buddy Call are plan-catalog (and billing) questions", () => {
  for (const t of [
    "Let me know the buddy call AI plan.",
    "can you please let me know the buddy call AI packages",
    "What are the BuddyCall plans?",
    "How much does Buddy Call cost?",
    "What packages do you offer?",
    "Which plans do you have?",
    "What's your pricing?",
    "¿Cuáles son los planes de Buddy Call?",
  ]) {
    assert.ok(isPlanCatalogQuestion(t), t);
    assert.ok(isBillingQuestion(t), t);
  }
});

check("other plans, prices, and packages are not plan-catalog questions", () => {
  for (const t of [
    "What's the plan for today?",
    "Can you plan my trip to Miami?",
    "What are your plans for the weekend?",
    "What's the price of a flight to Lahore?",
    "Track my package from Amazon",
    "I am talking about Buddy Call AI.",
  ]) {
    assert.ok(!isPlanCatalogQuestion(t), t);
  }
  assert.ok(!isBillingQuestion("Track my package from Amazon"));
  assert.ok(!isBillingQuestion("What's the price of a flight to Lahore?"));
});

check("plan-catalog reply lists every plan with its price and minutes (matches backend plans)", () => {
  for (const session of [undefined, { billingMode: "trial", maxBillableSeconds: 60 }, { billingMode: "subscriber", maxBillableSeconds: 600 }]) {
    const reply = billingReply(session, "What are the Buddy Call plans?");
    for (const part of [/Pay-As-You-Go/, /59 cents a minute/, /Silver/, /9 dollars a month/, /20 minutes/, /Gold/, /29 dollars/, /60 minutes/, /Platinum/, /69 dollars/, /150 minutes/, /55 cents a minute/, /buddycallai dot com/]) {
      assert.ok(part.test(reply), `${part} missing: ${reply}`);
    }
  }
});

check("non-catalog billing questions keep their existing reply", () => {
  const session = { billingMode: "trial", maxBillableSeconds: 60 };
  assert.strictEqual(billingReply(session, "Is this call free?"), billingReply(session));
  assert.ok(!/Platinum/.test(billingReply(session, "Is this call free?")));
});

check("session billing facts include the plan list for follow-ups", () => {
  for (const session of [undefined, { billingMode: "trial", maxBillableSeconds: 60 }, { billingMode: "subscriber_platinum" }]) {
    const text = billingInstruction(session);
    assert.ok(/Silver/.test(text) && /\$29/.test(text) && /\$0\.55/.test(text), text);
  }
});

if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
