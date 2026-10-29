const axios = require("axios");
const { MemoryCache } = require("./cache");
const { airlineName, cityName } = require("../utils/spokenFacts");

const BASE = "https://api.travelpayouts.com/v1/prices/cheap";
/** Fares for specific dates or a month (same token; Travelpayouts' recommended replacement for /v1/prices/cheap). */
const DATES_URL = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";

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
      fareForTrip: async () => ({ error: "Travel API is not configured." }),
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
        // Spoken name for tools mode ("AV" → "Avianca"); empty when unknown
        airlineName: airlineName(best.airline),
        departureAt: best.departure_at || "",
        // Set for round-trip fares; empty means one-way
        returnAt: best.return_at || "",
        expiresAt: best.expires_at || "",
        currency,
      };
      return cache.set(cacheKey, result, 10 * 60 * 1000);
    } catch (err) {
      logger.warn({ err: err.message, from, to }, "Travelpayouts request failed");
      return { error: "Could not fetch ticket prices right now." };
    }
  }

  /** One /prices_for_dates request → items (cheapest first); throws on network / HTTP errors. */
  async function pricesForDates(params) {
    const res = await axios.get(DATES_URL, {
      params: { currency: "usd", sorting: "price", direct: "false", unique: "false", ...params },
      headers: { "x-access-token": token, "Accept-Encoding": "gzip, deflate" },
      timeout: 1800,
    });
    return (res.data?.data || [])
      .filter((it) => Number(it.price) > 0 && it.departure_at)
      .sort((a, b) => Number(a.price) - Number(b.price));
  }

  const day = (at) => String(at || "").slice(0, 10);
  const daysApart = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5;

  /**
   * Cheapest recent fare for the caller's dates. Tries the exact date, then that month filtered to
   * the date (or "next week" window), then nearby days, then the month's cheapest — and labels
   * which one it found (match: exact | window | near | other_dates | month) so it's never passed
   * off as their date. At most two requests.
   */
  async function fareForTrip(origin, destination, { departDate, returnDate, departMonth, window, oneWay } = {}) {
    const from = String(origin || "").toUpperCase();
    const to = String(destination || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      return { error: "Which cities are you flying between?" };
    }
    let isOneWay = oneWay ?? !returnDate;
    let base = { origin: from, destination: to, one_way: String(isOneWay) };
    const back = !isOneWay && returnDate ? returnDate : null;
    const month = departDate ? departDate.slice(0, 7) : departMonth;
    const cacheKey = `dates:${from}:${to}:${departDate || ""}:${back || ""}:${month || ""}:${window?.start || ""}:${isOneWay}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const pack = (it, match) => ({
      origin: from,
      destination: to,
      price: Number(it.price),
      currency: "USD",
      airline: it.airline || "",
      airlineName: airlineName(it.airline),
      departDate: day(it.departure_at),
      returnDate: it.return_at ? day(it.return_at) : null,
      transfers: it.transfers ?? null,
      return_transfers: it.return_transfers ?? null,
      oneWay: isOneWay,
      match,
      requestedDate: departDate || null,
      month: month || null,
    });

    try {
      if (departDate) {
        const exact = await pricesForDates({ ...base, departure_at: departDate, ...(back ? { return_at: back } : {}), limit: 10 });
        if (exact.length) return cache.set(cacheKey, pack(exact[0], "exact"), 10 * 60 * 1000);
      }
      if (!month) return { error: "Which dates are you thinking of?" };
      let items = await pricesForDates({ ...base, departure_at: month, ...(back ? { return_at: back.slice(0, 7) } : {}), limit: 100 });
      // Trip type not said and nothing one-way that month (live: Miami → Bogotá in December): try round trip
      if (!items.length && oneWay == null && isOneWay) {
        isOneWay = false;
        base = { ...base, one_way: "false" };
        items = await pricesForDates({ ...base, departure_at: month, limit: 100 });
      }
      let found = null;
      if (departDate) {
        const sameDay = items.find((it) => day(it.departure_at) === departDate);
        const near = items.find((it) => daysApart(day(it.departure_at), departDate) <= 3);
        found = sameDay ? pack(sameDay, "exact") : near ? pack(near, "near") : items[0] ? pack(items[0], "other_dates") : null;
      } else if (window) {
        const inWeek = items.find((it) => day(it.departure_at) >= window.start && day(it.departure_at) <= window.end);
        found = inWeek ? pack(inWeek, "window") : items[0] ? pack(items[0], "other_dates") : null;
      } else if (items[0]) {
        found = pack(items[0], "month");
      }
      if (!found) {
        return {
          error: `I couldn't find recent fares from ${cityName(from)} to ${cityName(to)} for those dates. Google Flights or Kayak will show live prices.`,
        };
      }
      return cache.set(cacheKey, found, 10 * 60 * 1000);
    } catch (err) {
      logger.warn({ err: err.message, from, to }, "Travelpayouts dates request failed");
      return { error: "I couldn't get flight prices right now. Google Flights or Kayak will show live prices." };
    }
  }

  return {
    enabled: true,
    cheapestRoute,
    fareForTrip,
  };
}

module.exports = createTravelService;
