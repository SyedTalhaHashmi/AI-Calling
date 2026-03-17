/**
 * Twilio Media Stream WebSocket handler.
 * Bridges Twilio (μ-law 8kHz) ↔ OpenAI Realtime API (PCM 24kHz).
 */
const WebSocket = require("ws");
const { twilioToOpenAI, openAIToTwilio } = require("../services/audioConvert");
const { SYSTEM_PROMPT } = require("../utils/callStore");

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";

// Short, warm greeting — then stop and listen (no long intros)
const GREETING = "Hi! I'm Buddy, your AI friend. Ask me anything you want.";
// Warm, friendly female voice (coral); alternatives: shimmer, sage
const VOICE = "coral";

const WEATHER_TOOL = {
  type: "function",
  name: "get_weather",
  description: "Get current weather for a city. Use whenever the user asks about weather, temperature, or conditions. Always call this—never guess weather.",
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "City name, e.g. London, Miami, Karachi, Paris",
      },
      country: {
        type: "string",
        description: "Optional country or state to disambiguate, e.g. France, California",
      },
    },
    required: ["city"],
  },
};

function isWeatherQuestion(text) {
  const t = (text || "").toLowerCase();
  const keywords = ["weather", "temperature", "forecast", "rain", "snow", "sunny", "hot", "cold", "degrees", "how warm", "how cold"];
  return keywords.some((k) => t.includes(k));
}

function extractCityAndCountry(text) {
  const t = (text || "").trim();
  const inMatch = t.match(/\b(?:in|at|for)\s+([a-zA-Z\s]+?)(?:\s*,\s*([a-zA-Z\s]+))?(?:\?|\.|$)/i);
  if (inMatch) {
    const city = inMatch[1].trim().replace(/\s+/g, " ");
    const country = inMatch[2]?.trim().replace(/\s+/g, " ");
    return { city: city || "unknown", country: country || undefined };
  }
  return { city: "unknown", country: undefined };
}

function isTimeQuestion(text) {
  const t = (text || "").toLowerCase();
  return /\b(time|what time|current time|what's the time|timezone|what time is it)\b/i.test(t) || /time\s+in\s+/i.test(t);
}

function isSportsQuestion(text) {
  const t = (text || "").toLowerCase();
  const keywords = ["score", "scores", "game", "match", "sports", "who won", "basketball", "football", "soccer", "nba", "nfl", "mlb", "live match", "live game"];
  return keywords.some((k) => t.includes(k));
}

function isFlightQuestion(text) {
  const t = (text || "").toLowerCase();
  return /\b(flight|flight status|is flight|where is flight|flight number)\b/i.test(t) || /flight\s+[a-z]{2}\s*\d+/i.test(t);
}

function extractFlightNumber(text) {
  const match = (text || "").match(/\b([A-Za-z]{2})\s*(\d{2,4})\b/);
  if (match) return (match[1] + match[2]).toUpperCase();
  const fallback = (text || "").match(/([A-Za-z]{2}\d{2,4})/);
  return fallback ? fallback[1].toUpperCase() : null;
}

function isStockQuestion(text) {
  const t = (text || "").toLowerCase();
  return /\b(stock|stocks|share price|share price of|price of|how much is|ticker|quote)\b/i.test(t) || /\b(AAPL|GOOGL|MSFT|AMZN|META|TSLA|NVDA)\b/i.test(t);
}

function createMediaStreamHandler({ callStore, logger, openaiApiKey, weatherService, timeService, sportsService, flightsService, stocksService }) {
  return function handleMediaStream(twilioWs, req) {
    let callSid = null;
    let streamSid = null;
    let openaiWs = null;
    let transcriptLines = [];

    const cleanup = () => {
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

        // Connect to OpenAI Realtime
        openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
          headers: {
            Authorization: `Bearer ${openaiApiKey}`,
          },
        });

        openaiWs.on("open", () => {
          logger.info({ callSid }, "OpenAI Realtime connected");
          const session = {
            type: "realtime",
            instructions: SYSTEM_PROMPT,
            audio: {
              input: {
                transcription: { model: "whisper-1" },
              },
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
            JSON.stringify({
              type: "response.create",
              response: {
                instructions: `Say exactly: ${GREETING}`,
                audio: { voice: VOICE },
              },
            })
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
            logger.error({ callSid, error: ev.error }, "OpenAI Realtime error");
            return;
          }

          if (ev.type === "response.output_audio.delta" && ev.delta) {
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

          if (ev.type === "conversation.item.added" && ev.item?.role === "user") {
            const content = ev.item?.content?.[0];
            if (content?.type === "input_audio_transcription" && content?.transcript) {
              const text = content.transcript;
              transcriptLines.push(`Caller: ${text}`);
              callStore.addUserMessage(callSid, text);
              const userLog = text.length > 100 ? text.slice(0, 100) + "…" : text;
              logger.info({ callSid, transcript: text, role: "user" }, `USER: ${userLog}`);

              if (weatherService?.enabled && isWeatherQuestion(text)) {
                const { city, country } = extractCityAndCountry(text);
                (async () => {
                  try {
                    const result = await weatherService.getByCity(city, country);
                    const fact = result.error
                      ? result.error
                      : `${result.temp} degrees and ${result.description} in ${result.city}`;
                    logger.info({ callSid, city, fact }, "Weather fast path");
                    sendReply(fact, { multilingual: !result.error });
                  } catch (err) {
                    logger.error({ callSid, err: err.message }, "Weather fast path failed");
                    sendReply("I couldn't get the weather right now.", { multilingual: false });
                  }
                })();
                return;
              }

              if (timeService?.enabled && isTimeQuestion(text)) {
                const tz = timeService.resolveTimezone(text);
                const { time, timezone } = timeService.getCurrentTime(tz || undefined);
                const fact = tz ? `${time} in ${timezone.replace(/_/g, " ")}` : time;
                sendReply(fact, { multilingual: true });
                return;
              }

              if (sportsService?.enabled && isSportsQuestion(text)) {
                const sportKey = sportsService.detectSport(text);
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

              if (flightsService?.enabled && isFlightQuestion(text)) {
                const flightIata = extractFlightNumber(text);
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

              if (stocksService?.enabled && isStockQuestion(text)) {
                (async () => {
                  try {
                    const result = await stocksService.getQuote(text);
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

              function sendReply(reply, opts = {}) {
                const instruction =
                  opts.multilingual
                    ? `Say the following in one short sentence using the caller's language (15 to 20 words max): ${reply}.`
                    : `Say exactly: ${reply}`;
                openaiWs.send(
                  JSON.stringify({
                    type: "response.create",
                    response: {
                      instructions: instruction,
                      audio: { voice: VOICE },
                    },
                  })
                );
                callStore.addAssistantMessage(callSid, reply);
                transcriptLines.push(`AI: ${reply}`);
                const aiReplyLog = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
                logger.info({ callSid, reply, role: "assistant" }, `AI: ${aiReplyLog}`);
              }
            }
          }

          if (ev.type === "response.output_audio_transcript.done" && ev.transcript) {
            transcriptLines.push(`AI: ${ev.transcript}`);
            callStore.addAssistantMessage(callSid, ev.transcript);
            const aiLog = ev.transcript.length > 100 ? ev.transcript.slice(0, 100) + "…" : ev.transcript;
            logger.info({ callSid, reply: ev.transcript, role: "assistant" }, `AI: ${aiLog}`);
          }

          if (ev.type === "response.done" && weatherService?.enabled) {
            const out = ev.response?.output?.[0];
            if (out?.type === "function_call" && out.name === "get_weather" && out.call_id) {
              let args = {};
              try {
                args = JSON.parse(out.arguments || "{}");
              } catch (_) {}
              const city = args.city || "unknown";
              const country = args.country || undefined;
              (async () => {
                try {
                  const result = await weatherService.getByCity(city, country);
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
                  openaiWs.send(
                    JSON.stringify({
                      type: "response.create",
                      response: { audio: { voice: VOICE } },
                    })
                  );
                  logger.info({ callSid, city, result }, "Weather tool result");
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
                  openaiWs.send(
                    JSON.stringify({
                      type: "response.create",
                      response: { audio: { voice: VOICE } },
                    })
                  );
                }
              })();
            }
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
