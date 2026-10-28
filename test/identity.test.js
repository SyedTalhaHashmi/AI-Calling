/**
 * Assistant identity: name (Buddy) and creator (Brash3D Media Group).
 * Run: node test/identity.test.js
 */
const assert = require("assert");
const { identityReply } = require("../utils/identity");
const { SYSTEM_PROMPT } = require("../utils/callStore");

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

console.log("identity\n");

check("name questions → I'm Buddy", () => {
  for (const t of [
    "What's your name?",
    "what is your name",
    "Who are you?",
    "Do you have a name?",
    "What should I call you?",
    "¿Cómo te llamas?",
    "¿Cuál es tu nombre?",
  ]) {
    const r = identityReply(t);
    assert.ok(r && /^I'm Buddy/.test(r), `${t} → ${r}`);
    assert.ok(!/Brash3D/.test(r), `${t} → ${r}`);
  }
});

check("creator questions → I was created by Brash3D Media Group.", () => {
  for (const t of [
    "Who created you?",
    "Who made you?",
    "Who built you?",
    "Who developed you?",
    "Who is your creator?",
    "Who's your developer?",
    "Which company made you?",
    "What company created you?",
    "Who are you made by?",
    "Who's behind you?",
    "¿Quién te creó?",
  ]) {
    assert.strictEqual(identityReply(t), "I was created by Brash3D Media Group.", t);
  }
});

check("name + creator in one question → both", () => {
  assert.strictEqual(
    identityReply("Who are you and who made you?"),
    "I'm Buddy, and I was created by Brash3D Media Group."
  );
});

check("questions about other people and things are not identity questions", () => {
  for (const t of [
    "Who created Python?",
    "Who built the Eiffel Tower?",
    "Who made this song?",
    "What's the name of the hotel?",
    "Who are the Beatles?",
    "What's my name?",
    "Tell me about yourself and the weather in Miami",
  ]) {
    assert.strictEqual(identityReply(t), null, t);
  }
});

check("system prompt states the name and creator, and rules out other creators", () => {
  assert.ok(/You are Buddy/.test(SYSTEM_PROMPT));
  assert.ok(/created by Brash3D Media Group/.test(SYSTEM_PROMPT), "creator in prompt");
  assert.ok(/never say you were (made|created|built) by OpenAI/i.test(SYSTEM_PROMPT), "no OpenAI claim");
});

if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
