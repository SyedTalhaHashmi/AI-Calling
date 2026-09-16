const axios = require("axios");
const { MemoryCache } = require("./cache");

const BASE = "https://api.travelpayouts.com/v1/prices/cheap";

/** English words that look like IATA — never send to Travelpayouts. */
const IATA_STOPWORDS = new Set([
  "THE", "AND", "FOR", "YOU", "CAN", "ASK", "ARE", "WAS", "NOT", "BUT", "ALL",
  "ANY", "HOW", "WHO", "WHY", "YES", "NOW", "OUT", "GET", "GOT", "LET", "MAY",
  "ONE", "TWO", "SIX", "TEN", "DAY", "FLY", "AIR", "BUS", "CAR", "NEW", "OLD",
]);

function createTravelService(token, logger) {
  if (!token) {
    return {
      enabled: false,
      cheapestRoute: async () => ({ error: "Travel API is not configured." }),
    };
  }

  const cache = new MemoryCache();

  async function cheapestRoute(origin, destination, currency = "USD") {
    const from = String(origin || "").toUpperCase();
    const to = String(destination || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      return { error: "Please share origin and destination airport IATA codes, like LHE to DXB." };
    }
    if (IATA_STOPWORDS.has(from) || IATA_STOPWORDS.has(to)) {
      return {
        error:
          "Please share origin and destination airport IATA codes, like BOG to MIA.",
      };
    }
    const cacheKey = `travel:${from}:${to}:${currency}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get(BASE, {
        params: {
          origin: from,
          destination: to,
          currency,
        },
        headers: {
          "x-access-token": token,
          "Accept-Encoding": "gzip, deflate",
        },
        timeout: 1800,
      });
      const bucket = res.data?.data?.[to];
      if (!bucket) {
        return {
          error: `I couldn't find recent ticket prices for ${from} to ${to}. Try Kayak or Skyscanner for live deals.`,
        };
      }
      const entries = Object.values(bucket);
      if (!entries.length) {
        return {
          error: `I couldn't find recent ticket prices for ${from} to ${to}. Try Kayak or Skyscanner for live deals.`,
        };
      }
      entries.sort((a, b) => Number(a.price || Infinity) - Number(b.price || Infinity));
      const best = entries[0];
      const result = {
        origin: from,
        destination: to,
        price: Number(best.price),
        airline: best.airline || "",
        departureAt: best.departure_at || "",
        expiresAt: best.expires_at || "",
        currency,
      };
      return cache.set(cacheKey, result, 10 * 60 * 1000);
    } catch (err) {
      logger.warn({ err: err.message, from, to }, "Travelpayouts request failed");
      return { error: "Could not fetch ticket prices right now." };
    }
  }

  return {
    enabled: true,
    cheapestRoute,
  };
}

module.exports = createTravelService;
