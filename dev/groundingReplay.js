/**
 * Grounding replay for tools-mode web search answers. Never calls Exa.
 *
 * Default (offline, no network): scores the answers recorded in the fixture against their saved results.
 * --live: replays the saved results through the real OpenAI Realtime model (text only) with the CURRENT
 *         follow-up instruction, scores the new answers, and runs the multi-turn location cases.
 *         Uses the existing OPENAI_API_KEY (small per-case cost). Not part of npm test.
 *
 * Checks per answer: every number appears in the results, a source is named, no "most"/"all"
 * generalizing, plus per-case mustMatch / mustNot patterns.
 *
 * Usage: node dev/groundingReplay.js [--live] [--repeat N] [--only id1,id2] [--cases test/fixtures/groundingCases.json]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { SYSTEM_PROMPT } = require("../utils/callStore");
const { languageInstruction } = require("../utils/replyLanguage");
const { billingInstruction } = require("../utils/billingReply");
const {
  buildToolDefinitions,
  createToolExecutor,
  TOOLS_SESSION_RULES,
  WEB_SEARCH_SESSION_RULE,
  toolsTurnInstruction,
  toolsFollowUpInstruction,
} = require("../handlers/realtimeTools");

const URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
const CASE_TIMEOUT_MS = 20000;
const ALL_ENABLED = new Proxy({}, { get: () => ({ enabled: true }) });

function parseArgs(argv) {
  const args = { cases: path.join(__dirname, "..", "test", "fixtures", "groundingCases.json"), live: false, repeat: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cases") args.cases = argv[++i];
    else if (argv[i] === "--live") args.live = true;
    else if (argv[i] === "--repeat") args.repeat = Math.max(1, Number(argv[++i]) || 1);
    else if (argv[i] === "--only") args.only = argv[++i].split(",");
  }
  return args;
}

/** Returns a list of problems (empty = grounded). evidence: everything the model was given (defaults to the results). */
function scoreAnswer(c, answer, evidence = JSON.stringify(c.results || [])) {
  const problems = [];
  const text = String(answer || "");
  for (const n of text.match(/\d+(?:[.:,]\d+)?/g) || []) {
    if (!evidence.includes(n) && !c.question.includes(n)) problems.push(`number "${n}" not in results`);
  }
  // A "couldn't confirm" answer makes no claim, so it needs no source
  const declined = /couldn.t confirm/i.test(text);
  if (c.results && c.source && !declined && !new RegExp(c.source, "i").test(text)) problems.push("no source named");
  if (/\b(most|all)\b/i.test(text)) problems.push('generalizes ("most"/"all")');
  if (c.mustMatch && !new RegExp(c.mustMatch, "i").test(text)) problems.push(`missing /${c.mustMatch}/`);
  if (c.mustNot && new RegExp(c.mustNot, "i").test(text)) problems.push(`says /${c.mustNot}/`);
  return problems;
}

function sessionInstructions() {
  const session = { replyLanguage: "en" };
  return [
    SYSTEM_PROMPT,
    "",
    "## Active call rules (authoritative — follow these)",
    languageInstruction(session),
    billingInstruction(session),
    "",
    TOOLS_SESSION_RULES,
    WEB_SEARCH_SESSION_RULE,
  ].join("\n");
}

const message = (role, text) => ({
  type: "message",
  role,
  content: [{ type: role === "user" ? "input_text" : "output_text", text }],
});

/** One fresh Realtime conversation: items, then one response. Resolves { calls, text } or { error }. */
function runRealtime(apiKey, items, response) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    const timer = setTimeout(() => {
      ws.close();
      resolve({ error: "timeout" });
    }, CASE_TIMEOUT_MS);
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            output_modalities: ["text"],
            instructions: sessionInstructions(),
            tools: buildToolDefinitions(ALL_ENABLED),
            tool_choice: "auto",
          },
        })
      );
      for (const item of items) ws.send(JSON.stringify({ type: "conversation.item.create", item }));
      ws.send(JSON.stringify({ type: "response.create", response }));
    });
    ws.on("message", (raw) => {
      const ev = JSON.parse(raw.toString());
      if (ev.type === "error") {
        clearTimeout(timer);
        ws.close();
        resolve({ error: ev.error?.message || "error" });
      }
      if (ev.type === "response.done") {
        clearTimeout(timer);
        ws.close();
        const output = ev.response?.output || [];
        const calls = output
          .filter((o) => o.type === "function_call")
          .map((o) => ({ name: o.name, arguments: o.arguments || "" }));
        const text = output
          .filter((o) => o.type === "message")
          .flatMap((o) => o.content || [])
          .map((p) => p.text || p.transcript || "")
          .join(" ")
          .trim();
        resolve({ calls, text });
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      resolve({ error: err.message });
    });
  });
}

/** The saved results go through the real web_search handler (adds the market clock), at the recorded time. */
async function replayGrounding(apiKey, c) {
  const saved = c.results ? { results: c.results } : { error: c.error };
  const executor = createToolExecutor({
    services: { webSearchService: { enabled: true, search: async () => saved } },
    logger: { warn() {} },
    now: () => Date.parse(c.at),
  });
  const output = JSON.stringify(await executor.execute("web_search", { query: c.query }));
  const r = await runRealtime(
    apiKey,
    [
      message("user", c.question),
      { type: "function_call", call_id: "replay1", name: "web_search", arguments: JSON.stringify({ query: c.query }) },
      { type: "function_call_output", call_id: "replay1", output },
    ],
    {
      instructions: toolsFollowUpInstruction("English", { now: Date.parse(c.at), webSearch: true }),
      tools: [],
    }
  );
  return { ...r, evidence: output };
}

/** expect "ask": no tool call naming an earlier place, and a question back. Otherwise: that place must be used. */
function scoreLocation(c, r) {
  const args = r.calls.map((x) => x.arguments).join(" ");
  if (c.expect === "ask") {
    if (/miami|orlando/i.test(args)) return [`added a place: ${args}`];
    if (!r.calls.length && !/city|where|which|area|location/i.test(r.text)) return ["did not ask for a place"];
    if (r.calls.length) return [`called ${r.calls.map((x) => x.name).join(",")} without a place: ${args}`];
    return [];
  }
  const used = `${args} ${r.text}`;
  return new RegExp(c.expect, "i").test(used) ? [] : [`did not reuse ${c.expect}`];
}

function report(label, id, problems, detail) {
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${label.padEnd(8)} ${id.padEnd(24)} ${detail}`);
  for (const p of problems) console.log(`        - ${p}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(fs.readFileSync(args.cases, "utf8"));
  const pick = (list) => (args.only ? list.filter((c) => args.only.includes(c.id)) : list);
  const grounding = pick(fixture.grounding);
  const location = pick(fixture.location);
  const totals = {};
  const tally = (label, ok) => {
    totals[label] = totals[label] || [0, 0];
    totals[label][0] += ok ? 1 : 0;
    totals[label][1] += 1;
  };

  for (const c of grounding.filter((g) => g.recordedAnswer)) {
    const problems = scoreAnswer(c, c.recordedAnswer);
    tally("recorded", !problems.length);
    report("recorded", c.id, problems, JSON.stringify(c.recordedAnswer));
  }

  if (args.live) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for --live");
    for (let n = 0; n < args.repeat; n++) {
      for (const c of grounding) {
        const r = await replayGrounding(apiKey, c);
        const problems = r.error ? [r.error] : scoreAnswer(c, r.text, r.evidence);
        tally("replay", !problems.length);
        report("replay", c.id, problems, JSON.stringify(r.text || ""));
      }
      for (const c of location) {
        const items = [...c.history.map(([role, text]) => message(role, text)), message("user", c.question)];
        const r = await runRealtime(apiKey, items, { instructions: toolsTurnInstruction("English") });
        const problems = r.error ? [r.error] : scoreLocation(c, r);
        tally("location", !problems.length);
        const calls = r.calls?.map((x) => `${x.name}${x.arguments}`).join(" ") || "(no tool)";
        report("location", c.id, problems, `${calls}  ${JSON.stringify(r.text || "")}`);
      }
    }
  }

  console.log(
    "\n" +
      Object.entries(totals)
        .map(([label, [ok, all]]) => `${label}: ${ok}/${all} pass`)
        .join(" · ")
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
