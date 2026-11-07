/**
 * Per-call token usage and estimated cost (logging only).
 * Run: node test/realtimeCost.test.js
 */
const assert = require("assert");
const { emptyUsage, addResponseUsage, estimateCost, PRICES } = require("../utils/realtimeCost");

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

console.log("realtime cost\n");

const usage = (textIn, audioIn, cachedText, cachedAudio, textOut, audioOut) => ({
  input_token_details: { text_tokens: textIn, audio_tokens: audioIn, cached_tokens_details: { text_tokens: cachedText, audio_tokens: cachedAudio } },
  output_token_details: { text_tokens: textOut, audio_tokens: audioOut },
});

check("cached tokens are split out of the input counts and priced once", () => {
  const t = addResponseUsage(emptyUsage(), usage(1000, 300, 900, 100, 50, 400));
  assert.deepStrictEqual([t.textIn, t.audioIn, t.cachedText, t.cachedAudio, t.textOut, t.audioOut, t.responses], [100, 200, 900, 100, 50, 400, 1]);
});

check("cost: gpt-realtime prices per 1M tokens, plus transcription by the minute", () => {
  const t = addResponseUsage(emptyUsage(), usage(1_000_000, 0, 0, 0, 0, 0));
  t.speechSeconds = 60;
  const c = estimateCost(t, { model: "gpt-realtime", transcribeModel: "gpt-transcribe", callSeconds: 60 });
  assert.strictEqual(c.usd, 4.0045);
  assert.strictEqual(c.usdPerMinute, 4.0045);
});

check("cost: the mini is priced lower than the full model for the same usage", () => {
  const t = addResponseUsage(emptyUsage(), usage(2000, 3000, 1500, 0, 60, 2500));
  const full = estimateCost(t, { model: "gpt-realtime-2.1", transcribeModel: "gpt-transcribe", callSeconds: 120 });
  const mini = estimateCost(t, { model: "gpt-realtime-2.1-mini", transcribeModel: "gpt-transcribe", callSeconds: 120 });
  assert.ok(mini.usd < full.usd / 2, `${mini.usd} vs ${full.usd}`);
  assert.strictEqual(full.cachedShare, Number((1500 / 5000).toFixed(3)));
});

check("unknown model: tokens kept, no cost guessed; missing usage is ignored", () => {
  const t = addResponseUsage(addResponseUsage(emptyUsage(), null), usage(10, 0, 0, 0, 0, 0));
  assert.strictEqual(t.responses, 1);
  assert.strictEqual(estimateCost(t, { model: "some-new-model", transcribeModel: "gpt-transcribe", callSeconds: 30 }).usd, null);
  for (const m of ["gpt-realtime", "gpt-realtime-2.1", "gpt-realtime-2.1-mini"]) assert.ok(PRICES[m], m);
});

if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
