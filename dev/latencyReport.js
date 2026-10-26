/**
 * Summarize "turn_latency" log lines from the voice server (pino JSON, one object per line).
 * Usage: node dev/latencyReport.js server.log [more.log ...]
 *        node server.js | tee server.log   (then run the report on server.log)
 *        cat server.log | node dev/latencyReport.js
 * Prints p50 / p90 per route as a Markdown table.
 */
const fs = require("fs");
const readline = require("readline");
const { percentile } = require("../utils/turnMetrics");

const STAGES = [
  ["endOfSpeechToTranscriptMs", "speech end → transcript"],
  ["transcriptToResponseCreateMs", "transcript → reply requested"],
  ["fetchTotalMs", "data fetch"],
  ["responseCreateToFirstAudioMs", "reply requested → first audio"],
  ["endOfSpeechToFirstAudioMs", "**speech end → first audio**"],
  ["endOfSpeechToAnswerAudioMs", "speech end → answer audio"],
];

async function readRecords(paths) {
  const streams = paths.length ? paths.map((p) => fs.createReadStream(p)) : [process.stdin];
  const records = [];
  for (const stream of streams) {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const start = line.indexOf("{");
      if (start === -1) continue;
      try {
        const obj = JSON.parse(line.slice(start));
        if (obj.metric === "turn_latency") records.push(obj);
      } catch {
        // not a JSON log line
      }
    }
  }
  return records;
}

function fmt(v) {
  return v == null ? "–" : String(Math.round(v));
}

function routeKey(r) {
  if (r.kind === "system") return `system:${r.path}`;
  if (
    r.path === "fast_path" ||
    r.path === "tools" ||
    (r.path === "chat" && r.intent && r.intent !== "chat")
  ) {
    return `${r.path}:${r.intent}`;
  }
  return r.path || "unrouted";
}

function stageRow(label, rows) {
  const cells = STAGES.map(([key]) => {
    const vals = rows.map((r) => r[key]).filter((v) => v != null);
    return vals.length ? `${fmt(percentile(vals, 50))} / ${fmt(percentile(vals, 90))}` : "–";
  });
  return `| ${label} | ${rows.length} | ${cells.join(" | ")} |`;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

async function main() {
  const records = await readRecords(process.argv.slice(2));
  if (!records.length) {
    console.log("No turn_latency records found.");
    return;
  }
  const calls = new Set(records.map((r) => r.callSid)).size;
  const userTurns = records.filter((r) => r.kind === "user");
  const audible = userTurns.filter((r) => r.endOfSpeechToFirstAudioMs != null);

  console.log(`# Latency report\n`);
  console.log(`Calls: ${calls} · user turns: ${userTurns.length} · turns with audio: ${audible.length}\n`);

  console.log(`## Stage latency, ms (p50 / p90), user turns with audio\n`);
  console.log(`| Route | n | ${STAGES.map(([, l]) => l).join(" | ")} |`);
  console.log(`|---|---|${STAGES.map(() => "---").join("|")}|`);
  console.log(stageRow("**all**", audible));
  for (const [key, rows] of groupBy(audible, routeKey)) {
    console.log(stageRow(key, rows));
  }

  const system = records.filter((r) => r.kind === "system");
  if (system.length) {
    console.log(`\n## System turns, ms (p50 / p90)\n`);
    console.log(`| Turn | n | ${STAGES.map(([, l]) => l).join(" | ")} |`);
    console.log(`|---|---|${STAGES.map(() => "---").join("|")}|`);
    for (const [key, rows] of groupBy(system, routeKey)) {
      console.log(stageRow(key, rows));
    }
  }

  console.log(`\n## Data fetches, ms\n`);
  console.log(`| Fetch | n | p50 | p90 | max | errors | likely cached |`);
  console.log(`|---|---|---|---|---|---|---|`);
  const fetches = records.flatMap((r) => r.fetches || []);
  for (const [label, rows] of groupBy(fetches, (f) => f.label)) {
    const ms = rows.map((f) => f.ms);
    const errors = rows.filter((f) => f.status !== "ok").length;
    const cached = rows.filter((f) => f.likelyCached).length;
    console.log(
      `| ${label} | ${rows.length} | ${fmt(percentile(ms, 50))} | ${fmt(percentile(ms, 90))} | ${fmt(Math.max(...ms))} | ${errors} | ${cached} |`
    );
  }

  console.log(`\n## Turn outcomes\n`);
  console.log(`| Outcome | n |`);
  console.log(`|---|---|`);
  for (const [outcome, rows] of groupBy(userTurns, (r) => r.outcome)) {
    console.log(`| ${outcome} | ${rows.length} |`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
