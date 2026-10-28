/**
 * Manual tool-choice check for ROUTER_MODE=tools against the real OpenAI Realtime model (text only).
 * Sends each fixture question as a fresh conversation with the same tools + tools-mode instructions
 * the call handler uses, and checks which tools the model calls on its first round.
 * Uses the existing OPENAI_API_KEY (small per-case cost). Not part of npm test.
 *
 * Usage: node dev/toolChoiceEval.js [--cases test/fixtures/toolChoiceCases.json] [--out results.json]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { SYSTEM_PROMPT } = require("../utils/callStore");
const { languageInstruction, languageLabel } = require("../utils/replyLanguage");
const { billingInstruction } = require("../utils/billingReply");
const {
  buildToolDefinitions,
  TOOLS_SESSION_RULES,
  WEB_SEARCH_SESSION_RULE,
  toolsTurnInstruction,
} = require("../handlers/realtimeTools");

const URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
const CASE_TIMEOUT_MS = 20000;

function parseArgs(argv) {
  const args = {
    cases: path.join(__dirname, "..", "test", "fixtures", "toolChoiceCases.json"),
    out: null,
    webSearch: true,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cases") args.cases = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--no-web-search") args.webSearch = false;
  }
  return args;
}

/** Evaluate model choice over the full tool list (service availability is not under test). */
const ALL_ENABLED = new Proxy({}, { get: () => ({ enabled: true }) });
const NO_WEB_SEARCH = new Proxy({}, { get: (_, k) => ({ enabled: k !== "webSearchService" }) });

function runCase(apiKey, c, { webSearch }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    const session = { replyLanguage: c.lang || "en" };
    const started = Date.now();
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
            instructions: [
              SYSTEM_PROMPT,
              "",
              "## Active call rules (authoritative — follow these)",
              languageInstruction(session),
              billingInstruction(session),
              "",
              TOOLS_SESSION_RULES,
              ...(webSearch ? [WEB_SEARCH_SESSION_RULE] : []),
            ].join("\n"),
            tools: buildToolDefinitions(webSearch ? ALL_ENABLED : NO_WEB_SEARCH),
            tool_choice: "auto",
          },
        })
      );
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text: c.text }] },
        })
      );
      ws.send(
        JSON.stringify({
          type: "response.create",
          response: { instructions: toolsTurnInstruction(languageLabel(session.replyLanguage)) },
        })
      );
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
        const output = ev.response?.output || [];
        const calls = output
          .filter((o) => o.type === "function_call")
          .map((o) => {
            let args = {};
            try {
              args = JSON.parse(o.arguments || "{}");
            } catch {
              args = { raw: o.arguments };
            }
            return { name: o.name, args };
          });
        const messageText = (o) =>
          (o.content || [])
            .map((p) => p.text || p.transcript || "")
            .join(" ")
            .trim();
        const text = output
          .filter((o) => o.type === "message")
          .map(messageText)
          .join(" ")
          .trim();
        // Acknowledgement = non-empty message before the first function call
        const firstCall = output.findIndex((o) => o.type === "function_call");
        const ackBeforeCall =
          firstCall > 0 &&
          output.slice(0, firstCall).some((o) => o.type === "message" && messageText(o));
        ws.close();
        resolve({ calls, text, ackBeforeCall, ms: Date.now() - started });
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      resolve({ error: err.message });
    });
  });
}

function argsMatch(expected, actual) {
  if (!expected) return true;
  return Object.entries(expected).every(([k, v]) =>
    String(actual?.[k] ?? "").toLowerCase().includes(String(v).toLowerCase())
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  const { cases } = JSON.parse(fs.readFileSync(args.cases, "utf8"));

  const results = [];
  for (const c of cases) {
    const r = await runCase(apiKey, c, { webSearch: args.webSearch });
    const names = (r.calls || []).map((x) => x.name);
    // expectNoWeb: what the model should do when web_search is not offered
    const expect = !args.webSearch && c.expectNoWeb ? c.expectNoWeb : c.expect;
    const toolOk =
      !r.error &&
      (expect.length === 0
        ? names.length === 0
        : names.length >= 1 &&
          names.every((n) => n === expect[0]) &&
          names.length >= expect.length);
    const argOk = toolOk && (expect.length === 0 || argsMatch(c.args, r.calls[0]?.args));
    // noClaim: a spoken answer without a tool must not state this live fact
    const claimed = Boolean(c.noClaim && !names.length && new RegExp(c.noClaim, "i").test(r.text || ""));
    results.push({ ...c, ...r, names, toolOk, argOk, claimed });
    console.error(
      `${toolOk && !claimed ? (argOk ? "PASS" : "ARGS") : "FAIL"}  ${c.id.padEnd(16)} ${names.join(",") || "(no tool)"}  ${JSON.stringify((r.calls || [])[0]?.args || {})}${names.length ? (r.ackBeforeCall ? "  [ack]" : "  [no ack]") : ""}${claimed ? "  [unchecked claim] " + r.text : ""}${r.error ? "  " + r.error : ""}`
    );
  }

  const toolPass = results.filter((r) => r.toolOk).length;
  const argPass = results.filter((r) => r.argOk).length;
  const toolCases = results.filter((r) => r.names.length);
  const acked = toolCases.filter((r) => r.ackBeforeCall).length;
  const claims = results.filter((r) => r.claimed).length;
  console.log(
    `\nWeb search ${args.webSearch ? "on" : "off"} · Tool choice: ${toolPass}/${results.length} · tool + arguments: ${argPass}/${results.length} · acknowledgement before tool call: ${acked}/${toolCases.length} · unchecked live claims: ${claims}`
  );
  if (args.out) fs.writeFileSync(args.out, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
