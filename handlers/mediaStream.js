/**
 * Twilio Media Stream WebSocket handler.
 * Bridges Twilio (μ-law 8kHz) ↔ OpenAI Realtime API (PCM 24kHz).
 */
const WebSocket = require("ws");
const { twilioToOpenAI, openAIToTwilio } = require("../services/audioConvert");
const { SYSTEM_PROMPT } = require("../utils/callStore");
const {
  extractWeatherPlaces,
  findCountryInText,
  normalizeCountryCode,
  defaultCityForCountry,
} = require("../utils/placeResolve");

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";

// Short, warm greeting — then stop and listen (no long intros)
const GREETING = "Hi! I'm Buddy, your AI friend. Ask me anything you want.";
// Friendly voice: marin (female); alternatives: coral, shimmer, sage
const VOICE = "marin";

/** Realtime input: denoise before VAD, then stricter speech onset so noise rarely triggers barge-in. */
const REALTIME_INPUT_AUDIO = {
  noise_reduction: { type: "far_field" },
  transcription: { model: "whisper-1" },
  turn_detection: {
    type: "server_vad",
    threshold: 0.72,
    prefix_padding_ms: 300,
    silence_duration_ms: 600,
    interrupt_response: true,
    create_response: false,
  },
};

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

function isWeatherQuestion(text) {
  const t = (text || "").toLowerCase();
  const keywords = [
    "weather",
    "temperature",
    "forecast",
    "rain",
    "snow",
    "sunny",
    "hot",
    "cold",
    "degrees",
    "how warm",
    "how cold",
    "clima",
    "tiempo",
    "temperatura",
    "pronóstico",
    "pronostico",
    "mausam",
    "موسم",
  ];
  return keywords.some((k) => t.includes(k));
}

function extractCityAndCountry(text, placeHint) {
  const { places, countryHint } = extractWeatherPlaces(text);
  const hintCountry =
    normalizeCountryCode(placeHint?.country) ||
    normalizeCountryCode(countryHint) ||
    undefined;

  if (places.length) {
    return places.map((p) => ({
      city: p.city,
      country: normalizeCountryCode(p.country) || hintCountry || undefined,
    }));
  }

  if (hintCountry) {
    const def = defaultCityForCountry(hintCountry);
    if (def) return [{ city: def, country: hintCountry }];
  }

  return [{ city: "unknown", country: hintCountry }];
}

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

function isCryptoQuestion(text) {
  const t = (text || "").toLowerCase();
  return /\b(bitcoin|btc|ethereum|eth|solana|dogecoin|doge|crypto|cryptocurrency|ripple|xrp|cardano)\b/i.test(
    t
  );
}

function isRatesQuestion(text) {
  const t = (text || "").toLowerCase();
  return (
    /\b(interest rate|interest rates|fed funds|federal funds|treasury yield|treasury rate|bank rate|savings rate|apy)\b/i.test(
      t
    ) ||
    (/\brates?\b/i.test(t) &&
      /\b(u\.?s\.?|united states|fed|federal|bank|banks|savings)\b/i.test(t))
  );
}

function isStockQuestion(text) {
  if (isCryptoQuestion(text) || isRatesQuestion(text)) return false;
  const t = (text || "").toLowerCase();
  return (
    /\b(stock|stocks|share price|share price of|ticker|quote)\b/i.test(t) ||
    /\b(price of|how much is)\s+(apple|google|microsoft|amazon|meta|tesla|nvidia|netflix|[a-z]{1,5}\s+stock)\b/i.test(
      t
    ) ||
    /\b(AAPL|GOOGL|MSFT|AMZN|META|TSLA|NVDA|NFLX)\b/i.test(t)
  );
}

function isNewsQuestion(text) {
  return /\b(news|headline|headlines|latest news|breaking)\b/i.test(text || "");
}

function isExchangeQuestion(text) {
  const t = (text || "").toLowerCase();
  return (
    /\b(exchange rate|currency|convert|conversion|forex|usd|eur|inr|pkr|aed|gbp|cop|mxn)\b/i.test(t) ||
    /\b(peso|pesos|dollar|dollars|euro|euros|pound|pounds|yen|yuan|real|reais)\b/i.test(t)
  );
}

function isHotelQuestion(text) {
  return /\b(hotel|hotels|stay|accommodation|room price|hotel price)\b/i.test(text || "");
}

function isFoodQuestion(text) {
  return /\b(food|restaurant|restaurants|eat|dining|best food|best restaurant)\b/i.test(text || "");
}

function isTravelPriceQuestion(text) {
  const t = (text || "").toLowerCase();
  if (
    /\b(flight price|ticket price|cheapest flight|cheap flight|fare|ticket fare|plane ticket|airfare|flight cost|travel cost)\b/i.test(
      t
    ) ||
    /\b(average\s+price|price\s+to\s+travel|cost\s+to\s+(fly|travel)|how\s+much\s+(does\s+it\s+cost\s+)?to\s+(fly|travel))\b/i.test(
      t
    ) ||
    /\b(precio(s)?\s+del?\s+(vuelo|tiquete|boleto|pasaje)|cu[aá]nto\s+cuesta\s+un?\s+(tiquete|boleto|pasaje|vuelo))\b/i.test(
      t
    ) ||
    /\b(viajar|viaje)\s+de\s+.+\s+a\s+.+\b/i.test(t) ||
    /\b(tiquete|boleto|pasaje)(s)?\b/i.test(t) ||
    /\b(buy|book|get)\s+(a\s+)?(plane\s+)?ticket/i.test(t) ||
    /\bticket(s)?\s+(to|from|for)\b/i.test(t) ||
    /\b(fly|flying|flight)\s+(from|to)\b/i.test(t) ||
    /\b(recommend|suggest)\s+.*\b(ticket|flight)\b/i.test(t)
  ) {
    return true;
  }
  // "travel … Bogotá … Miami" style — two known cities + travel wording
  if (/\b(travel|travelling|traveling|trip|fly|flight)\b/i.test(t)) {
    const route = extractRouteFromCityNames(t);
    if (route.origin && route.destination) return true;
  }
  return false;
}

function extractTopic(text) {
  const match = (text || "").match(/\babout\s+([a-z0-9\s-]+?)(?:\?|$)/i);
  return match ? match[1].trim() : "";
}

/** e.g. "latest news from Colombia" -> "Colombia" */
function extractNewsQuery(text) {
  const t = text || "";
  let m = t.match(/\b(?:latest\s+)?news\s+(?:from|in|about)\s+([a-zA-ZÀ-ÿ\s]+?)(?:\?|\.|$)/i);
  if (m) return m[1].trim();
  m = t.match(/\bheadlines?\s+(?:from|in|about)\s+([a-zA-ZÀ-ÿ\s]+?)(?:\?|\.|$)/i);
  if (m) return m[1].trim();
  m = t.match(/\bbreaking\s+(?:news\s+)?(?:from|in)\s+([a-zA-ZÀ-ÿ\s]+?)(?:\?|\.|$)/i);
  if (m) return m[1].trim();
  return extractTopic(t);
}

/** Clinic / hospital / pharmacy — needs Google Places + key. */
function isLocalServiceQuestion(text) {
  const t = (text || "").toLowerCase();
  if (!/\b(clinic|clinics|hospital|hospitals|pharmacy|pharmacies|dentist|urgent care|walk-?in)\b/.test(t)) {
    return false;
  }
  return (
    /\b(near|nearest|closest|around|unicentro|find|where's|where is)\b/i.test(t) ||
    /\b(in|near)\s+[a-zà-ÿ]{4,}/i.test(t)
  );
}

/** City name -> IATA for common routes (speech rarely includes airport codes). */
const CITY_IATA_ENTRIES = [
  ["new york", "JFK"],
  ["los angeles", "LAX"],
  ["mexico city", "MEX"],
  ["são paulo", "GRU"],
  ["sao paulo", "GRU"],
  ["buenos aires", "EZE"],
  ["bogotá", "BOG"],
  ["bogota", "BOG"],
  ["medellín", "MDE"],
  ["medellin", "MDE"],
  ["cartagena", "CTG"],
  ["barranquilla", "BAQ"],
  ["cali", "CLO"],
  ["miami", "MIA"],
  ["orlando", "MCO"],
  ["chicago", "ORD"],
  ["dallas", "DFW"],
  ["houston", "IAH"],
  ["lima", "LIM"],
  ["santiago", "SCL"],
  ["london", "LHR"],
  ["paris", "CDG"],
  ["rome", "FCO"],
  ["madrid", "MAD"],
  ["toronto", "YYZ"],
  ["dubai", "DXB"],
  ["tokyo", "NRT"],
  ["delhi", "DEL"],
  ["karachi", "KHI"],
].sort((a, b) => b[0].length - a[0].length);

function extractRouteFromCityNames(text) {
  const lower = (text || "").toLowerCase();
  const hits = [];
  for (const [city, code] of CITY_IATA_ENTRIES) {
    const idx = lower.indexOf(city);
    if (idx !== -1) hits.push({ idx, code });
  }
  hits.sort((a, b) => a.idx - b.idx);
  const codes = [];
  const seen = new Set();
  for (const h of hits) {
    if (seen.has(h.code)) continue;
    seen.add(h.code);
    codes.push(h.code);
    if (codes.length >= 2) break;
  }
  return { origin: codes[0] || null, destination: codes[1] || null };
}

function extractCurrencies(text) {
  const symbols = String(text || "")
    .toUpperCase()
    .match(/\b[A-Z]{3}\b/g);
  if (!symbols || symbols.length < 2) return { base: null, quote: null };
  return { base: symbols[0], quote: symbols[1] };
}

function extractLocation(text) {
  const m = String(text || "").match(/\b(?:in|at|near|around)\s+([a-zA-Z\s]+?)(?:\?|\.|$)/i);
  return m ? m[1].trim().replace(/\s+/g, " ") : "";
}

function extractRouteIata(text) {
  const codes = String(text || "")
    .toUpperCase()
    .match(/\b[A-Z]{3}\b/g);
  if (!codes || codes.length < 2) return { origin: null, destination: null };
  return { origin: codes[0], destination: codes[1] };
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
    let timeLimitTimer = null;

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
                if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
                  openaiWs.send(
                    JSON.stringify({
                      type: "response.create",
                      response: { instructions: TIME_UP_INSTRUCTION },
                    })
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
          const session = {
            type: "realtime",
            instructions: SYSTEM_PROMPT,
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
            JSON.stringify({
              type: "response.create",
              response: { instructions: `Say exactly: ${GREETING}` },
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

          function sendReply(reply, opts = {}) {
            if (responseInProgress) {
              logger.info({ callSid }, "Skip fast-path: response already in progress");
              return;
            }
            const instruction =
              opts.multilingual
                ? `Say the following in one short sentence using the caller's language (15 to 20 words max): ${reply}.`
                : `Say exactly: ${reply}`;
            openaiWs.send(
              JSON.stringify({
                type: "response.create",
                response: { instructions: instruction },
              })
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

            // Remember last country/territory mentioned (e.g. Puerto Rico) for follow-up weather asks
            const mentioned = findCountryInText(trimmed);
            if (mentioned?.code) {
              const sessionRef = callStore.get(callSid);
              if (sessionRef) {
                sessionRef.placeHint = {
                  country: mentioned.code,
                  name: mentioned.name,
                };
              }
            }

            if (responseInProgress && openaiWs?.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({ type: "response.cancel" }));
              responseInProgress = false;
            }

            if ((weatherService?.enabled || openMeteoService?.enabled) && isWeatherQuestion(trimmed)) {
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
            if (timeService?.enabled && isTimeQuestion(trimmed)) {
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
            if (newsService?.enabled && isNewsQuestion(trimmed)) {
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
            if (fxService?.enabled && isExchangeQuestion(trimmed)) {
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
            if (placesService?.enabled && isLocalServiceQuestion(trimmed)) {
              (async () => {
                const result = await placesService.searchText(trimmed.slice(0, 200));
                const fact = result.error
                  ? result.error
                  : `Nearby options: ${result.places.map((p) => `${p.name}${p.address ? ", " + p.address : ""}`).join(". ")}`;
                sendReply(fact, { multilingual: !result.error });
              })();
              return;
            }
            if (placesService?.enabled && isHotelQuestion(trimmed)) {
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
            if (placesService?.enabled && isFoodQuestion(trimmed)) {
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
            if (travelService?.enabled && isTravelPriceQuestion(trimmed)) {
              let { origin, destination } = extractRouteIata(trimmed);
              if (!origin || !destination) {
                const byCity = extractRouteFromCityNames(trimmed);
                if (!origin) origin = byCity.origin;
                if (!destination) destination = byCity.destination;
              }
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
            if (sportsService?.enabled && isSportsQuestion(trimmed)) {
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
            if (flightsService?.enabled && isFlightQuestion(trimmed)) {
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
            if (stocksService?.enabled && isCryptoQuestion(trimmed)) {
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
            if (stocksService?.enabled && isRatesQuestion(trimmed)) {
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
            if (stocksService?.enabled && isStockQuestion(trimmed)) {
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
              openaiWs.send(JSON.stringify({ type: "response.create" }));
            }
          }

          if (ev.type === "conversation.item.input_audio_transcription.completed" && ev.transcript) {
            handleUserTranscript(ev.transcript);
          }

          if (ev.type === "response.created") {
            responseInProgress = true;
          }
          if (ev.type === "response.done" || ev.type === "response.cancelled" || ev.type === "response.failed") {
            responseInProgress = false;
          }
          if (ev.type === "response.output_audio.delta" && ev.delta) {
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

          if (ev.type === "response.output_audio_transcript.done" && ev.transcript) {
            transcriptLines.push(`AI: ${ev.transcript}`);
            callStore.addAssistantMessage(callSid, ev.transcript);
            const aiLog = ev.transcript.length > 100 ? ev.transcript.slice(0, 100) + "…" : ev.transcript;
            logger.info({ callSid, reply: ev.transcript, role: "assistant" }, `AI: ${aiLog}`);
          }

          if (
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
                  openaiWs.send(JSON.stringify({ type: "response.create" }));
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
