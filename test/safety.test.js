/**
 * Sensitive topics: crisis detection (self-harm, suicide, abuse, danger) and the guidelines in the prompt.
 * Run: node test/safety.test.js
 */
const assert = require("assert");
const { isCrisisMessage, crisisInstruction, SENSITIVE_TURN_NOTE } = require("../utils/safety");
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

console.log("safety\n");

check("self-harm, suicide, abuse, and danger are crisis messages", () => {
  for (const t of [
    "I want to kill myself.",
    "I've been thinking about suicide",
    "I feel suicidal",
    "I don't want to live anymore",
    "I just want to die",
    "I'm going to end my life",
    "I want to end it all",
    "Everyone would be better off without me",
    "I'm better off dead",
    "There's no reason to live",
    "I've been cutting myself",
    "I want to hurt myself",
    "My husband is hitting me",
    "Someone is trying to kill me",
    "I'm in danger right now",
    "Quiero morir",
    "Me quiero matar",
    "No quiero vivir",
  ]) {
    assert.ok(isCrisisMessage(t), t);
  }
});

check("everyday figures of speech are not crisis messages", () => {
  for (const t of [
    "I'd die for a pizza right now",
    "This traffic is killing me",
    "Can you kill the lights?",
    "I'm dying to see the game",
    "I'm dead tired",
    "Have you seen the Suicide Squad movie?",
    "I want to end my subscription",
    "How many people die in car accidents each year?",
    "My phone is dying",
    "That joke killed me",
    "What's the weather in Miami?",
  ]) {
    assert.ok(!isCrisisMessage(t), t);
  }
});

check("crisis turn instruction: caller's language, warm, 988 and 911, stays with them", () => {
  const text = crisisInstruction("Spanish");
  assert.ok(/^Reply in Spanish only/.test(text), text);
  assert.ok(/988/.test(text) && /911/.test(text), text);
  assert.ok(/local emergency number/i.test(text), "callers outside US/Canada");
  assert.ok(/do not change the subject/i.test(text), text);
});

// Sample run: "My husband is hitting me" got 911 only
check("crisis instruction includes the domestic violence hotline for abuse", () => {
  assert.ok(/1-800-799-7233/.test(crisisInstruction("English")));
});

// Sample run: per-turn chat text beat the prompt ("I can't check live updates", cold reply to "I'm horny")
check("per-turn note: kind limit for sexual/rude/harmful messages, and what Buddy can check live", () => {
  assert.ok(/sexual/i.test(SENSITIVE_TURN_NOTE) && /kind/i.test(SENSITIVE_TURN_NOTE), SENSITIVE_TURN_NOTE);
  assert.ok(/dating or relationships/i.test(SENSITIVE_TURN_NOTE), SENSITIVE_TURN_NOTE);
  assert.ok(/can check live weather/i.test(SENSITIVE_TURN_NOTE), SENSITIVE_TURN_NOTE);
  assert.ok(/^ /.test(SENSITIVE_TURN_NOTE), "appended after the turn instruction");
});

check("system prompt has the sensitive-topic guidelines", () => {
  for (const re of [
    /never ignore/i,
    /no sexual or explicit content/i,
    /sex education/i,
    /insult/i,
    /hate/i,
    /weapons|hurting people/i,
    /suggest a (doctor|professional)/i,
    /politics/i,
    /988/,
    /911/,
  ]) {
    assert.ok(re.test(SYSTEM_PROMPT), `missing ${re}`);
  }
});

check("system prompt no longer allows refusing ordinary sensitive topics", () => {
  assert.ok(/don't refuse ordinary sensitive topics/i.test(SYSTEM_PROMPT));
});

if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
