/**
 * Summary of a server log file: latency, routes, skipped turns, failed lookups, and estimated
 * OpenAI cost per call minute (from the "Call usage" lines). Reads the log only; no network.
 *
 * Usage: node dev/callReport.js <logfile> [more logfiles…]
 */
const fs = require("fs");

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node dev/callReport.js <logfile> [more logfiles…]");
  process.exit(1);
}

/** Each line is "<date> <time> {json}" or plain JSON. */
function* entries(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("{");
    if (i === -1) continue;
    try {
      yield JSON.parse(line.slice(i));
    } catch {
      // not a JSON log line
    }
  }
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const count = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const table = (map) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `    ${String(k).padEnd(24)} ${v}`)
    .join("\n");

const firstAudio = [];
const routes = new Map();
const outcomes = new Map();
const failedFetches = new Map();
const usage = [];
const calls = new Set();
let realtimeErrors = 0;

for (const file of files) {
  for (const e of entries(file)) {
    if (e.callSid) calls.add(e.callSid);
    if (e.metric === "turn_latency" && e.kind === "user") {
      count(routes, e.intent ? `${e.path}:${e.intent}` : e.path || "(none)");
      count(outcomes, e.outcome);
      if (e.endOfSpeechToFirstAudioMs != null) firstAudio.push(e.endOfSpeechToFirstAudioMs);
      for (const f of e.fetches || []) if (f.status !== "ok") count(failedFetches, `${f.label}:${f.status}`);
    }
    if (e.metric === "call_usage") usage.push(e);
    if (e.msg === "OpenAI Realtime error") realtimeErrors += 1;
  }
}

console.log(`Calls: ${calls.size}   Caller turns: ${[...routes.values()].reduce((a, b) => a + b, 0)}   Realtime errors: ${realtimeErrors}\n`);
console.log(
  `Caller finishes → Buddy's first audio: median ${pct(firstAudio, 0.5) ?? "–"} ms, p90 ${pct(firstAudio, 0.9) ?? "–"} ms (${firstAudio.length} turns)\n`
);
console.log(`Routes:\n${table(routes) || "    –"}\n`);
console.log(`Turn outcomes (echo, deferred, skipped_busy… are turns Buddy did not answer):\n${table(outcomes) || "    –"}\n`);
console.log(`Failed lookups:\n${table(failedFetches) || "    none"}\n`);

if (usage.length) {
  const priced = usage.filter((u) => u.estUsd != null);
  const totalUsd = priced.reduce((s, u) => s + u.estUsd, 0);
  const totalMin = priced.reduce((s, u) => s + Math.max(u.callSeconds || 0, 1) / 60, 0);
  const byModel = new Map();
  for (const u of usage) count(byModel, `${u.model} / ${u.transcribeModel} / ${u.routerMode}`);
  console.log(`OpenAI usage (${usage.length} calls with usage):`);
  console.log(table(byModel));
  console.log(
    `  Estimated cost: $${totalUsd.toFixed(3)} total, $${totalMin ? (totalUsd / totalMin).toFixed(4) : "–"} per call minute, ` +
      `cached share of input ${(priced.reduce((s, u) => s + (u.cachedShare || 0), 0) / Math.max(priced.length, 1) * 100).toFixed(0)}%`
  );
} else {
  console.log("OpenAI usage: no \"Call usage\" lines in these logs (added on this branch).");
}
