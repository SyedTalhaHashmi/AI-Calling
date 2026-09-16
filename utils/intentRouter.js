/**
 * Single-intent router + safe entity extraction for voice fast paths.
 * One utterance → one intent → entities for that intent only.
 */

const {
  extractWeatherPlaces,
  findCountryInText,
  normalizeCountryCode,
  defaultCityForCountry,
} = require("./placeResolve");

/** Common English words that look like IATA but must never be used as airports. */
const IATA_STOPWORDS = new Set(
  [
    "THE", "AND", "FOR", "YOU", "CAN", "ASK", "ARE", "WAS", "NOT", "BUT", "ALL",
    "ANY", "HOW", "WHO", "WHY", "YES", "NOW", "OUT", "GET", "GOT", "LET", "MAY",
    "ONE", "TWO", "SIX", "TEN", "DAY", "FLY", "AIR", "BUS", "CAR", "NEW", "OLD",
    "BIG", "TOP", "LOW", "HIGH", "BAD", "HAY", "QUE", "POR", "CON", "UNA", "LOS",
    "LAS", "DEL", "VIA", "SUR", "NOR",
  ].map((s) => s.toUpperCase())
);

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

const KNOWN_IATA = new Set(CITY_IATA_ENTRIES.map(([, code]) => code));

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word / whole-phrase match (never substring inside another word). */
function hasPhrase(text, phrase) {
  const p = String(phrase || "").trim();
  if (!p) return false;
  const t = String(text || "");
  if (/\s/.test(p)) {
    return new RegExp(`\\b${escapeRegex(p)}\\b`, "i").test(t);
  }
  return new RegExp(`\\b${escapeRegex(p)}\\b`, "i").test(t);
}

function isHotelQuestion(text) {
  return /\b(hotel|hotels|stay|accommodation|room price|hotel price)\b/i.test(text || "");
}

function isFoodQuestion(text) {
  return /\b(food|restaurant|restaurants|eat|dining|best food|best restaurant)\b/i.test(
    text || ""
  );
}

function isLocalServiceQuestion(text) {
  const t = (text || "").toLowerCase();
  if (
    !/\b(clinic|clinics|hospital|hospitals|pharmacy|pharmacies|dentist|urgent care|walk-?in)\b/.test(
      t
    )
  ) {
    return false;
  }
  return (
    /\b(near|nearest|closest|around|unicentro|find|where's|where is)\b/i.test(t) ||
    /\b(in|near)\s+[a-zà-ÿ]{4,}/i.test(t)
  );
}

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
    /\b(recommend|suggest)\s+.*\b(ticket|flight)\b/i.test(t) ||
    /\bprice of (the |a )?ticket\b/i.test(t) ||
    /\bticket\s+(prize|price|cost|fare)\b/i.test(t) ||
    /\b(whats|what's|what is)\s+(the\s+)?ticket\b/i.test(t)
  ) {
    return true;
  }
  if (/\b(travel|travelling|traveling|trip|fly|flight)\b/i.test(t)) {
    const route = extractRouteFromCityNames(t);
    if (route.origin && route.destination) return true;
  }
  return false;
}

/**
 * Weather intent — word boundaries only.
 * Never match "hot" inside "hotel" or "rain" inside "brain".
 */
function isWeatherQuestion(text) {
  const t = text || "";
  if (isHotelQuestion(t) || isTravelPriceQuestion(t)) return false;
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
  ];
  return keywords.some((k) => hasPhrase(t, k));
}

function isTimeQuestion(text) {
  const t = (text || "").toLowerCase();
  return (
    /\b(time|what time|current time|what's the time|timezone|what time is it)\b/i.test(t) ||
    /time\s+in\s+/i.test(t)
  );
}

function isSportsQuestion(text) {
  const t = text || "";
  const keywords = [
    "score",
    "scores",
    "game",
    "match",
    "sports",
    "who won",
    "basketball",
    "football",
    "soccer",
    "nba",
    "nfl",
    "mlb",
    "live match",
    "live game",
  ];
  return keywords.some((k) => hasPhrase(t, k));
}

function isFlightQuestion(text) {
  const t = (text || "").toLowerCase();
  if (isTravelPriceQuestion(t)) return false;
  return (
    /\b(flight status|is flight|where is flight|flight number)\b/i.test(t) ||
    /flight\s+[a-z]{2}\s*\d+/i.test(t)
  );
}

function isCryptoQuestion(text) {
  return /\b(bitcoin|btc|ethereum|eth|solana|dogecoin|doge|crypto|cryptocurrency|ripple|xrp|cardano)\b/i.test(
    text || ""
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
    /\b(exchange rate|currency|convert|conversion|forex|usd|eur|inr|pkr|aed|gbp|cop|mxn)\b/i.test(
      t
    ) ||
    /\b(peso|pesos|dollar|dollars|euro|euros|pound|pounds|yen|yuan|real|reais)\b/i.test(t)
  );
}

/**
 * Resolve exactly one intent. Specific domains beat weather/chat.
 */
function resolveIntent(text) {
  const t = text || "";
  if (isHotelQuestion(t)) return "hotel";
  if (isTravelPriceQuestion(t)) return "travel_price";
  if (isLocalServiceQuestion(t)) return "local_service";
  if (isFoodQuestion(t)) return "food";
  if (isWeatherQuestion(t)) return "weather";
  if (isTimeQuestion(t)) return "time";
  if (isNewsQuestion(t)) return "news";
  if (isExchangeQuestion(t)) return "fx";
  if (isSportsQuestion(t)) return "sports";
  if (isFlightQuestion(t)) return "flight_status";
  if (isCryptoQuestion(t)) return "crypto";
  if (isRatesQuestion(t)) return "rates";
  if (isStockQuestion(t)) return "stocks";
  return "chat";
}

/** Raw 3-letter tokens only if known IATA and not English stopwords. */
function extractRouteIata(text) {
  const codes = String(text || "")
    .toUpperCase()
    .match(/\b[A-Z]{3}\b/g);
  if (!codes || !codes.length) return { origin: null, destination: null };
  const valid = codes.filter((c) => KNOWN_IATA.has(c) && !IATA_STOPWORDS.has(c));
  if (valid.length < 2) {
    return { origin: valid[0] || null, destination: valid[1] || null };
  }
  return { origin: valid[0], destination: valid[1] };
}

/** Prefer city names; fill gaps with whitelisted IATA only. */
function extractTravelRoute(text) {
  const byCity = extractRouteFromCityNames(text);
  const byIata = extractRouteIata(text);
  return {
    origin: byCity.origin || byIata.origin || null,
    destination: byCity.destination || byIata.destination || null,
  };
}

function extractLocation(text) {
  const t = String(text || "");
  const lower = t.toLowerCase();

  // If lodging words appear, prefer the city mentioned after them
  const lodgingIdx = lower.search(
    /\b(hotel|hotels|stay|accommodation|room price|lodging)\b/i
  );
  if (lodgingIdx >= 0) {
    const after = lower.slice(lodgingIdx);
    const origAfter = t.slice(lodgingIdx);
    for (const [city] of CITY_IATA_ENTRIES) {
      const idx = after.indexOf(city);
      if (idx !== -1) {
        return origAfter.slice(idx, idx + city.length);
      }
    }
  }

  // Prefer known city names when present (most reliable for speech)
  for (const [city] of CITY_IATA_ENTRIES) {
    if (lower.includes(city)) {
      const idx = lower.indexOf(city);
      return t.slice(idx, idx + city.length);
    }
  }

  const stop = new Set([
    "the", "a", "an", "in", "at", "near", "around", "for", "one", "night",
    "nice", "best", "cheap", "luxury", "hotel", "hotels", "place", "stay",
    "beach", "this", "friday", "saturday", "sunday", "monday", "today",
    "tomorrow", "weekend", "please", "room", "price",
  ]);

  const matches = [
    ...t.matchAll(
      /\b(?:in|at|near|around)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*){0,2})/gi
    ),
  ];
  if (!matches.length) return "";

  for (let i = matches.length - 1; i >= 0; i--) {
    const cleaned = matches[i][1]
      .trim()
      .split(/\s+/)
      .filter((w) => !stop.has(w.toLowerCase()))
      .join(" ")
      .trim();
    if (cleaned.length >= 2) return cleaned;
  }
  return "";
}

/**
 * Weather places. Session placeHint only for follow-ups with no new city,
 * or when this turn still mentions that country.
 */
function extractCityAndCountry(text, placeHint) {
  const { places, countryHint } = extractWeatherPlaces(text);
  const textCountry =
    normalizeCountryCode(findCountryInText(text)?.code) ||
    normalizeCountryCode(countryHint) ||
    undefined;
  const sessionHint = normalizeCountryCode(placeHint?.country) || undefined;

  const applySessionHint =
    places.length === 0 || (sessionHint && textCountry && textCountry === sessionHint);

  const hintCountry =
    textCountry || (applySessionHint ? sessionHint : undefined) || undefined;

  if (places.length) {
    return places.map((p) => ({
      city: p.city,
      country: normalizeCountryCode(p.country) || hintCountry || undefined,
    }));
  }

  // Fallback: known city name mentioned in a weather ask ("is Paris hot")
  const lower = String(text || "").toLowerCase();
  for (const [city] of CITY_IATA_ENTRIES) {
    if (lower.includes(city)) {
      return [
        {
          city: city.replace(/\b\w/g, (c) => c.toUpperCase()),
          country: hintCountry || undefined,
        },
      ];
    }
  }

  if (hintCountry) {
    const def = defaultCityForCountry(hintCountry);
    if (def) return [{ city: def, country: hintCountry }];
  }

  return [{ city: "unknown", country: hintCountry }];
}

function extractTopic(text) {
  const match = (text || "").match(/\babout\s+([a-z0-9\s-]+?)(?:\?|$)/i);
  return match ? match[1].trim() : "";
}

function extractNewsQuery(text) {
  const t = text || "";
  let m = t.match(
    /\b(?:latest\s+)?news\s+(?:from|in|about)\s+([a-zA-ZÀ-ÿ\s]+?)(?:\?|\.|$)/i
  );
  if (m) return m[1].trim();
  m = t.match(/\bheadlines?\s+(?:from|in|about)\s+([a-zA-ZÀ-ÿ\s]+?)(?:\?|\.|$)/i);
  if (m) return m[1].trim();
  m = t.match(/\bbreaking\s+(?:news\s+)?(?:from|in)\s+([a-zA-ZÀ-ÿ\s]+?)(?:\?|\.|$)/i);
  if (m) return m[1].trim();
  return extractTopic(t);
}

function extractFlightNumber(text) {
  const match = (text || "").match(/\b([A-Za-z]{2})\s*(\d{2,4})\b/);
  if (match) return (match[1] + match[2]).toUpperCase();
  const fallback = (text || "").match(/([A-Za-z]{2}\d{2,4})/);
  return fallback ? fallback[1].toUpperCase() : null;
}

function extractCurrencies(text) {
  const symbols = String(text || "")
    .toUpperCase()
    .match(/\b[A-Z]{3}\b/g);
  if (!symbols || symbols.length < 2) return { base: null, quote: null };
  return { base: symbols[0], quote: symbols[1] };
}

module.exports = {
  resolveIntent,
  isWeatherQuestion,
  isHotelQuestion,
  isTravelPriceQuestion,
  isTimeQuestion,
  isSportsQuestion,
  isFlightQuestion,
  isCryptoQuestion,
  isRatesQuestion,
  isStockQuestion,
  isNewsQuestion,
  isExchangeQuestion,
  isFoodQuestion,
  isLocalServiceQuestion,
  extractTravelRoute,
  extractRouteIata,
  extractRouteFromCityNames,
  extractLocation,
  extractCityAndCountry,
  extractNewsQuery,
  extractFlightNumber,
  extractCurrencies,
  hasPhrase,
  CITY_IATA_ENTRIES,
  KNOWN_IATA,
};
