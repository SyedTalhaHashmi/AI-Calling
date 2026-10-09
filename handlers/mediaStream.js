/**
 * Twilio Media Stream WebSocket handler.
 * Bridges Twilio (μ-law 8kHz) ↔ OpenAI Realtime API (PCM 24kHz).
 */
const WebSocket = require("ws");
const { twilioToOpenAI, openAIToTwilio } = require("../services/audioConvert");
const { SYSTEM_PROMPT } = require("../utils/callStore");
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
} = require("../utils/intentRouter");
const {
  updateReplyLanguage,
  languageInstruction,
  languageLabel,
} = require("../utils/replyLanguage");
const {
  isBillingQuestion,
  billingReply,
  billingInstruction,
} = require("../utils/billingReply");

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";

// Short, warm greeting — then stop and listen (no long intros)
const GREETING = "Hi! I'm Buddy, your AI friend. Ask me anything you want.";
// Friendly voice: marin (female); alternatives: coral, shimmer, sage
const VOICE = "marin";

function buildRealtimeInstructions(session) {
  return [
    SYSTEM_PROMPT,
    "",
    "## Active call rules (authoritative — follow these)",
    languageInstruction(session),
    billingInstruction(session),
  ].join("\n");
}

/** Realtime input: denoise, then semantic turn detection (ChatGPT-like; waits on fillers / incomplete thoughts). */
const REALTIME_INPUT_AUDIO = {
  noise_reduction: { type: "far_field" },
  transcription: { model: "whisper-1" },
  turn_detection: {
    type: "semantic_vad",
    eagerness: "medium",
    interrupt_response: true,
    create_response: false,
  },
};

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
  if (/^(you|uh+|u[mh]+|ah+|hmm+|mm+|mhm|eh+)$/i.test(t)) return true;
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

function formatWeatherFact(result) {
  if (result.error) return result.error;
  const where = [result.city, result.country].filter(Boolean).join(", ");
  const humidity =
    result.humidity != null ? `, humidity ${result.humidity}%` : "";
  return `${result.temp} degrees and ${result.description} in ${where}${humidity}`;
}

async function fetchWeatherForPlace(place, openMeteoService, weatherService) {
  const city = place.city;
  const country = place.country;
  if (openMeteoService?.enabled) {
    return openMeteoService.getByCity(city, country);
  }
  if (weatherService?.enabled) {
    return weatherService.getByCity(city, country);
  }
  return { error: "Weather not configured." };
}

const TIME_UP_INSTRUCTION =
  "Say exactly: Your time for this call is up. To keep talking, subscribe or add minutes at buddycallai dot com. Goodbye.";

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
  twilioClient,
}) {
  return function handleMediaStream(twilioWs, req) {
    let callSid = null;
    let streamSid = null;
    let openaiWs = null;
    let transcriptLines = [];
    let lastUserTranscript = "";
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

    /** Call immediately before each response.create; returns generation for metadata. */
    function markResponseCreateSent() {
      responseGeneration += 1;
      expectedGeneration = responseGeneration;
      responseInProgress = true;
      return expectedGeneration;
    }

    function createResponsePayload(responseFields) {
      const gen = markResponseCreateSent();
      return {
        type: "response.create",
        response: {
          ...responseFields,
          metadata: { ...(responseFields.metadata || {}), client_gen: String(gen) },
        },
      };
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

    const cleanup = () => {
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
        callStore.getOrCreate(callSid);
        callStore.addAssistantMessage(callSid, GREETING);
        transcriptLines.push(`AI: ${GREETING}`);
        logger.info({ callSid, streamSid }, "Media stream started");

        const bill = callStore.get(callSid);
        const maxSec =
          bill?.maxBillableSeconds != null &&
          Number.isFinite(Number(bill.maxBillableSeconds))
            ? Math.floor(Number(bill.maxBillableSeconds))
            : null;

        if (maxSec != null && maxSec > 0 && twilioClient) {
          let elapsed = 0;
          timeLimitTimer = setInterval(() => {
            elapsed += 1;
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
                      createResponsePayload({
                        instructions: TIME_UP_INSTRUCTION,
                        tools: [],
                      })
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
        openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
          headers: {
            Authorization: `Bearer ${openaiApiKey}`,
          },
        });

        openaiWs.on("open", () => {
          logger.info({ callSid }, "OpenAI Realtime connected");
          const billSession = callStore.get(callSid);
          if (billSession && !billSession.replyLanguage) {
            billSession.replyLanguage = "en";
          }
          const session = {
            type: "realtime",
            instructions: buildRealtimeInstructions(billSession),
            audio: {
              input: REALTIME_INPUT_AUDIO,
              output: {
                voice: VOICE,
              },
            },
          };
          if (weatherService && weatherService.enabled) {
            session.tools = [WEATHER_TOOL];
            session.tool_choice = "auto";
          }
          openaiWs.send(
            JSON.stringify({ type: "session.update", session })
          );
          // Say greeting once, then stop and listen
          openaiWs.send(
            JSON.stringify(
              createResponsePayload({
                instructions: `Say exactly: ${GREETING}`,
                tools: [],
              })
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
            logger.error({ callSid, error: ev.error }, "OpenAI Realtime error");
            return;
          }

          function syncSessionInstructions() {
            if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
            const sess = callStore.get(callSid);
            const payload = {
              type: "realtime",
              instructions: buildRealtimeInstructions(sess),
            };
            if (weatherService && weatherService.enabled) {
              payload.tools = [WEATHER_TOOL];
              payload.tool_choice = "auto";
            }
            openaiWs.send(
              JSON.stringify({ type: "session.update", session: payload })
            );
          }

          function sendReply(reply, opts = {}) {
            if (responseInProgress) {
              logger.info({ callSid }, "Skip fast-path: response already in progress");
              return;
            }
            const sess = callStore.get(callSid);
            const langName = languageLabel(sess?.replyLanguage || "en");
            const instruction =
              opts.multilingual !== false
                ? `Say the following in ${langName} only, one short sentence (15 to 20 words max): ${reply}.`
                : `Say exactly: ${reply}`;
            // No tools on fast-path replies — prevents double weather/hotel answers
            openaiWs.send(
              JSON.stringify(
                createResponsePayload({ instructions: instruction, tools: [] })
              )
            );
            callStore.addAssistantMessage(callSid, reply);
            transcriptLines.push(`AI: ${reply}`);
            const aiReplyLog = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
            logger.info({ callSid, reply, role: "assistant" }, `AI: ${aiReplyLog}`);
          }

          function handleUserTranscript(text) {
            const trimmed = (text != null && text !== "" ? String(text).trim() : "");
            if (!trimmed) return;
            const userLog = trimmed.length > 100 ? trimmed.slice(0, 100) + "…" : trimmed;
            logger.info({ callSid, transcript: trimmed, role: "user" }, `USER: ${userLog}`);
            if (trimmed === lastUserTranscript) return;
            lastUserTranscript = trimmed;
            transcriptLines.push(`Caller: ${trimmed}`);
            callStore.addUserMessage(callSid, trimmed);

            const sessionRef = callStore.get(callSid);
            if (sessionRef?.callEnding) {
              logger.info({ callSid }, "Skip turn: call ending (time limit)");
              return;
            }

            interruptAgentPlayback();

            if (shouldDeferUserTurn(trimmed)) {
              logger.info({ callSid, transcript: trimmed }, "Skip turn: user holding floor");
              return;
            }

            const langUpdate = updateReplyLanguage(sessionRef, trimmed);
            if (langUpdate.changed) {
              logger.info(
                { callSid, replyLanguage: langUpdate.language },
                "Reply language updated"
              );
              syncSessionInstructions();
            }

            // Honest trial / plan answers — never invent unlimited free time
            if (isBillingQuestion(trimmed)) {
              const fact = billingReply(sessionRef);
              sendReply(fact, { multilingual: true });
              return;
            }

            const intent = resolveIntent(trimmed);
            logger.info({ callSid, intent }, "Intent resolved");

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
                  const facts = [];
                  for (const place of places) {
                    const result = await fetchWeatherForPlace(
                      place,
                      openMeteoService,
                      weatherService
                    );
                    facts.push(formatWeatherFact(result));
                    logger.info(
                      { callSid, city: place.city, country: place.country, result },
                      "Weather fast path"
                    );
                  }
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
                  sendReply(fact, { multilingual: !hadError });
                } catch (err) {
                  logger.error({ callSid, err: err.message }, "Weather fast path failed");
                  sendReply("I couldn't get the weather right now.", { multilingual: false });
                }
              })();
              return;
            }
            if (intent === "time" && timeService?.enabled) {
              const tz = timeService.resolveTimezone(trimmed);
              (async () => {
                if (tz && worldTimeService?.enabled) {
                  const r = await worldTimeService.getTimeByTimezone(tz);
                  if (!r.error && r.datetime) {
                    sendReply(`It is ${new Date(r.datetime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })} in ${tz.replace(/_/g, " ")}.`, { multilingual: true });
                    return;
                  }
                }
                const { time, timezone } = timeService.getCurrentTime(tz || undefined);
                const fact = tz ? `${time} in ${timezone.replace(/_/g, " ")}` : time;
                sendReply(fact, { multilingual: true });
              })();
              return;
            }
            if (intent === "news" && newsService?.enabled) {
              const topic = extractNewsQuery(trimmed);
              (async () => {
                const result = await newsService.topHeadlines(topic);
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
                const result = await fxService.getRate(base, quote);
                const fact = result.error
                  ? result.error
                  : `One ${result.base} equals ${result.rate.toFixed(4)} ${result.quote}.`;
                sendReply(fact, { multilingual: !result.error });
              })();
              return;
            }
            if (intent === "local_service" && placesService?.enabled) {
              (async () => {
                const result = await placesService.searchText(trimmed.slice(0, 200));
                const fact = result.error
                  ? result.error
                  : `Nearby options: ${result.places.map((p) => `${p.name}${p.address ? ", " + p.address : ""}`).join(". ")}`;
                sendReply(fact, { multilingual: !result.error });
              })();
              return;
            }
            if (intent === "hotel" && placesService?.enabled) {
              const location = extractLocation(trimmed);
              (async () => {
                const result = await placesService.searchHotels(location);
                const fact = result.error
                  ? result.error
                  : `Popular hotels: ${result.places.map((p) => `${p.name}, rated ${p.rating || "N A"}`).join(". ")}`;
                sendReply(fact, { multilingual: !result.error });
              })();
              return;
            }
            if (intent === "food" && placesService?.enabled) {
              const location = extractLocation(trimmed);
              (async () => {
                const result = await placesService.searchFood(location);
                const fact = result.error
                  ? result.error
                  : `Popular food places: ${result.places.map((p) => `${p.name}, rated ${p.rating || "N A"}`).join(". ")}`;
                sendReply(fact, { multilingual: !result.error });
              })();
              return;
            }
            if (intent === "travel_price" && travelService?.enabled) {
              const { origin, destination } = extractTravelRoute(trimmed);
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
                sendReply(
                  "Sure — tell me the from city and to city, and I'll check recent fare prices.",
                  { multilingual: true }
                );
                return;
              }
              (async () => {
                const result = await travelService.cheapestRoute(origin, destination);
                const fact = result.error
                  ? result.error
                  : `Cheapest recent fare from ${result.origin} to ${result.destination} is about ${result.price} ${result.currency}.`;
                sendReply(fact, { multilingual: !result.error });
              })();
              return;
            }
            if (intent === "sports" && sportsService?.enabled) {
              const sportKey = sportsService.detectSport(trimmed);
              (async () => {
                try {
                  const result = await sportsService.getLiveScores(sportKey);
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
              (async () => {
                try {
                  const result = await flightsService.getFlightStatus(flightIata || "");
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
                  const result = await stocksService.getCryptoQuote(trimmed);
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
                  const result = await stocksService.getUsInterestRate();
                  const fact = result.error ? result.error : result.message;
                  logger.info({ callSid, fact }, "Rates fast path");
                  sendReply(fact, { multilingual: !result.error });
                } catch (err) {
                  logger.error({ callSid, err: err.message }, "Rates fast path failed");
                  sendReply(
                    "Many U S savings rates are often around four to five percent — check your bank for the exact APY.",
                    { multilingual: false }
                  );
                }
              })();
              return;
            }
            if (intent === "stocks" && stocksService?.enabled) {
              (async () => {
                try {
                  const result = await stocksService.getQuote(trimmed);
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
            if (openaiWs?.readyState === WebSocket.OPEN) {
              if (responseInProgress) {
                logger.info({ callSid }, "Skip general reply: response already in progress");
                return;
              }
              const langName = languageLabel(
                callStore.get(callSid)?.replyLanguage || "en"
              );
              openaiWs.send(
                JSON.stringify(
                  createResponsePayload({
                    instructions: `Reply in ${langName} only. About 15–25 words. Answer from general knowledge when you can (like ChatGPT). If you cannot complete an action (browse, open links, transfer), still help with a clear website or search tip plus what you can do next. Answer only their latest request.`,
                    tools: [],
                  })
                )
              );
            }
          }

          if (ev.type === "input_audio_buffer.speech_started") {
            interruptAgentPlayback();
          }

          if (ev.type === "conversation.item.input_audio_transcription.completed" && ev.transcript) {
            handleUserTranscript(ev.transcript);
          }

          if (ev.type === "response.created") {
            const createdId = responseIdFromEvent(ev);
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

            if (
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
                    const result = await fetchWeatherForPlace(
                      { city, country },
                      openMeteoService,
                      weatherService
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
                    openaiWs.send(JSON.stringify(createResponsePayload({})));
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
                    openaiWs.send(JSON.stringify(createResponsePayload({})));
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
                const mulawBase64 = openAIToTwilio(ev.delta);
                twilioWs.send(
                  JSON.stringify({
                    event: "media",
                    streamSid,
                    media: { payload: mulawBase64 },
                  })
                );
              } catch (err) {
                logger.warn({ callSid, err: err.message }, "Audio convert failed");
              }
            }
          }

          if (ev.type === "response.output_audio_transcript.done" && ev.transcript) {
            transcriptLines.push(`AI: ${ev.transcript}`);
            callStore.addAssistantMessage(callSid, ev.transcript);
            const aiLog = ev.transcript.length > 100 ? ev.transcript.slice(0, 100) + "…" : ev.transcript;
            logger.info({ callSid, reply: ev.transcript, role: "assistant" }, `AI: ${aiLog}`);
          }
        });

        openaiWs.on("close", () => {
          logger.info({ callSid }, "OpenAI Realtime closed");
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
          const pcm24Base64 = twilioToOpenAI(payload);
          openaiWs.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: pcm24Base64,
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
