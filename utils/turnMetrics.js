/**
 * Per-turn latency metrics for the media stream (logging only — never changes call behavior).
 * Turns are keyed by the Realtime input item_id; system turns (greeting, time-up) get synthetic ids.
 * One "turn_latency" log line per finished turn, one "call_latency" summary per call.
 */

const MAX_OPEN_TURNS = 50;
/** Fetches faster than this almost certainly came from the in-memory service cache. */
const LIKELY_CACHED_MS = 15;

function diff(a, b) {
  return a != null && b != null ? b - a : null;
}

function percentile(values, p) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Derived latencies (ms) for a finished turn. */
function computeTurnLatency(turn) {
  const t = turn.marks;
  const fetchTotalMs = turn.fetches.length
    ? turn.fetches.reduce((sum, f) => sum + f.ms, 0)
    : null;
  return {
    endOfSpeechToTranscriptMs: diff(t.speechStopped, t.transcriptCompleted),
    transcriptToResponseCreateMs: diff(t.transcriptCompleted, t.responseCreateSent),
    fetchTotalMs,
    responseCreateToFirstAudioMs: diff(t.responseCreateSent, t.firstAudioSent),
    endOfSpeechToFirstAudioMs: diff(t.speechStopped, t.firstAudioSent),
    // Tools mode: first audio may be the acknowledgement; this is when the answer itself starts
    endOfSpeechToAnswerAudioMs: diff(
      t.speechStopped,
      t.toolResultsSent != null ? t.answerAudioSent : t.firstAudioSent
    ),
    speechMs: diff(t.speechStarted, t.speechStopped),
  };
}

function noopMetrics() {
  return {
    enabled: false,
    setCallSid() {},
    onSpeechStarted() {},
    onSpeechStopped() {},
    onCommitted() {},
    onTranscript() {},
    setRoute() {},
    finishWithoutReply() {},
    beginSystemTurn: () => null,
    time: (turnId, label, fn) => fn(),
    onResponseCreateSent() {},
    onResponseCreated() {},
    onAudioSent() {},
    onToolResultsSent() {},
    onResponseEnded() {},
    turnForResponse: () => null,
    flush() {},
  };
}

/** Metrics must never break a call: swallow (and log) any bookkeeping error. */
function guarded(api, logger) {
  const safe = {};
  for (const [name, value] of Object.entries(api)) {
    if (typeof value !== "function" || name === "time") {
      safe[name] = value;
      continue;
    }
    safe[name] = (...args) => {
      try {
        return value(...args);
      } catch (err) {
        logger.warn({ err: err.message, method: name }, "Turn metrics failed (ignored)");
        return null;
      }
    };
  }
  return safe;
}

function createTurnMetrics({ logger, enabled = true, now = () => Date.now() }) {
  if (!enabled) return noopMetrics();
  return guarded(createEnabledMetrics({ logger, now }), logger);
}

function createEnabledMetrics({ logger, now }) {

  let callSid = null;
  let systemSeq = 0;
  let flushed = false;
  /** turnId -> turn */
  const turns = new Map();
  /** client_gen -> turnId */
  const genToTurn = new Map();
  /** response id -> turnId */
  const responseToTurn = new Map();
  const finished = [];

  function getTurn(turnId, create = true) {
    if (!turnId) return null;
    let turn = turns.get(turnId);
    if (!turn && create) {
      if (turns.size >= MAX_OPEN_TURNS) {
        const oldest = turns.keys().next().value;
        finish(oldest, "evicted");
      }
      turn = {
        turnId,
        kind: "user",
        path: null,
        intent: null,
        outcome: null,
        transcriptChars: null,
        marks: {},
        fetches: [],
        responseIds: [],
      };
      turns.set(turnId, turn);
    }
    return turn;
  }

  function mark(turnId, name, { once = true } = {}) {
    const turn = getTurn(turnId);
    if (!turn) return;
    if (once && turn.marks[name] != null) return;
    turn.marks[name] = now();
  }

  function finish(turnId, outcome) {
    const turn = turns.get(turnId);
    if (!turn) return;
    turns.delete(turnId);
    turn.outcome = turn.outcome || outcome;
    const latency = computeTurnLatency(turn);
    const record = {
      metric: "turn_latency",
      callSid,
      turnId: turn.turnId,
      kind: turn.kind,
      path: turn.path,
      intent: turn.intent,
      outcome: turn.outcome,
      transcriptChars: turn.transcriptChars,
      ...latency,
      fetches: turn.fetches,
    };
    finished.push(record);
    logger.info(record, "Turn latency");
  }

  return {
    enabled: true,

    setCallSid(sid) {
      callSid = sid;
    },

    onSpeechStarted(itemId) {
      mark(itemId, "speechStarted");
    },

    onSpeechStopped(itemId) {
      mark(itemId, "speechStopped");
    },

    onCommitted(itemId) {
      mark(itemId, "committed");
    },

    onTranscript(itemId, text) {
      mark(itemId, "transcriptCompleted");
      const turn = getTurn(itemId);
      if (turn) turn.transcriptChars = String(text || "").length;
    },

    /** path: billing | fast_path | chat | deferred | … ; intent: router intent when known. */
    setRoute(turnId, path, intent) {
      const turn = getTurn(turnId, false);
      if (!turn) return;
      turn.path = path;
      if (intent !== undefined) turn.intent = intent;
    },

    /** Turn that will not produce a reply (deferred, duplicate, call ending, busy skip). */
    finishWithoutReply(turnId, outcome) {
      finish(turnId, outcome);
    },

    beginSystemTurn(label) {
      systemSeq += 1;
      const turnId = `sys:${label}:${systemSeq}`;
      const turn = getTurn(turnId);
      turn.kind = "system";
      turn.path = label;
      return turnId;
    },

    /** Times fn() for this turn; passes its result/error through unchanged. */
    async time(turnId, label, fn) {
      const started = now();
      const record = (status, result) => {
        try {
          const ms = now() - started;
          const turn = getTurn(turnId, false);
          if (!turn) return;
          if (status === "threw") {
            turn.fetches.push({ label, ms, status });
          } else {
            turn.fetches.push({
              label,
              ms,
              status: result && result.error ? "error" : "ok",
              likelyCached: ms < LIKELY_CACHED_MS,
            });
          }
        } catch (err) {
          logger.warn({ err: err.message }, "Turn metrics failed (ignored)");
        }
      };
      let result;
      try {
        result = await fn();
      } catch (err) {
        record("threw");
        throw err;
      }
      record("ok", result);
      return result;
    },

    onResponseCreateSent(turnId, clientGen) {
      if (!turnId) return;
      mark(turnId, "responseCreateSent");
      if (clientGen != null) genToTurn.set(String(clientGen), turnId);
    },

    onResponseCreated(responseId, clientGen) {
      const turnId = clientGen != null ? genToTurn.get(String(clientGen)) : null;
      if (!turnId || !responseId) return;
      genToTurn.delete(String(clientGen));
      responseToTurn.set(responseId, turnId);
      const turn = getTurn(turnId, false);
      if (turn) turn.responseIds.push(responseId);
      mark(turnId, "responseCreated");
    },

    onAudioSent(responseId) {
      const turnId = responseToTurn.get(responseId);
      if (!turnId) return;
      mark(turnId, "firstAudioSent");
      const turn = getTurn(turnId, false);
      if (turn && turn.marks.toolResultsSent != null) mark(turnId, "answerAudioSent");
    },

    /** Tools mode: function_call_output items sent back to the model. */
    onToolResultsSent(turnId) {
      mark(turnId, "toolResultsSent");
    },

    /**
     * status: response.status from response.done (completed | incomplete | cancelled | failed)
     * or the event suffix. A completed function-call response keeps the turn open for the follow-up.
     */
    onResponseEnded(responseId, status, { functionCall = false } = {}) {
      const turnId = responseToTurn.get(responseId);
      if (!turnId) return;
      responseToTurn.delete(responseId);
      const completed = status === "done" || status === "completed" || status === "incomplete";
      if (functionCall && completed) return;
      const turn = getTurn(turnId, false);
      if (!turn) return;
      const outcome = completed
        ? turn.marks.firstAudioSent != null
          ? "replied"
          : "no_audio"
        : status;
      finish(turnId, outcome);
    },

    turnForResponse(responseId) {
      return responseToTurn.get(responseId) || null;
    },

    /** Call ended: log open turns and a per-call summary (once). */
    flush() {
      if (flushed) return;
      flushed = true;
      for (const turnId of [...turns.keys()]) {
        finish(turnId, "unfinished");
      }
      // Barged-in replies still count when audio reached the caller
      const userTurns = finished.filter(
        (r) => r.kind === "user" && r.endOfSpeechToFirstAudioMs != null
      );
      const headline = userTurns.map((r) => r.endOfSpeechToFirstAudioMs);
      logger.info(
        {
          metric: "call_latency",
          callSid,
          turns: finished.length,
          repliedUserTurns: userTurns.length,
          endOfSpeechToFirstAudioP50Ms: percentile(headline, 50),
          endOfSpeechToFirstAudioP90Ms: percentile(headline, 90),
        },
        "Call latency summary"
      );
    },
  };
}

module.exports = {
  createTurnMetrics,
  computeTurnLatency,
  percentile,
};
