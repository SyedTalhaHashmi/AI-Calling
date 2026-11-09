/**
 * Regex mode: which caller questions go to web search, and the query sent. No network.
 * Run: node test/webSearchIntent.test.js
 */
const assert = require("assert");
const { detectWebSearch, isSearchConfirmation, offeredSearch } = require("../utils/webSearchIntent");
const { resolveIntent } = require("../utils/intentRouter");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`       ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("webSearchIntent\n");

check("asked to search with a topic → that topic is the query", () => {
  const cases = [
    ["Can you search for the Bogota airport hours?", /^the Bogota airport hours$/i],
    ["Google who won the Oscar for best picture.", /^who won the Oscar for best picture$/i],
    ["Hey Buddy, look up the price of a Tesla Model 3 please.", /^the price of a Tesla Model 3$/i],
    ["Could you check the Costco website for their holiday hours?", /Costco.*holiday hours/i],
    ["Search online for cheap concert tickets in Austin", /^cheap concert tickets in Austin$/i],
  ];
  for (const [text, want] of cases) {
    const r = detectWebSearch(text);
    assert.ok(r && want.test(r.query), `${text} → ${JSON.stringify(r)}`);
  }
});

// Production 2026-11-09: "You can't check a website for me?" got "I can't open or search websites"
check("asked to search with no topic → ask what to look up", () => {
  for (const text of ["You can't check a website for me?", "Can you search the web?", "Look it up.", "Can you google it for me?", "Can you browse the internet?"]) {
    assert.deepStrictEqual(detectWebSearch(text), { needsTopic: true }, text);
  }
});

check("live question no other lookup covers → searched as said", () => {
  for (const text of [
    "Who is the current CEO of Twitter?",
    "What's the latest on the SpaceX launch?",
    "Can you tell me the latest on the SpaceX launch?",
    "Is the Bogota airport open today?",
    "Who won the election in Brazil?",
    "Any updates on the Apple event?",
  ]) {
    const r = detectWebSearch(text);
    assert.ok(r?.query && r.query.length > 8, `${text} → ${JSON.stringify(r)}`);
  }
});

check("ordinary chat is not searched (no cost, no delay)", () => {
  for (const text of [
    "You mean anything like as in really anything?",
    "How are you today?",
    "What should I do today?",
    "What day is today?",
    "Tell me a joke.",
    "What is the capital of France?",
    "What is an electric current?",
    "I'm looking up at the stars tonight.",
    "What do you think is the best movie right now?",
    "What's the best search engine?",
    "Hello?",
  ]) {
    assert.strictEqual(detectWebSearch(text), null, text);
  }
});

check("resolveIntent: web_search only when no other lookup covers it", () => {
  assert.strictEqual(resolveIntent("Who is the current CEO of Twitter?"), "web_search");
  assert.strictEqual(resolveIntent("You can't check a website for me?"), "web_search");
  assert.strictEqual(resolveIntent("Look up the weather in Miami"), "weather");
  assert.strictEqual(resolveIntent("What's the latest news?"), "news");
  assert.strictEqual(resolveIntent("Tell me a joke"), "chat");
});

check("a yes right after Buddy offered to search confirms it", () => {
  assert.ok(offeredSearch("I'm not sure about today's hours. Want me to search the web for that?"));
  assert.ok(offeredSearch("I can look that up online if you like."));
  assert.ok(!offeredSearch("Paris is the capital of France."));
  for (const t of ["Yes.", "Yeah, please.", "Sure, go ahead.", "Yes please search it", "Okay."]) assert.ok(isSearchConfirmation(t), t);
  for (const t of ["No thanks.", "Yes, but what about Rome instead of Paris for the trip?"]) assert.ok(!isSearchConfirmation(t), t);
});

if (process.exitCode) console.log(`\nFAILED — ${passed} checks passed before failure`);
else console.log(`\nAll ${passed} checks passed`);
