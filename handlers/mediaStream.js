/**
 * Twilio Media Stream WebSocket handler.
 * Bridges Twilio (μ-law 8kHz) ↔ OpenAI Realtime API — μ-law passed straight through by default
 * (REALTIME_AUDIO_FORMAT=pcm24 converts to/from PCM 24kHz as before).
 */
const WebSocket = require("ws");
const { twilioToOpenAI, openAIToTwilio } = require("../services/audioConvert");
const { SYSTEM_PROMPT } = require("../utils/callStore");
const { emptyUsage, addResponseUsage, estimateCost } = require("../utils/realtimeCost");
const { spokenRate } = require("../services/fx");
const {
  findCountryInText,
  normalizeCountryCode,
  defaultCityForCountry,
} = require("../utils/placeResolve");
const {
  resolveIntent,
  extractTravelRoute,
  extractLocation,
  extractCityAndCountry,
  extractNewsQuery,
  extractFlightNumber,
  extractCurrencies,
  isHotelPriceQuestion,
  mentionsFlights,
  hotelTier,
  weatherForecastDay,
} = require("../utils/intentRouter");
const {
  formatWeatherFact,
  formatFareFact,
  formatPlacesFact,
  hotelPriceInstruction,
  cityName,
} = require("../utils/spokenFacts");
const { rememberTrip, recentTrip, completeRoute, shortPlaceReply } = require("../utils/tripContext");
const { parseTravelDates } = require("../utils/travelDates");
const {
  updateReplyLanguage,
  languageInstruction,
  languageLabel,
  wordCount,
} = require("../utils/replyLanguage");
const {
  isBillingQuestion,
  billingReply,
  billingInstruction,
  billingTurnNote,
} = require("../utils/billingReply");
const { createTurnMetrics } = require("../utils/turnMetrics");
const { identityReply } = require("../utils/identity");
const { isCrisisMessage, crisisInstruction, SENSITIVE_TURN_NOTE } = require("../utils/safety");
const {
  buildToolDefinitions,
  createToolExecutor,
  collectFunctionCalls,
  runToolCalls,
  toolResultLogFields,
  carriedOverPlace,
  askForPlace,
  fetchWeatherForPlace,
  fetchWeatherForPlaces,
  TOOLS_SESSION_RULES,
  WEB_SEARCH_SESSION_RULE,
  toolsTurnInstruction,
  toolsFollowUpInstruction,
  toolChoiceAgreement,
} = require("./realtimeTools");

/** Defaults for the OpenAI Realtime session; config.realtime (from .env) overrides each one. */
const REALTIME_DEFAULTS = {
  model: "gpt-realtime",
  /** Reasoning models only (gpt-realtime-2.x): minimal | low | medium | high. null = not sent. */
  reasoningEffort: null,
  voice: "marin",
  /** "pcmu": Twilio μ-law passed straight through; "pcm24": converted to/from PCM 24 kHz. */
  audioFormat: "pcmu",
  transcribeModel: "gpt-transcribe",
  /** Brand and place words sent to the transcriber so names are heard right. */
  transcribeHints: true,
  noiseReduction: "far_field",
  /** Per-reply cap (tokens); null = the model's maximum. A safety net against runaway replies. */
  maxOutputTokens: null,
  /** Conversation tokens kept after the instructions on long calls; null = OpenAI's default. */
  truncationTokens: null,
};
/** Tools mode: after this many tool rounds in one turn, the follow-up must speak (tools: []). */
const MAX_TOOL_ROUNDS = 2;

// Short, warm greeting — then stop and listen (no long intros)
const GREETING = "Hi! I'm Buddy, your AI friend. Ask me anything you want.";

function buildRealtimeInstructions(session, { toolsMode = false, webSearch = false } = {}) {
  const parts = [
    SYSTEM_PROMPT,
    "",
    "## Active call rules (authoritative — follow these)",
    languageInstruction(session),
    billingInstruction(session),
  ];
  if (toolsMode) parts.push("", TOOLS_SESSION_RULES);
  if (toolsMode && webSearch) parts.push(WEB_SEARCH_SESSION_RULE);
  return parts.join("\n");
}

/**
 * Response instructions REPLACE the session instructions for that reply (checked live 2026-11-02:
 * a rule only in the session prompt was ignored once a reply had its own instructions). So every
 * in-conversation reply carries the full call prompt first, then the turn's own rules. The prompt
 * part is identical turn to turn, so it is served from OpenAI's prompt cache.
 */
function withCallPrompt(callPrompt, turnInstructions) {
  return `${callPrompt}\n\n## This reply (authoritative — follow these for this reply)\n${turnInstructions}`;
}

/** Words the transcriber should expect (names it otherwise mishears). */
const TRANSCRIBE_PROMPT =
  "Phone call with Buddy, an AI assistant by BuddyCallAI and Brash3D Media Group. " +
  "Callers ask about weather, flights, hotels, restaurants, and places such as Medellín, Bogotá, Cartagena, Miami, Orlando, and San Juan, " +
  "and may speak English, Spanish, Italian, Portuguese, French, or Chinese.";

/**
 * Realtime input: audio format, denoise, caller transcription (gpt-transcribe: whisper-1 is removed
 * from the API on 2027-02-26 and was less accurate and slower on phone audio), then semantic turn
 * detection (waits on fillers / incomplete thoughts; we create every response ourselves).
 */
function realtimeInputAudio(rt) {
  const transcription = { model: rt.transcribeModel };
  if (rt.transcribeHints) transcription.prompt = TRANSCRIBE_PROMPT;
  return {
    format: rt.audioFormat === "pcm24" ? { type: "audio/pcm", rate: 24000 } : { type: "audio/pcmu" },
    noise_reduction: rt.noiseReduction === "off" ? null : { type: rt.noiseReduction },
    transcription,
    turn_detection: {
      type: "semantic_vad",
      eagerness: "medium",
      interrupt_response: true,
      create_response: false,
    },
  };
}

/** Session fields for cost and model control; each only sent when set. */
function realtimeSessionExtras(rt) {
  const extras = {};
  // gpt-realtime rejects reasoning ("Unsupported option for this model", checked live): 2.x only
  if (rt.reasoningEffort && /^gpt-realtime-2/.test(rt.model)) extras.reasoning = { effort: rt.reasoningEffort };
  if (rt.maxOutputTokens) extras.max_output_tokens = rt.maxOutputTokens;
  if (rt.truncationTokens) {
    extras.truncation = {
      type: "retention_ratio",
      retention_ratio: 0.8,
      token_limits: { post_instructions: rt.truncationTokens },
    };
  }
  return extras;
}

const echoWords = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * The caller's phone playing Buddy back (speakerphone): production 2026-10-30 transcribed the greeting
 * as "Hi, I'm Bunny, your AI..." and Buddy answered itself. Four or more words, nearly all from
 * what Buddy just said.
 */
function isEchoOfReply(text, reply) {
  const said = echoWords(text);
  if (said.length < 4) return false;
  const heard = new Set(echoWords(reply));
  return said.filter((w) => heard.has(w)).length / said.length >= 0.75;
}
const ECHO_WINDOW_MS = 8000;

/** "Hi Buddy." / "Hello?" / "Hola, buenas tardes" — a greeting and nothing else. */
function isGreetingOnly(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[¡¿!?.,…]+/g, " ")
    .trim();
  return /^(?:(?:hi|hey|hello|hiya|yo|good (?:morning|afternoon|evening)|hola|buenas(?: tardes| noches| d[ií]as)?|buenos d[ií]as|ciao|ol[aá]|bonjour)\s*)+(?:(?:there|buddy|bud|man|again)\s*)*$/.test(t);
}
/** How long a greeting-only turn waits for the caller to go on before Buddy answers it. */
const GREETING_HOLD_MS = 1200;

function responseIdFromEvent(ev) {
  return ev?.response?.id || ev?.response_id || null;
}

/**
 * User is holding the floor (thinking / asking for time) — do not reply yet.
 * Semantic VAD correctly ends these as complete sentences; we must not jump in.
 * Never defer when the same utterance also contains a real question/request.
 */
function shouldDeferUserTurn(text) {
  const raw = String(text || "").trim();
  const t = raw
    .toLowerCase()
    .replace(/[.!?…]+$/g, "")
    .replace(/\s+/g, " ");
  if (!t) return true;

  // Bare ASR crumbs / fillers / backchannels — not a real turn
  if (/^(you|uh+|u[mh]+|ah+|oh+|aha+|hmm+|mm+|mhm|eh+)$/i.test(t)) return true;
  // "Oh okay" / "oh, I see" — production call answered a bare "Oh." with "Feel free to chat as long as you'd like!"
  if (/^(oh+|ah+)[,\s]+(okay|ok|i see|right|wow|nice)$/i.test(t)) return true;
  if (
    /^(yeah|yep|yup|yes|no|nope|ok|okay|right|sure|great|cool|thanks|thank you)([,\s]+\1)*$/i.test(
      t
    )
  ) {
    return true;
  }
  // "great, great, great" / "yeah yeah"
  if (/^(?:(yeah|yes|ok|okay|great|cool|sure)[\s,]+)+(yeah|yes|ok|okay|great|cool|sure)$/i.test(t)) {
    return true;
  }

  // Hold + real ask in one utterance → answer the ask (do not defer)
  // Note: do not treat "give me a second/moment" as an ask
  const hasRealAsk =
    /\?/.test(raw) ||
    /\b(what(?:'s| is| are)|how (?:can|do|to|about)|can you|could you|will you|tell me|help me|weather (?:in|for)|plan my)\b/i.test(
      t
    ) ||
    /\bgive me (?:the|an)\b/i.test(t) ||
    /\bgive me a (?!second|moment|minute)\w+/i.test(t);
  if (hasRealAsk) return false;

  // Hold-only / thinking-only (full utterance)
  if (
    /^(?:(?:well|so|okay|ok|actually)[, ]+)?(?:let me think(?:\s+(?:for a (?:second|moment|minute)|about it))?|give me a (?:second|moment|minute)(?:\s+to think)?|just a (?:second|moment|minute)|one (?:second|moment|minute)|hold on|hang on|let me finish|let me explain|i need a (?:second|moment|minute))(?:\s+(?:for a (?:second|moment|minute)|a (?:second|moment|minute)|okay|ok|please))?$/i.test(
      t
    )
  ) {
    return true;
  }
  // "wait" / "wait wait wait" only
  if (/^(?:wait\s*,?\s*)+wait$/i.test(t) || /^wait$/i.test(t)) return true;

  // Preamble only — they signaled a question is coming
  if (
    /^(i wanted to ask you something|i (just )?have a question|i need to explain something( important)?|let me ask you something|i want to ask (you )?something)(?:\s*,?\s*let me think(?:\s+for a (?:second|moment|minute))?)?$/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

const WEATHER_TOOL = {
  type: "function",
  name: "get_weather",
  description:
    "Get current weather for a city. Always call this for weather/temperature/forecast—never guess. When the user names a country or territory (e.g. Puerto Rico, France), pass it in country (ISO code or full name) and use that country's main city if no city is given. For ambiguous cities (San Juan, London, Paris), country is required. If they ask about two cities (A or B), call once per city.",
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "City name, e.g. London, Miami, San Juan, Karachi",
      },
      country: {
        type: "string",
        description:
          "Country or territory to disambiguate — ISO code preferred (PR, US, FR) or full name (Puerto Rico, France). Always set when known from this or prior turns.",
      },
    },
    required: ["city"],
  },
};

const TIME_UP_TEXT =
  "Your time for this call is up. To keep talking, subscribe or add minutes at buddycallai dot com. Goodbye.";
/** Word for word in English; in the call's language otherwise (production: English heads-up on a Mandarin call). */
const sayInCallLanguage = (text, langName) =>
  langName === "English"
    ? `Say exactly this and nothing else: ${text}`
    : `Say this in ${langName} and nothing else, keeping its meaning, numbers, and the website: ${text}`;
const timeUpInstruction = (langName) => sayInCallLanguage(TIME_UP_TEXT, langName);
const timeWarningInstruction = (seconds, langName) =>
  sayInCallLanguage(`Quick heads-up, there are about ${seconds} seconds left on this call.`, langName);
/**
 * Time messages are answered out of band — no conversation context, only the sentence. Production
 * 2026-11-01: the time-up message, sent while the caller was talking, came out as "Sure, I'm
 * checking the time now. Just a moment." (the model answered the caller's audio instead).
 */
const OUT_OF_BAND = { conversation: "none", input: [] };

/**
 * Fast-path replies are the whole answer. In a production call the model said "Let me find the
 * prices… please hold on" over a hotel list, then went silent — nothing runs after this reply.
 */
const NO_PROMISE_NOTE = "don't say you'll check or look anything up, and don't ask them to hold on";

function createMediaStreamHandler({
  callStore,
  logger,
  openaiApiKey,
  weatherService,
  openMeteoService,
  timeService,
  worldTimeService,
  placesService,
  travelService,
  newsService,
  fxService,
  sportsService,
  flightsService,
  stocksService,
  /** Tools mode only (never offered or called by the regex router). */
  webSearchService,
  twilioClient,
  latencyMetricsEnabled = true,
  /** "regex" (default, existing fast paths) or "tools" (model picks existing-service tools). */
  routerMode = "regex",
  toolDeadlineMs = 4000,
  /** OpenAI Realtime session settings (config.realtime); missing fields use REALTIME_DEFAULTS. */
  realtime = {},
  /** Test servers only; production builds the URL from realtime.model. */
  realtimeUrl = null,
  /** Limited calls: heads-up this many seconds before the time-up message. */
  timeWarningSeconds = 15,
  /** Shared count of live calls (graceful shutdown waits for it to reach zero). */
  activeCalls = null,
}) {
  const rt = { ...REALTIME_DEFAULTS, ...Object.fromEntries(Object.entries(realtime).filter(([, v]) => v !== undefined)) };
  const openaiUrl = realtimeUrl || `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(rt.model)}`;
  const passThroughAudio = rt.audioFormat !== "pcm24";
  const toolsMode = routerMode === "tools";
  const toolServices = {
    weatherService,
    openMeteoService,
    timeService,
    worldTimeService,
    placesService,
    travelService,
    newsService,
    fxService,
    sportsService,
    flightsService,
    stocksService,
    webSearchService,
  };
  const toolDefinitions = toolsMode ? buildToolDefinitions(toolServices) : [];
  const webSearchOffered = toolDefinitions.some((t) => t.name === "web_search");
  const toolExecutor = toolsMode
    ? createToolExecutor({ services: toolServices, logger, deadlineMs: toolDeadlineMs })
    : null;

  /** Session tool config: tools mode → all enabled tools; regex mode → unchanged legacy weather tool. */
  function sessionToolFields() {
    if (toolsMode) return { tools: toolDefinitions, tool_choice: "auto" };
    if (weatherService && weatherService.enabled) {
      return { tools: [WEATHER_TOOL], tool_choice: "auto" };
    }
    return {};
  }

  return function handleMediaStream(twilioWs, req) {
    /** Logging-only latency metrics; never affects call flow. */
    const metrics = createTurnMetrics({ logger, enabled: latencyMetricsEnabled });
    /** Tools mode: client_gen of a model turn → { turnId, regexIntent, rounds, callerText, earlierCallerTexts, webSearch }. */
    const toolTurns = new Map();
    /** Bumped whenever the caller starts speaking; stale tool results are not spoken. */
    let userSpeechSeq = 0;
    let callSid = null;
    let streamSid = null;
    let openaiWs = null;
    let transcriptLines = [];
    let lastUserTranscript = "";
    /** Buddy's last spoken reply and when it finished — for the echo check. */
    let lastAiReply = { text: "", at: 0 };
    let responseInProgress = false;
    /** OpenAI response id currently allowed to send outbound audio to Twilio. */
    let activeResponseId = null;
    /** Bumped on each intentional create / interrupt so stale response.created cannot bind. */
    let responseGeneration = 0;
    let expectedGeneration = 0;
    /**
     * Number of in-flight creates that were interrupted before response.created.
     * Each matching created event is cancelled (works even if metadata is stripped).
     */
    let pendingCreatedCancels = 0;
    let timeLimitTimer = null;
    /** Caller mid-utterance, and when they last stopped — the time heads-up never talks over them. */
    let callerSpeaking = false;
    let lastSpeechStoppedAt = 0;
    /**
     * The last response.create, kept for one retry: production logged "conversation already has an
     * active response" when a new question arrived as an interrupted reply was still ending, and the
     * caller's question went unanswered.
     */
    let lastCreate = null;
    let retryAfterActiveEnds = null;
    /** Token usage for the call (cost log at the end). */
    const usage = emptyUsage();
    let callStartedAt = 0;
    let callClosed = false;
    let speechStartedAt = 0;
    /** A greeting-only turn waiting to see if the caller goes on ({ timer, turnId }). */
    let pendingGreeting = null;

    /** Call immediately before each response.create; returns generation for metadata. */
    function markResponseCreateSent() {
      responseGeneration += 1;
      expectedGeneration = responseGeneration;
      responseInProgress = true;
      return expectedGeneration;
    }

    /**
     * standalone: the instructions are the whole prompt (greeting, out-of-band time messages);
     * otherwise the call prompt is put first, since reply instructions replace the session's.
     */
    function createResponsePayload(responseFields, metricsTurnId, { standalone = false } = {}) {
      const gen = markResponseCreateSent();
      metrics.onResponseCreateSent(metricsTurnId, gen);
      const fields = { ...responseFields };
      if (fields.instructions && !standalone && fields.conversation !== "none") {
        fields.instructions = withCallPrompt(
          buildRealtimeInstructions(callStore.get(callSid), { toolsMode, webSearch: webSearchOffered }),
          fields.instructions
        );
      }
      const payload = {
        type: "response.create",
        response: {
          ...fields,
          metadata: { ...(fields.metadata || {}), client_gen: String(gen) },
        },
      };
      lastCreate = { payload, gen, retried: false };
      return payload;
    }

    /** Cancel in-flight agent audio only — never stop inbound user audio append. */
    function interruptAgentPlayback() {
      if (!responseInProgress && !activeResponseId && pendingCreatedCancels === 0) {
        return;
      }
      const idToCancel = activeResponseId;
      const hadPendingCreate = responseInProgress && !idToCancel;
      responseGeneration += 1;
      expectedGeneration = responseGeneration;
      activeResponseId = null;
      responseInProgress = false;
      if (hadPendingCreate) pendingCreatedCancels += 1;
      if (idToCancel && openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(JSON.stringify({ type: "response.cancel" }));
      }
      if (twilioWs && twilioWs.readyState === WebSocket.OPEN && streamSid) {
        twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
      }
    }

    /**
     * Tools mode: run every function call in a finished model response (in parallel),
     * return outputs, then ask for the spoken answer — unless the caller spoke meanwhile.
     */
    function handleToolsResponse(response, metricsTurnId) {
      const gen = String(response?.metadata?.client_gen ?? "");
      const toolTurn = toolTurns.get(gen) || null;
      toolTurns.delete(gen);
      const calls = collectFunctionCalls(response);
      const toolNames = calls.map((c) => c.name);
      if (toolTurn && toolTurn.rounds === 0) {
        logger.info(
          {
            callSid,
            regexIntent: toolTurn.regexIntent,
            tools: toolNames,
            agreement: toolChoiceAgreement(toolTurn.regexIntent, toolNames),
          },
          "Tool choice"
        );
      }
      if (!calls.length) return;

      const rounds = (toolTurn?.rounds || 0) + 1;
      const speechSeqAtStart = userSpeechSeq;
      (async () => {
        const outputs = await runToolCalls(calls, toolExecutor, {
          timed: (label, fn) => metrics.time(metricsTurnId, label, fn),
          // A city from an earlier request is not searched unless the caller is continuing that topic
          guard: (name, args) => {
            const place = carriedOverPlace(name, args, {
              latest: toolTurn?.callerText || "",
              earlier: toolTurn?.earlierCallerTexts || [],
            });
            if (!place) return null;
            logger.info({ callSid, tool: name, place }, "Tool not run: place only named in an earlier request");
            return askForPlace(place);
          },
        });
        if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
        for (const o of outputs) {
          openaiWs.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: { type: "function_call_output", call_id: o.call_id, output: o.output },
            })
          );
          logger.info({ callSid, tool: o.name, ...toolResultLogFields(o.name, o.args, o.result) }, "Tool result");
        }
        metrics.onToolResultsSent(metricsTurnId);

        if (userSpeechSeq !== speechSeqAtStart || callStore.get(callSid)?.callEnding) {
          logger.info({ callSid }, "Tool answer not spoken: caller spoke or call ending");
          metrics.finishWithoutReply(metricsTurnId, "interrupted_during_tool");
          return;
        }
        if (responseInProgress) {
          logger.info({ callSid }, "Tool answer skipped: response already in progress");
          metrics.finishWithoutReply(metricsTurnId, "skipped_busy");
          return;
        }
        const langName = languageLabel(callStore.get(callSid)?.replyLanguage || "en");
        // Web results earlier in this turn still need source / conflict handling in a later round
        const webSearch = Boolean(toolTurn?.webSearch) || outputs.some((o) => o.name === "web_search");
        const fields = { instructions: toolsFollowUpInstruction(langName, { webSearch }) };
        // Cap tool rounds: last follow-up must speak, not call more tools
        if (rounds >= MAX_TOOL_ROUNDS) fields.tools = [];
        const payload = createResponsePayload(fields, metricsTurnId);
        toolTurns.set(String(payload.response.metadata.client_gen), {
          ...(toolTurn || { regexIntent: null }),
          rounds,
          webSearch,
        });
        openaiWs.send(JSON.stringify(payload));
      })().catch((err) => {
        logger.error({ callSid, err: err.message }, "Tools turn failed");
      });
    }

    /** Sends the reply queued after "active response" (once), if no newer turn replaced it. */
    function sendQueuedReply() {
      const queued = retryAfterActiveEnds;
      retryAfterActiveEnds = null;
      if (!queued || queued.gen !== expectedGeneration) return;
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
      responseInProgress = true;
      openaiWs.send(JSON.stringify(queued.payload));
      logger.info({ callSid }, "Queued reply sent");
    }

    /** Token usage and estimated OpenAI cost for the call — one log line at the end. */
    function logCallUsage() {
      if (!callSid || !usage.responses) return;
      const callSeconds = callStartedAt ? Math.round((Date.now() - callStartedAt) / 1000) : 0;
      const cost = estimateCost(usage, { model: rt.model, transcribeModel: rt.transcribeModel, callSeconds });
      logger.info(
        {
          metric: "call_usage",
          callSid,
          model: rt.model,
          transcribeModel: rt.transcribeModel,
          routerMode,
          callSeconds,
          ...usage,
          estUsd: cost.usd,
          estUsdPerMinute: cost.usdPerMinute,
          cachedShare: cost.cachedShare,
        },
        "Call usage"
      );
    }

    const cleanup = () => {
      if (callClosed) return;
      callClosed = true;
      if (pendingGreeting) clearTimeout(pendingGreeting.timer);
      if (activeCalls && callSid) activeCalls.delete(callSid);
      logCallUsage();
      metrics.flush();
      if (timeLimitTimer) {
        clearInterval(timeLimitTimer);
        timeLimitTimer = null;
      }
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
    };

    twilioWs.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.event === "connected") {
        logger.info({ stream: "twilio" }, "Twilio media stream connected");
        return;
      }

      if (msg.event === "start") {
        callSid = msg.start?.callSid || msg.callSid;
        streamSid = msg.start?.streamSid || msg.streamSid;
        metrics.setCallSid(callSid);
        callStore.getOrCreate(callSid);
        callStartedAt = Date.now();
        if (activeCalls && callSid) activeCalls.add(callSid);
        // The greeting reaches the transcript from its spoken audio, like every other reply
        logger.info({ callSid, streamSid }, "Media stream started");

        const bill = callStore.get(callSid);
        const maxSec =
          bill?.maxBillableSeconds != null &&
          Number.isFinite(Number(bill.maxBillableSeconds))
            ? Math.floor(Number(bill.maxBillableSeconds))
            : null;

        if (maxSec != null && maxSec > 0 && twilioClient) {
          let elapsed = 0;
          // Only when there's time to hear it and still talk (a 60-second trial: at 45 seconds)
          let warningDue = maxSec >= timeWarningSeconds * 2;
          timeLimitTimer = setInterval(() => {
            elapsed += 1;
            if (warningDue && elapsed >= maxSec - timeWarningSeconds) {
              const quiet =
                !responseInProgress &&
                !callerSpeaking &&
                Date.now() - lastSpeechStoppedAt > 2000 &&
                openaiWs?.readyState === WebSocket.OPEN;
              if (quiet) {
                warningDue = false;
                openaiWs.send(
                  JSON.stringify(
                    createResponsePayload(
                      {
                        ...OUT_OF_BAND,
                        instructions: timeWarningInstruction(
                          maxSec - elapsed,
                          languageLabel(callStore.get(callSid)?.replyLanguage || "en")
                        ),
                        tools: [],
                      },
                      metrics.beginSystemTurn("time_warning")
                    )
                  )
                );
              } else if (maxSec - elapsed < 5) {
                warningDue = false; // too late to be useful
              }
            }
            if (elapsed < maxSec) return;
            if (timeLimitTimer) {
              clearInterval(timeLimitTimer);
              timeLimitTimer = null;
            }
            (async () => {
              try {
                const billRef = callStore.get(callSid);
                if (billRef) billRef.callEnding = true;
                if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
                  openaiWs.send(
                    JSON.stringify(
                      createResponsePayload(
                        {
                          ...OUT_OF_BAND,
                          instructions: timeUpInstruction(languageLabel(billRef?.replyLanguage || "en")),
                          tools: [],
                        },
                        metrics.beginSystemTurn("time_up")
                      )
                    )
                  );
                }
                const pauseMs = openaiWs?.readyState === WebSocket.OPEN ? 9000 : 800;
                await new Promise((r) => setTimeout(r, pauseMs));
                await twilioClient.calls(callSid).update({ status: "completed" });
                logger.info({ callSid, maxSec }, "Call ended: billable time limit");
              } catch (err) {
                logger.error(
                  { callSid, err: err.message },
                  "Time-limit hangup failed"
                );
              }
            })();
          }, 1000);
        }

        // Connect to OpenAI Realtime
        openaiWs = new WebSocket(openaiUrl, {
          headers: {
            Authorization: `Bearer ${openaiApiKey}`,
          },
        });

        openaiWs.on("open", () => {
          logger.info({ callSid, model: rt.model, audioFormat: rt.audioFormat, transcribeModel: rt.transcribeModel }, "OpenAI Realtime connected");
          const billSession = callStore.get(callSid);
          if (billSession && !billSession.replyLanguage) {
            billSession.replyLanguage = "en";
          }
          const session = {
            type: "realtime",
            instructions: buildRealtimeInstructions(billSession, { toolsMode, webSearch: webSearchOffered }),
            audio: {
              input: realtimeInputAudio(rt),
              output: {
                ...(passThroughAudio ? { format: { type: "audio/pcmu" } } : { format: { type: "audio/pcm", rate: 24000 } }),
                voice: rt.voice,
              },
            },
            ...realtimeSessionExtras(rt),
            ...sessionToolFields(),
          };
          openaiWs.send(
            JSON.stringify({ type: "session.update", session })
          );
          // Say greeting once, then stop and listen
          openaiWs.send(
            JSON.stringify(
              createResponsePayload(
                {
                  instructions: `Say exactly: ${GREETING}`,
                  tools: [],
                },
                metrics.beginSystemTurn("greeting"),
                { standalone: true }
              )
            )
          );
        });

        openaiWs.on("message", (data) => {
          let ev;
          try {
            ev = JSON.parse(data.toString());
          } catch {
            return;
          }

          if (ev.type === "error") {
            if (ev.error?.code === "response_cancel_not_active") {
              logger.info(
                { callSid, code: ev.error.code },
                "Ignore benign response.cancel (no active response)"
              );
              return;
            }
            // A new reply was asked for while an interrupted one was still ending: send it again
            // once that one ends, unless the caller has spoken since (a newer turn replaced it)
            if (
              ev.error?.code === "conversation_already_has_active_response" &&
              lastCreate &&
              !lastCreate.retried &&
              lastCreate.gen === expectedGeneration
            ) {
              lastCreate.retried = true;
              retryAfterActiveEnds = lastCreate;
              logger.info({ callSid }, "Reply queued: previous response still ending");
              // If no end event arrives, send it anyway shortly
              setTimeout(sendQueuedReply, 1500);
              return;
            }
            logger.error({ callSid, error: ev.error }, "OpenAI Realtime error");
            return;
          }

          function syncSessionInstructions() {
            if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
            const sess = callStore.get(callSid);
            const payload = {
              type: "realtime",
              instructions: buildRealtimeInstructions(sess, { toolsMode, webSearch: webSearchOffered }),
              ...sessionToolFields(),
            };
            openaiWs.send(
              JSON.stringify({ type: "session.update", session: payload })
            );
          }

          function sendReplyBase(reply, opts = {}) {
            if (responseInProgress) {
              logger.info({ callSid }, "Skip fast-path: response already in progress");
              metrics.finishWithoutReply(opts.turnId, "skipped_busy");
              return;
            }
            const sess = callStore.get(callSid);
            const langName = languageLabel(sess?.replyLanguage || "en");
            // Fixed answers (identity, recording, billing, language): never shortened or reworded —
            // live replay: "our chat stays on this line" replaced the transcript sentence
            const exactInstruction =
              langName === "English"
                ? `Say only the quoted text, word for word, adding nothing: "${reply}"`
                : `Say this in ${langName} and nothing else, translating it fully and keeping every fact, number, and website (don't shorten it): ${reply}`;
            const instruction = opts.exact
              ? exactInstruction
              : opts.multilingual !== false
                ? `Say the following in ${langName} only, ${
                    opts.maxWords
                      ? `in up to ${opts.maxWords} words, keeping every name and number`
                      : "one short sentence (15 to 20 words max)"
                  }; it is your whole answer, so ${NO_PROMISE_NOTE}: ${reply}${/[.?!]$/.test(reply) ? "" : "."}`
                : `Say only the quoted sentence, word for word, with no other facts or numbers: "${reply}"`;
            // No tools on fast-path replies — prevents double weather/hotel answers
            openaiWs.send(
              JSON.stringify(
                createResponsePayload({ instructions: instruction, tools: [] }, opts.turnId)
              )
            );
            // The transcript gets what was actually spoken (output_audio_transcript.done), which
            // can differ from this planned fact — logged separately for debugging
            const factLog = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
            logger.info({ callSid, fact: reply }, `Fast-path fact: ${factLog}`);
          }

          /** A model-worded reply with no tools (e.g. typical hotel prices around looked-up facts). */
          function sendModelTurn(instructions, turnId, logLabel) {
            if (openaiWs?.readyState !== WebSocket.OPEN) return;
            if (responseInProgress) {
              logger.info({ callSid }, `Skip ${logLabel}: response already in progress`);
              metrics.finishWithoutReply(turnId, "skipped_busy");
              return;
            }
            openaiWs.send(JSON.stringify(createResponsePayload({ instructions, tools: [] }, turnId)));
            logger.info({ callSid }, logLabel);
          }

          /** held: re-entered after the greeting pause (logging, transcript, and counters already done). */
          function handleUserTranscript(text, turnId, { held = false } = {}) {
            // Metrics helpers bound to this turn (pass results through unchanged)
            const sendReply = (reply, opts = {}) => sendReplyBase(reply, { ...opts, turnId });
            const timed = (label, fn) => metrics.time(turnId, label, fn);
            // Fare for the caller's dates when they gave any, else the recent cheapest (any dates)
            const lookupFare = (origin, destination, d) =>
              d && (d.departDate || d.departMonth || d.window)
                ? timed("travel_fare", () => travelService.fareForTrip(origin, destination, d))
                : timed("travel_fare", () => travelService.cheapestRoute(origin, destination));

            const trimmed = (text != null && text !== "" ? String(text).trim() : "");
            if (!trimmed) {
              metrics.finishWithoutReply(turnId, "empty");
              return;
            }
            const sessionRef = callStore.get(callSid);
            if (!held) {
              const userLog = trimmed.length > 100 ? trimmed.slice(0, 100) + "…" : trimmed;
              logger.info({ callSid, transcript: trimmed, role: "user" }, `USER: ${userLog}`);
              if (Date.now() - lastAiReply.at < ECHO_WINDOW_MS && isEchoOfReply(trimmed, lastAiReply.text)) {
                logger.info({ callSid, transcript: trimmed }, "Skip turn: echo of Buddy's own reply");
                metrics.finishWithoutReply(turnId, "echo");
                return;
              }
              if (trimmed === lastUserTranscript) {
                metrics.finishWithoutReply(turnId, "duplicate");
                return;
              }
              lastUserTranscript = trimmed;
              transcriptLines.push(`Caller: ${trimmed}`);
              callStore.addUserMessage(callSid, trimmed);
              if (sessionRef) sessionRef.callerTurns = (sessionRef.callerTurns || 0) + 1;
            }
            if (sessionRef?.callEnding) {
              logger.info({ callSid }, "Skip turn: call ending (time limit)");
              metrics.finishWithoutReply(turnId, "call_ending");
              return;
            }

            // "Hi Buddy," then a pause, then the real question: the turn detector often ends the turn
            // after the greeting, and Buddy's small talk ran over the question (replay 2026-11-02). A
            // greeting alone waits briefly: if the caller keeps talking, their next words are the turn.
            if (!held && pendingGreeting) {
              // The caller went on after a greeting: answer this, not the greeting
              clearTimeout(pendingGreeting.timer);
              metrics.finishWithoutReply(pendingGreeting.turnId, "greeting_merged");
              logger.info({ callSid }, "Greeting not answered: the caller kept talking");
              pendingGreeting = null;
            }
            if (!held && isGreetingOnly(trimmed)) {
              const seqAtGreeting = userSpeechSeq;
              const timer = setTimeout(() => {
                pendingGreeting = null;
                if (userSpeechSeq !== seqAtGreeting || callerSpeaking) {
                  logger.info({ callSid, transcript: trimmed }, "Greeting not answered: the caller kept talking");
                  metrics.finishWithoutReply(turnId, "greeting_merged");
                  return;
                }
                handleUserTranscript(text, turnId, { held: true });
              }, GREETING_HOLD_MS);
              pendingGreeting = { timer, turnId };
              return;
            }

            interruptAgentPlayback();

            // Before the backchannel check: a bare "Yes" may be accepting a language offer
            const langUpdate = updateReplyLanguage(sessionRef, trimmed);
            if (langUpdate.changed) {
              logger.info(
                { callSid, replyLanguage: langUpdate.language },
                "Reply language updated"
              );
              syncSessionInstructions();
            }
            if (langUpdate.acceptedOffer) {
              metrics.setRoute(turnId, "language");
              const name = languageLabel(langUpdate.language);
              sendReply(`Sure, I'll speak ${name} from now on. How can I help you?`, { exact: true });
              return;
            }
            // "Do you speak Spanish?" — answer and offer in the current language; switch only on yes
            if (langUpdate.offer) {
              metrics.setRoute(turnId, "language");
              const name = languageLabel(langUpdate.offer);
              sendReply(`Yes, I can speak ${name}. Would you like me to switch to ${name}?`, { exact: true });
              return;
            }

            if (shouldDeferUserTurn(trimmed)) {
              logger.info({ callSid, transcript: trimmed }, "Skip turn: user holding floor");
              metrics.setRoute(turnId, "deferred");
              metrics.finishWithoutReply(turnId, "deferred");
              return;
            }

            // Self-harm / suicide / abuse / danger: caring reply with 988 / 911 before any other routing
            if (isCrisisMessage(trimmed)) {
              metrics.setRoute(turnId, "safety");
              logger.info({ callSid }, "Crisis message: safety reply");
              if (openaiWs?.readyState !== WebSocket.OPEN || responseInProgress) {
                metrics.finishWithoutReply(turnId, "skipped_busy");
                return;
              }
              const langName = languageLabel(sessionRef?.replyLanguage || "en");
              openaiWs.send(
                JSON.stringify(createResponsePayload({ instructions: crisisInstruction(langName), tools: [] }, turnId))
              );
              return;
            }

            // "What's your name?" / "Who created you?" — fixed answers (Buddy, Brash3D Media Group)
            const identity = identityReply(trimmed);
            if (identity) {
              metrics.setRoute(turnId, "identity");
              sendReply(identity, { exact: true });
              return;
            }

            // Honest trial / plan answers — never invent unlimited free time
            if (isBillingQuestion(trimmed)) {
              metrics.setRoute(turnId, "billing");
              const fact = billingReply(sessionRef, trimmed);
              // Word for word: the plan list runs ~50 words, and "never charged" must not be dropped
              sendReply(fact, { exact: true });
              return;
            }

            // Tools mode: the model picks an existing-service tool (or answers directly).
            // Regex intent is computed only for the shadow agreement log.
            if (toolsMode) {
              const regexIntent = resolveIntent(trimmed);
              metrics.setRoute(turnId, "tools", regexIntent);
              if (openaiWs?.readyState !== WebSocket.OPEN) return;
              if (responseInProgress) {
                logger.info({ callSid }, "Skip tools turn: response already in progress");
                metrics.finishWithoutReply(turnId, "skipped_busy");
                return;
              }
              const langName = languageLabel(sessionRef?.replyLanguage || "en");
              const payload = createResponsePayload(
                { instructions: toolsTurnInstruction(langName) + SENSITIVE_TURN_NOTE + billingTurnNote(sessionRef) },
                turnId
              );
              const callerTexts = transcriptLines
                .filter((l) => l.startsWith("Caller: "))
                .map((l) => l.slice("Caller: ".length));
              toolTurns.set(String(payload.response.metadata.client_gen), {
                turnId,
                regexIntent,
                rounds: 0,
                // For the location guard (this request vs earlier ones)
                callerText: trimmed,
                earlierCallerTexts: callerTexts.slice(0, -1),
              });
              openaiWs.send(JSON.stringify(payload));
              return;
            }

            // Last turn asked "Which city?" for the time — a bare place name answers it
            const awaitingTimeCity = Boolean(sessionRef?.awaitingTimeCity);
            if (sessionRef) sessionRef.awaitingTimeCity = false;
            // Last turn asked for a route end or a hotel / restaurant city (lasts one turn)
            const awaiting = sessionRef?.awaiting || null;
            if (sessionRef) sessionRef.awaiting = null;
            let intent = resolveIntent(trimmed);
            if (awaitingTimeCity && intent === "chat" && timeService?.resolvePlace(trimmed)) {
              intent = "time";
            }
            // Travel dates said this turn ("next Monday", "Monday to Friday next week", "in December")
            const dates = parseTravelDates(trimmed);
            const hasDates = Boolean(dates.departDate || dates.departMonth || dates.window);
            if (awaiting && intent === "chat") {
              if (awaiting.kind === "fare") {
                const r = completeRoute(trimmed, awaiting);
                if (r.origin !== awaiting.origin || r.destination !== awaiting.destination || hasDates) intent = "travel_price";
              } else if (extractLocation(trimmed) || shortPlaceReply(trimmed)) {
                intent = awaiting.kind;
              }
            }
            // "Next week." right after a fare answer: price that route for those dates
            if (
              intent === "chat" &&
              hasDates &&
              wordCount(trimmed) <= 8 &&
              sessionRef?.lastFareTurn === sessionRef?.callerTurns - 1
            ) {
              intent = "travel_price";
            }
            logger.info({ callSid, intent }, "Intent resolved");
            metrics.setRoute(turnId, "fast_path", intent);

            // Weather-only place memory — do not leak Colombia hint onto hotel/Miami asks
            if (intent === "weather") {
              const mentioned = findCountryInText(trimmed);
              if (mentioned?.code) {
                if (sessionRef) {
                  sessionRef.placeHint = {
                    country: mentioned.code,
                    name: mentioned.name,
                  };
                }
              }
            }

            if (
              intent === "weather" &&
              (weatherService?.enabled || openMeteoService?.enabled)
            ) {
              const sessionRef = callStore.get(callSid);
              const places = extractCityAndCountry(trimmed, sessionRef?.placeHint);
              (async () => {
                try {
                  // All places at once; facts keep the spoken order
                  const results = await fetchWeatherForPlaces(places, (place) =>
                    timed("weather", () =>
                      fetchWeatherForPlace(place, openMeteoService, weatherService)
                    )
                  );
                  const facts = [];
                  // A rain / forecast question also gets today's (or tomorrow's) forecast
                  const forecast = weatherForecastDay(trimmed);
                  // Follow-ups without a city ("will it rain?") stay on the one city just asked about
                  const only = places.length === 1 && results[0] && !results[0].error ? results[0] : null;
                  if (only && sessionRef) {
                    sessionRef.placeHint = { ...(sessionRef.placeHint || {}), country: only.country || places[0].country, city: places[0].city };
                  }
                  places.forEach((place, i) => {
                    facts.push(formatWeatherFact(results[i], { callerNumber: sessionRef?.callerNumber, forecast }));
                    logger.info(
                      { callSid, city: place.city, country: place.country, result: results[i] },
                      "Weather fast path"
                    );
                  });
                  const fact =
                    facts.length > 1
                      ? facts.join(" And ")
                      : facts[0] || "I couldn't get the weather right now.";
                  const hadError = facts.every(
                    (f) =>
                      /couldn't|not found|Please share|not configured|Could not/i.test(
                        f
                      )
                  );
                  // A forecast adds a sentence; 20 words would drop the rain chance
                  sendReply(fact, { multilingual: !hadError, maxWords: forecast && !hadError ? 40 : undefined });
                } catch (err) {
                  logger.error({ callSid, err: err.message }, "Weather fast path failed");
                  sendReply("I couldn't get the weather right now.", { multilingual: false });
                }
              })();
              return;
            }
            if (intent === "time" && timeService?.enabled) {
              const place = timeService.resolvePlace(trimmed);
              // Unknown or missing place: ask — never read out UTC as local time
              if (!place) {
                if (sessionRef) sessionRef.awaitingTimeCity = true;
                sendReply("Which city should I check the time for?", { multilingual: true });
                return;
              }
              const tz = place.timezone;
              (async () => {
                if (worldTimeService?.enabled) {
                  const r = await timed("world_time", () =>
                    worldTimeService.getTimeByTimezone(tz)
                  );
                  if (!r.error && r.datetime) {
                    sendReply(`It is ${new Date(r.datetime).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })} in ${place.label}.`, { multilingual: true });
                    return;
                  }
                }
                const { time } = timeService.getCurrentTime(tz);
                sendReply(`${time} in ${place.label}`, { multilingual: true });
              })();
              return;
            }
            if (intent === "news" && newsService?.enabled) {
              const topic = extractNewsQuery(trimmed);
              (async () => {
                const result = await timed("news", () => newsService.topHeadlines(topic));
                const fact = result.error
                  ? result.error
                  : `Top updates: ${result.articles.map((a) => `${a.title} from ${a.source}`).join(". ")}`;
                sendReply(fact, { multilingual: !result.error });
              })();
              return;
            }
            if (intent === "fx" && fxService?.enabled) {
              const iso = extractCurrencies(trimmed);
              const spoken = fxService.parsePairFromUtterance(trimmed);
              const base = iso.base || spoken.base;
              const quote = iso.quote || spoken.quote;
              (async () => {
                const result = await timed("fx", () => fxService.getRate(base, quote));
                const fact = result.error ? result.error : spokenRate(result);
                sendReply(fact, { multilingual: !result.error });
              })();
              return;
            }
            if (intent === "local_service" && placesService?.enabled) {
              (async () => {
                const result = await timed("places_text", () =>
                  placesService.searchText(trimmed.slice(0, 200))
                );
                const fact = result.error
                  ? result.error
                  : `Nearby options: ${result.places.map((p) => `${p.name}${p.address ? ", " + p.address : ""}`).join(". ")}`;
                sendReply(fact, { multilingual: !result.error });
              })();
              return;
            }
            if ((intent === "hotel" || intent === "food") && placesService?.enabled) {
              const kind = intent;
              const route = extractTravelRoute(trimmed);
              const trip = recentTrip(sessionRef);
              // "Flights and hotels from Bogotá to Miami": hotels at the destination, not the first city named
              let city =
                (kind === "hotel" && route.origin && route.destination && cityName(route.destination)) ||
                extractLocation(trimmed) ||
                (awaiting?.kind === kind && shortPlaceReply(trimmed)) ||
                // Same-topic follow-up ("$80 a night?") keeps the hotel city from the last few turns
                (kind === "hotel" && (trip?.hotelCity || (trip?.destination && cityName(trip.destination)))) ||
                "";
              if (!city) {
                if (sessionRef) sessionRef.awaiting = { kind };
                sendReply(
                  kind === "hotel" ? "Which city should I look up hotels in?" : "Which city should I look up restaurants in?",
                  { multilingual: true }
                );
                return;
              }
              const priceAsked = kind === "hotel" && isHotelPriceQuestion(trimmed);
              const withFare =
                kind === "hotel" && route.origin && route.destination && mentionsFlights(trimmed) && travelService?.enabled;
              // Stay dates / nights from this turn, else from the trip ("$80 a night?" keeps "three nights")
              const stay = hasDates || dates.nights ? dates : trip?.dates || null;
              if (kind === "hotel") {
                rememberTrip(sessionRef, { hotelCity: city, ...(withFare ? route : {}), dates: stay });
                if (withFare && sessionRef) sessionRef.lastFareTurn = sessionRef.callerTurns;
              }
              (async () => {
                const [fare, result] = await Promise.all([
                  withFare ? lookupFare(route.origin, route.destination, stay) : null,
                  kind === "hotel"
                    ? timed("places_hotels", () => placesService.searchHotels(city, hotelTier(trimmed) || undefined))
                    : timed("places_food", () => placesService.searchFood(city)),
                ]);
                // Price asks (and trip asks) get a typical nightly range next to the real hotels
                if (priceAsked || fare) {
                  const langName = languageLabel(callStore.get(callSid)?.replyLanguage || "en");
                  sendModelTurn(
                    hotelPriceInstruction(langName, {
                      city,
                      places: result.error ? [] : result.places,
                      fareFact: fare && !fare.error ? formatFareFact(fare) : "",
                      question: trimmed,
                      nights: stay?.nights || null,
                      month: stay?.departMonth || null,
                      tier: hotelTier(trimmed),
                    }),
                    turnId,
                    "Hotel price turn"
                  );
                  return;
                }
                sendReply(formatPlacesFact(result, { kind, city }), {
                  multilingual: !result.error,
                  maxWords: result.error ? undefined : 50,
                });
              })();
              return;
            }
            if (intent === "travel_price" && travelService?.enabled) {
              let { origin, destination } = completeRoute(trimmed, awaiting?.kind === "fare" ? awaiting : null);
              // "Average price?" right after the trip came up: same route, don't ask again
              const trip = recentTrip(sessionRef);
              if (!origin && !destination && trip?.origin && trip?.destination) {
                ({ origin, destination } = trip);
              }
              // Dates from this turn, else from the pending question or the same trip
              const sameTrip = trip && trip.origin === origin && trip.destination === destination;
              const fareDates = hasDates ? dates : awaiting?.dates || (sameTrip ? trip.dates : null) || null;
              logger.info(
                {
                  callSid,
                  origin: origin || null,
                  destination: destination || null,
                  travelIntentMatched: true,
                },
                "Travel fast path triggered"
              );
              if (!origin || !destination) {
                if (sessionRef) sessionRef.awaiting = { kind: "fare", origin, destination, dates: fareDates };
                sendReply(
                  origin
                    ? `Sure. And where are you flying to from ${cityName(origin)}?`
                    : destination
                      ? `Sure. Which city are you flying from to ${cityName(destination)}?`
                      : "Sure. Which city are you flying from, and where to?",
                  { multilingual: true }
                );
                return;
              }
              rememberTrip(sessionRef, { origin, destination, dates: fareDates });
              if (sessionRef) sessionRef.lastFareTurn = sessionRef.callerTurns;
              (async () => {
                const result = await lookupFare(origin, destination, fareDates);
                sendReply(formatFareFact(result), { multilingual: !result.error, maxWords: result.error ? undefined : 50 });
              })();
              return;
            }
            if (intent === "sports" && sportsService?.enabled) {
              const sportKey = sportsService.detectSport(trimmed);
              (async () => {
                try {
                  const result = await timed("sports", () =>
                    sportsService.getLiveScores(sportKey)
                  );
                  const fact = result.error
                    ? result.error
                    : result.message
                      ? result.message
                      : `${result.sport || "Live"}: ${result.matches.join(". ")}`;
                  logger.info({ callSid, sportKey, fact }, "Sports fast path");
                  sendReply(fact, { multilingual: !result.error });
                } catch (err) {
                  logger.error({ callSid, err: err.message }, "Sports fast path failed");
                  sendReply("I couldn't get live scores right now.", { multilingual: false });
                }
              })();
              return;
            }
            if (intent === "flight_status" && flightsService?.enabled) {
              const flightIata = extractFlightNumber(trimmed);
              // No number: ask, like the time handler — a word-for-word error reads as a refusal
              if (!flightIata) {
                sendReply("Which flight number should I check?", { multilingual: true });
                return;
              }
              (async () => {
                try {
                  const result = await timed("flight_status", () =>
                    flightsService.getFlightStatus(flightIata || "")
                  );
                  const fact = result.error ? result.error : result.message;
                  logger.info({ callSid, flightIata, fact }, "Flight fast path");
                  sendReply(fact, { multilingual: !result.error });
                } catch (err) {
                  logger.error({ callSid, err: err.message }, "Flight fast path failed");
                  sendReply("I couldn't get that flight status.", { multilingual: false });
                }
              })();
              return;
            }
            if (intent === "crypto" && stocksService?.enabled) {
              (async () => {
                try {
                  const result = await timed("crypto", () =>
                    stocksService.getCryptoQuote(trimmed)
                  );
                  const fact = result.error ? result.error : result.message;
                  logger.info({ callSid, fact }, "Crypto fast path");
                  sendReply(fact, { multilingual: !result.error });
                } catch (err) {
                  logger.error({ callSid, err: err.message }, "Crypto fast path failed");
                  sendReply(
                    "I couldn't fetch that crypto price right now. Please try again shortly.",
                    { multilingual: false }
                  );
                }
              })();
              return;
            }
            if (intent === "rates" && stocksService?.enabled) {
              (async () => {
                try {
                  const result = await timed("rates", () => stocksService.getUsInterestRate());
                  const fact = result.error ? result.error : result.message;
                  logger.info({ callSid, fact }, "Rates fast path");
                  sendReply(fact, { multilingual: !result.error });
                } catch (err) {
                  logger.error({ callSid, err: err.message }, "Rates fast path failed");
                  sendReply(
                    "I couldn't fetch live U S rates right now. Please check the Federal Reserve website or your bank.",
                    { multilingual: false }
                  );
                }
              })();
              return;
            }
            if (intent === "stocks" && stocksService?.enabled) {
              (async () => {
                try {
                  const result = await timed("stocks", () => stocksService.getQuote(trimmed));
                  const fact = result.error ? result.error : result.message;
                  logger.info({ callSid, fact }, "Stocks fast path");
                  sendReply(fact, { multilingual: !result.error });
                } catch (err) {
                  logger.error({ callSid, err: err.message }, "Stocks fast path failed");
                  sendReply("I couldn't get that stock price.", { multilingual: false });
                }
              })();
              return;
            }
            metrics.setRoute(turnId, "chat");
            if (openaiWs?.readyState === WebSocket.OPEN) {
              if (responseInProgress) {
                logger.info({ callSid }, "Skip general reply: response already in progress");
                metrics.finishWithoutReply(turnId, "skipped_busy");
                return;
              }
              const langName = languageLabel(
                callStore.get(callSid)?.replyLanguage || "en"
              );
              openaiWs.send(
                JSON.stringify(
                  createResponsePayload(
                    {
                      instructions: `Reply in ${langName} only. About 15–25 words. Answer from general knowledge when you can (like ChatGPT). Never state live or changing facts (whether a place or airport is open today, current prices, schedules, today's events): say you can't check that live right now and suggest where to check. If you cannot complete an action (browse, open links, transfer), still help with a clear website or search tip plus what you can do next. Answer only their latest request. Don't say you'll check or look anything up, and don't ask them to hold on: nothing runs after this reply.${SENSITIVE_TURN_NOTE}${billingTurnNote(callStore.get(callSid))}`,
                      tools: [],
                    },
                    turnId
                  )
                )
              );
            }
          }

          if (ev.type === "input_audio_buffer.speech_started") {
            userSpeechSeq += 1;
            callerSpeaking = true;
            speechStartedAt = Date.now();
            metrics.onSpeechStarted(ev.item_id);
            interruptAgentPlayback();
          }

          if (ev.type === "input_audio_buffer.speech_stopped") {
            callerSpeaking = false;
            lastSpeechStoppedAt = Date.now();
            // Caller speech sent to transcription (priced per minute)
            if (speechStartedAt) usage.speechSeconds += (lastSpeechStoppedAt - speechStartedAt) / 1000;
            speechStartedAt = 0;
            metrics.onSpeechStopped(ev.item_id);
          }

          if (ev.type === "input_audio_buffer.committed") {
            metrics.onCommitted(ev.item_id);
          }

          if (ev.type === "conversation.item.input_audio_transcription.completed" && ev.transcript) {
            const turnId = ev.item_id || `noitem:${Date.now()}`;
            metrics.onTranscript(turnId, ev.transcript);
            handleUserTranscript(ev.transcript, turnId);
          }

          if (ev.type === "response.created") {
            const createdId = responseIdFromEvent(ev);
            metrics.onResponseCreated(createdId, ev.response?.metadata?.client_gen);
            const createdGen = Number(ev.response?.metadata?.client_gen);
            const genMismatch =
              Number.isFinite(createdGen) && createdGen !== expectedGeneration;
            const cancelStale =
              pendingCreatedCancels > 0 || genMismatch;
            if (cancelStale) {
              if (pendingCreatedCancels > 0) pendingCreatedCancels -= 1;
              if (createdId && openaiWs?.readyState === WebSocket.OPEN) {
                openaiWs.send(JSON.stringify({ type: "response.cancel" }));
              }
              if (twilioWs?.readyState === WebSocket.OPEN && streamSid) {
                twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
              }
            } else if (responseInProgress && createdId) {
              activeResponseId = createdId;
            }
          }

          if (
            ev.type === "response.done" ||
            ev.type === "response.cancelled" ||
            ev.type === "response.failed"
          ) {
            const endedId = responseIdFromEvent(ev);
            const endedTurnId = metrics.turnForResponse(endedId);
            if (ev.type === "response.done") addResponseUsage(usage, ev.response?.usage);
            // The interrupted reply has ended: the queued one can go now
            if (retryAfterActiveEnds && endedId !== activeResponseId) setImmediate(sendQueuedReply);
            metrics.onResponseEnded(
              endedId,
              ev.type === "response.done" ? ev.response?.status || "done" : ev.type.slice(9),
              {
                functionCall: (ev.response?.output || []).some(
                  (o) => o?.type === "function_call"
                ),
              }
            );
            let isActiveCompletion = false;
            if (activeResponseId != null) {
              if (endedId === activeResponseId) {
                isActiveCompletion = true;
                activeResponseId = null;
                responseInProgress = false;
              }
              // else: stale terminal event for an older response — do not reset newer state
            } else if (!endedId && responseInProgress) {
              // Create sent but no id yet; terminal without id — clear busy to avoid stuck lock
              responseInProgress = false;
            }
            // else: activeResponseId null with endedId set → stale after interrupt; ignore

            if (toolsMode && isActiveCompletion && ev.type === "response.done") {
              handleToolsResponse(ev.response, endedTurnId);
            }

            // Regex mode only: legacy single weather tool
            if (
              !toolsMode &&
              isActiveCompletion &&
              ev.type === "response.done" &&
              (weatherService?.enabled || openMeteoService?.enabled)
            ) {
              const out = ev.response?.output?.[0];
              if (out?.type === "function_call" && out.name === "get_weather" && out.call_id) {
                let args = {};
                try {
                  args = JSON.parse(out.arguments || "{}");
                } catch (_) {}
                const sessionRef = callStore.get(callSid);
                let city = args.city || "unknown";
                let country =
                  normalizeCountryCode(args.country) ||
                  sessionRef?.placeHint?.country ||
                  undefined;

                // Country-only tool call
                const cityAsCountry = normalizeCountryCode(city);
                if (cityAsCountry) {
                  country = country || cityAsCountry;
                  city = defaultCityForCountry(cityAsCountry) || city;
                }
                if ((!city || /^unknown$/i.test(city)) && country) {
                  city = defaultCityForCountry(country) || city;
                }

                (async () => {
                  try {
                    const result = await metrics.time(endedTurnId, "weather_tool", () =>
                      fetchWeatherForPlace({ city, country }, openMeteoService, weatherService)
                    );
                    const output = JSON.stringify(result);
                    openaiWs.send(
                      JSON.stringify({
                        type: "conversation.item.create",
                        item: {
                          type: "function_call_output",
                          call_id: out.call_id,
                          output,
                        },
                      })
                    );
                    openaiWs.send(JSON.stringify(createResponsePayload({}, endedTurnId)));
                    logger.info({ callSid, city, country, result }, "Weather tool result");
                  } catch (err) {
                    logger.error({ callSid, err: err.message }, "Weather tool failed");
                    openaiWs.send(
                      JSON.stringify({
                        type: "conversation.item.create",
                        item: {
                          type: "function_call_output",
                          call_id: out.call_id,
                          output: JSON.stringify({ error: "Could not get weather." }),
                        },
                      })
                    );
                    openaiWs.send(JSON.stringify(createResponsePayload({}, endedTurnId)));
                  }
                })();
              }
            }
          }

          if (ev.type === "response.output_audio.delta" && ev.delta) {
            if (!activeResponseId || ev.response_id !== activeResponseId) {
              // drop stale / cancelled response audio
            } else {
              responseInProgress = true;
              try {
                // μ-law session: OpenAI's audio is already Twilio's format
                const mulawBase64 = passThroughAudio ? ev.delta : openAIToTwilio(ev.delta);
                twilioWs.send(
                  JSON.stringify({
                    event: "media",
                    streamSid,
                    media: { payload: mulawBase64 },
                  })
                );
                metrics.onAudioSent(ev.response_id);
              } catch (err) {
                logger.warn({ callSid, err: err.message }, "Audio convert failed");
              }
            }
          }

          if (ev.type === "response.output_audio_transcript.done" && ev.transcript) {
            transcriptLines.push(`AI: ${ev.transcript}`);
            lastAiReply = { text: ev.transcript, at: Date.now() };
            callStore.addAssistantMessage(callSid, ev.transcript);
            const aiLog = ev.transcript.length > 100 ? ev.transcript.slice(0, 100) + "…" : ev.transcript;
            logger.info({ callSid, reply: ev.transcript, role: "assistant" }, `AI: ${aiLog}`);
          }
        });

        openaiWs.on("close", (code) => {
          logger.info({ callSid, code }, "OpenAI Realtime closed");
          // Closed by OpenAI or the network while the caller is still on the line: no more replies
          // can come, so apologise and hang up rather than leave them in silence
          if (callClosed || callStore.get(callSid)?.callEnding || !twilioClient || !callSid) return;
          logger.warn({ callSid, code }, "OpenAI connection lost mid-call: ending call politely");
          const spanish = callStore.get(callSid)?.replyLanguage === "es";
          const twiml = spanish
            ? '<Response><Say language="es-US">Lo siento, perdí la conexión. Por favor, llama de nuevo en un momento.</Say><Hangup/></Response>'
            : "<Response><Say>Sorry, I lost my connection. Please call again in a moment.</Say><Hangup/></Response>";
          Promise.resolve()
            .then(() => twilioClient.calls(callSid).update({ twiml }))
            .catch((err) => logger.error({ callSid, err: err.message }, "Could not end call after lost connection"));
        });

        openaiWs.on("error", (err) => {
          logger.error({ callSid, err: err.message }, "OpenAI Realtime error");
        });

        return;
      }

      if (msg.event === "media" && msg.media?.track === "inbound" && openaiWs?.readyState === WebSocket.OPEN) {
        const payload = msg.media?.payload;
        if (!payload) return;
        try {
          openaiWs.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: passThroughAudio ? payload : twilioToOpenAI(payload),
            })
          );
        } catch (err) {
          logger.warn({ callSid, err: err.message }, "Audio convert failed");
        }
        return;
      }

      if (msg.event === "stop") {
        logger.info({ callSid }, "Media stream stopped");
        const session = callStore.get(callSid);
        if (session) {
          session.transcriptLines = transcriptLines;
        }
        cleanup();
      }
    });

    twilioWs.on("close", cleanup);
  };
}

module.exports = createMediaStreamHandler;
