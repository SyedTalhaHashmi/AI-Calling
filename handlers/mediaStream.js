/**
 * Twilio Media Stream WebSocket handler.
 * Bridges Twilio (μ-law 8kHz) ↔ OpenAI Realtime API (PCM 24kHz).
 */
const WebSocket = require("ws");
const { twilioToOpenAI, openAIToTwilio } = require("../services/audioConvert");
const { SYSTEM_PROMPT } = require("../utils/callStore");

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";

// Short, clear, inviting greeting (first 5 seconds matter)
const GREETING = "Hi! This is Buddy from BuddyCallAI. You can ask me anything. What's on your mind today?";

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

function createMediaStreamHandler({ callStore, logger, openaiApiKey, weatherService }) {
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
          };
          if (weatherService && weatherService.enabled) {
            session.tools = [WEATHER_TOOL];
            session.tool_choice = "auto";
          }
          openaiWs.send(
            JSON.stringify({ type: "session.update", session })
          );
          // Trigger initial greeting (short, clear, inviting)
          openaiWs.send(
            JSON.stringify({
              type: "response.create",
              response: {
                instructions: `Say exactly: ${GREETING}`,
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
              logger.info({ callSid, transcript: text }, "User said");

              if (weatherService?.enabled && isWeatherQuestion(text)) {
                const { city, country } = extractCityAndCountry(text);
                (async () => {
                  try {
                    const result = await weatherService.getByCity(city, country);
                    const reply = result.error
                      ? "I couldn't get the weather for that place."
                      : `It's ${result.temp} degrees and ${result.description} in ${result.city}.`;
                    openaiWs.send(
                      JSON.stringify({
                        type: "response.create",
                        response: { instructions: `Say exactly: ${reply}` },
                      })
                    );
                    callStore.addAssistantMessage(callSid, reply);
                    transcriptLines.push(`AI: ${reply}`);
                    logger.info({ callSid, city, reply }, "Weather fast path");
                  } catch (err) {
                    logger.error({ callSid, err: err.message }, "Weather fast path failed");
                    const fallback = "I couldn't get the weather right now.";
                    openaiWs.send(
                      JSON.stringify({
                        type: "response.create",
                        response: { instructions: `Say exactly: ${fallback}` },
                      })
                    );
                    callStore.addAssistantMessage(callSid, fallback);
                    transcriptLines.push(`AI: ${fallback}`);
                  }
                })();
                return;
              }
            }
          }

          if (ev.type === "response.output_audio_transcript.done" && ev.transcript) {
            transcriptLines.push(`AI: ${ev.transcript}`);
            callStore.addAssistantMessage(callSid, ev.transcript);
            logger.info({ callSid, reply: ev.transcript }, "AI said");
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
                  openaiWs.send(JSON.stringify({ type: "response.create" }));
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
                  openaiWs.send(JSON.stringify({ type: "response.create" }));
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
