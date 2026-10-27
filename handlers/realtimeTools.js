/**
 * Phase 1 "tools" router mode: Realtime function tools over the EXISTING data services.
 * The model picks the tool and extracts entities (any language); we run the existing service.
 * Every execute() resolves (never throws) and is capped by a per-tool deadline.
 */
const { normalizeCountryCode, defaultCityForCountry } = require("../utils/placeResolve");

const MAX_OUTPUT_CHARS = 2000;
const DEADLINE_ERROR = "That lookup took too long. Please try again in a moment.";
const FAILED_ERROR = "I couldn't get that right now. Please try again in a moment.";

const TOOL_DEFS = {
  get_weather: {
    description:
      "Get current weather for a city. Always call this for weather/temperature/forecast—never guess. When the user names a country or territory (e.g. Puerto Rico, France), pass it in country and use that country's main city if no city is given. For ambiguous cities (San Juan, London, Paris), country is required. If they ask about two cities (A or B), call once per city.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, e.g. London, Miami, San Juan, Karachi" },
        country: {
          type: "string",
          description: "Country or territory — ISO code preferred (PR, US, FR) or full name.",
        },
      },
      required: ["city"],
    },
  },
  get_time: {
    description:
      "Get the current local time somewhere. Pass the IANA time zone you infer from the city or country (e.g. Asia/Tokyo, America/Bogota).",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "IANA time zone, e.g. America/New_York" },
        place: { type: "string", description: "City or country the caller named" },
      },
      required: ["timezone"],
    },
  },
  get_news: {
    description:
      "Get the latest news headlines. Optional topic or country (e.g. Colombia, technology). Omit topic for top headlines.",
    parameters: {
      type: "object",
      properties: { topic: { type: "string", description: "Topic or country, in English" } },
    },
  },
  get_exchange_rate: {
    description:
      "Get today's exchange rate between two currencies. Convert spoken names to ISO codes yourself (dollars→USD, euros→EUR). Plain \"pesos\" with no country means Colombian pesos (COP); use MXN, ARS, CLP, etc. only if the caller names that country. If no amount is given, call anyway and give the rate for one unit — do not ask for an amount.",
    parameters: {
      type: "object",
      properties: {
        base: { type: "string", description: "ISO code to convert from, e.g. USD" },
        quote: { type: "string", description: "ISO code to convert to, e.g. COP" },
      },
      required: ["base", "quote"],
    },
  },
  find_places: {
    description:
      "Find places: hotels, restaurants/food, or local services (pharmacy, clinic, hospital, dentist). Requires a city or area. Say the short acknowledgement out loud before calling this, like every other tool.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["hotel", "food", "local_service"] },
        location: { type: "string", description: "City or area, e.g. Cartagena" },
        query: {
          type: "string",
          description: "For local_service: what to find, e.g. pharmacy, urgent care",
        },
      },
      required: ["kind", "location"],
    },
  },
  get_flight_fare: {
    description:
      "Get the cheapest recently seen airfare between two airports (recent fares, not a live booking quote). Convert city names to IATA airport codes yourself (Bogota→BOG, Miami→MIA, Madrid→MAD). If origin or destination is missing, ask the caller instead of calling.",
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Origin IATA code, e.g. BOG" },
        destination: { type: "string", description: "Destination IATA code, e.g. MIA" },
      },
      required: ["origin", "destination"],
    },
  },
  get_flight_status: {
    description: "Get live status of a specific flight by flight number (e.g. AA 920, UA1004).",
    parameters: {
      type: "object",
      properties: { flight_number: { type: "string", description: "Airline code + number" } },
      required: ["flight_number"],
    },
  },
  get_sports_scores: {
    description:
      "Get live scores for a sport: soccer/football, nba, basketball, nfl, baseball, hockey, rugby, volleyball.",
    parameters: {
      type: "object",
      properties: { sport: { type: "string", description: "Sport or league, e.g. soccer, NBA" } },
      required: ["sport"],
    },
  },
  get_crypto_price: {
    description: "Get the current USD price of a cryptocurrency (bitcoin, ethereum, solana, …).",
    parameters: {
      type: "object",
      properties: { coin: { type: "string", description: "Coin name or symbol" } },
      required: ["coin"],
    },
  },
  get_stock_quote: {
    description: "Get the latest stock price for a company or ticker (Apple, TSLA, …).",
    parameters: {
      type: "object",
      properties: { company_or_ticker: { type: "string" } },
      required: ["company_or_ticker"],
    },
  },
  get_us_interest_rate: {
    description: "Get the latest U.S. Federal Funds interest rate.",
    parameters: { type: "object", properties: {} },
  },
  web_search: {
    description:
      "Search the web for a live or recent fact when no other tool covers it (gas prices, whether a place or airport is open today, event dates, recent results), or when the matching tool just failed. Call at most once per question. Never use it for questions about this call's cost, billing, minutes, or plan.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Short English search query, e.g. gas price Miami today" },
      },
      required: ["query"],
    },
  },
};

/** Which existing service backs each tool (tool offered only when enabled). */
function toolEnabled(name, s) {
  switch (name) {
    case "get_weather":
      return Boolean(s.openMeteoService?.enabled || s.weatherService?.enabled);
    case "get_time":
      return Boolean(s.timeService?.enabled);
    case "get_news":
      return Boolean(s.newsService?.enabled);
    case "get_exchange_rate":
      return Boolean(s.fxService?.enabled);
    case "find_places":
      return Boolean(s.placesService?.enabled);
    case "get_flight_fare":
      return Boolean(s.travelService?.enabled);
    case "get_flight_status":
      return Boolean(s.flightsService?.enabled);
    case "get_sports_scores":
      return Boolean(s.sportsService?.enabled);
    case "get_crypto_price":
    case "get_stock_quote":
    case "get_us_interest_rate":
      return Boolean(s.stocksService?.enabled);
    case "web_search":
      return Boolean(s.webSearchService?.enabled);
    default:
      return false;
  }
}

function buildToolDefinitions(services) {
  return Object.entries(TOOL_DEFS)
    .filter(([name]) => toolEnabled(name, services))
    .map(([name, def]) => ({ type: "function", name, ...def }));
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

/** All places fetched at once; results keep the input order. */
function fetchWeatherForPlaces(places, fetchOne) {
  return Promise.all(places.map((place) => fetchOne(place)));
}

function isValidTimeZone(tz) {
  if (!tz) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function createToolExecutor({ services, logger, deadlineMs = 2500 }) {
  const s = services;

  const handlers = {
    async get_weather(args) {
      let city = String(args.city || "").trim() || "unknown";
      let country = normalizeCountryCode(args.country) || undefined;
      // Country-only call ("weather in Puerto Rico")
      const cityAsCountry = normalizeCountryCode(city);
      if (cityAsCountry) {
        country = country || cityAsCountry;
        city = defaultCityForCountry(cityAsCountry) || city;
      }
      if (/^unknown$/i.test(city) && country) {
        city = defaultCityForCountry(country) || city;
      }
      return fetchWeatherForPlace({ city, country }, s.openMeteoService, s.weatherService);
    },

    async get_time(args) {
      let tz = isValidTimeZone(args.timezone) ? args.timezone : null;
      if (!tz && args.place) tz = s.timeService.resolveTimezone(`in ${args.place}`);
      if (!tz) return { error: "Which city or time zone should I check?" };
      if (s.worldTimeService?.enabled) {
        const r = await s.worldTimeService.getTimeByTimezone(tz);
        if (!r.error && r.datetime) {
          const time = new Date(r.datetime).toLocaleTimeString("en-US", {
            timeZone: tz,
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
          return { time, timezone: tz };
        }
      }
      return s.timeService.getCurrentTime(tz);
    },

    get_news(args) {
      return s.newsService.topHeadlines(args.topic || "");
    },

    get_exchange_rate(args) {
      return s.fxService.getRate(
        String(args.base || "").toUpperCase(),
        String(args.quote || "").toUpperCase()
      );
    },

    find_places(args) {
      const location = String(args.location || "").trim();
      if (args.kind === "hotel") return s.placesService.searchHotels(location);
      if (args.kind === "food") return s.placesService.searchFood(location);
      const what = String(args.query || "").trim() || "services";
      return s.placesService.searchText(location ? `${what} near ${location}` : what);
    },

    get_flight_fare(args) {
      return s.travelService.cheapestRoute(
        String(args.origin || "").toUpperCase(),
        String(args.destination || "").toUpperCase()
      );
    },

    get_flight_status(args) {
      return s.flightsService.getFlightStatus(String(args.flight_number || "").replace(/\s+/g, ""));
    },

    get_sports_scores(args) {
      return s.sportsService.getLiveScores(s.sportsService.detectSport(String(args.sport || "")));
    },

    get_crypto_price(args) {
      return s.stocksService.getCryptoQuote(String(args.coin || ""));
    },

    get_stock_quote(args) {
      return s.stocksService.getQuote(String(args.company_or_ticker || ""));
    },

    get_us_interest_rate() {
      return s.stocksService.getUsInterestRate();
    },

    web_search(args) {
      const query = String(args.query || "").trim();
      if (!query) return { error: "What should I search for?" };
      return s.webSearchService.search(query);
    },
  };

  /** Resolves to the service result or an { error } object — never throws. */
  async function execute(name, args = {}) {
    const handler = handlers[name];
    if (!handler || !toolEnabled(name, s)) {
      return { error: "That lookup isn't available right now." };
    }
    let timer = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ error: DEADLINE_ERROR, timedOut: true }), deadlineMs);
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => handler(args || {})), deadline]);
      if (result?.timedOut) {
        logger.warn({ tool: name, deadlineMs }, "Tool deadline exceeded");
        return { error: DEADLINE_ERROR };
      }
      return result ?? { error: FAILED_ERROR };
    } catch (err) {
      logger.warn({ tool: name, err: err.message }, "Tool failed");
      return { error: FAILED_ERROR };
    } finally {
      clearTimeout(timer);
    }
  }

  return { execute };
}

/** Every function_call item in a Realtime response, in output order. */
function collectFunctionCalls(response) {
  return (response?.output || []).filter((o) => o?.type === "function_call" && o.call_id);
}

function serializeOutput(result) {
  const text = JSON.stringify(result ?? {});
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return JSON.stringify({ truncated: true, text: text.slice(0, MAX_OUTPUT_CHARS - 200) });
}

/**
 * Run all calls in parallel; outputs keep call order.
 * timed(label, fn) is optional (latency metrics) and must pass results through.
 */
function runToolCalls(calls, executor, { timed = (label, fn) => fn() } = {}) {
  return Promise.all(
    calls.map(async (call) => {
      let args = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        args = {};
      }
      const result = await timed(`tool:${call.name}`, () => executor.execute(call.name, args));
      return { call_id: call.call_id, name: call.name, args, result, output: serializeOutput(result) };
    })
  );
}

const TOOLS_SESSION_RULES = [
  "## Live data tools (tools mode — authoritative, overrides earlier rules)",
  "- For live weather, time, news, exchange rates, places (hotels, restaurants, pharmacies, clinics), flight fares, flight status, sports scores, crypto, stock prices, or U.S. interest rates, call the matching tool. Never guess live numbers.",
  "- Before calling any tool (including hotel, restaurant, and place searches), say one very short acknowledgement (3 to 6 words, like \"Let me check that.\") in the caller's language. This replaces the earlier rule against saying \"let me check\".",
  "- Plain \"pesos\" means Colombian pesos (COP) unless the caller names another country.",
  "- For general knowledge, answer directly without tools.",
  "- Never state live or changing facts (whether a place, airport, road, or service is open or closed today, current prices, schedules, today's events) unless they came from a tool result for this question. If no tool covers it, say you can't check that live right now and suggest where to check.",
  "- Only call a tool that matches the question. Never call an unrelated tool (for example, weather for a gas price question).",
  "- Never use tools for questions about this call's cost, free time, minutes, or plan.",
].join("\n");

/** Added to the session rules only when the web_search tool is offered. */
const WEB_SEARCH_SESSION_RULE =
  "- If no other tool covers a live question, or the matching tool failed, call web_search once with a short English query. Answer only from its results and mention the source briefly.";

function toolsTurnInstruction(langName) {
  return (
    `Reply in ${langName} only. About 15–25 words. ` +
    `If their latest request needs live data (weather, time, news, exchange rates, places, flight fares or status, sports scores, crypto, stocks, U.S. interest rates), ` +
    `first say one very short acknowledgement like "Let me check that." and then call the matching tool. Do this for every tool, including hotel, restaurant, and place searches. Never guess live numbers, and never state live facts (open or closed today, prices, schedules) without a tool result. ` +
    `Otherwise answer from general knowledge (like ChatGPT). If you cannot complete an action (browse, open links, transfer), still help with a clear website or search tip plus what you can do next. ` +
    `Answer only their latest request.`
  );
}

function toolsFollowUpInstruction(langName) {
  return (
    `Reply in ${langName} only. Answer their latest request using only the tool results just returned, in one or two short sentences (15–25 words). ` +
    `Do not repeat the acknowledgement. Never guess live numbers: if a result has an error, say you couldn't get it and suggest what they can try next. ` +
    `State only facts that appear in the results. If the results don't answer the question (for example, a place listing doesn't say whether it is open), say you couldn't confirm that.`
  );
}

/** ROUTER_MODE: only an explicit "tools" enables tools mode; anything else keeps the regex router. */
function parseRouterMode(value) {
  return String(value || "").trim().toLowerCase() === "tools" ? "tools" : "regex";
}

function parseToolDeadlineMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 2500;
}

/** Regex router intent → the tool the model should pick (null = no tool). Logging only. */
const REGEX_INTENT_TO_TOOL = {
  weather: "get_weather",
  time: "get_time",
  news: "get_news",
  fx: "get_exchange_rate",
  hotel: "find_places",
  food: "find_places",
  local_service: "find_places",
  travel_price: "get_flight_fare",
  flight_status: "get_flight_status",
  sports: "get_sports_scores",
  crypto: "get_crypto_price",
  stocks: "get_stock_quote",
  rates: "get_us_interest_rate",
  chat: null,
};

function toolChoiceAgreement(regexIntent, toolNames) {
  const expected = REGEX_INTENT_TO_TOOL[regexIntent] ?? null;
  const used = toolNames || [];
  if (!expected) return used.length ? "model_used_tool" : "agree";
  if (!used.length) return "model_skipped_tool";
  return used.includes(expected) ? "agree" : "different_tool";
}

module.exports = {
  parseRouterMode,
  parseToolDeadlineMs,
  toolChoiceAgreement,
  buildToolDefinitions,
  createToolExecutor,
  collectFunctionCalls,
  runToolCalls,
  fetchWeatherForPlace,
  fetchWeatherForPlaces,
  TOOLS_SESSION_RULES,
  WEB_SEARCH_SESSION_RULE,
  toolsTurnInstruction,
  toolsFollowUpInstruction,
};
