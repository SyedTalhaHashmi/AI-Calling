const axios = require("axios");
const { MemoryCache } = require("./cache");
const { keepAliveAgent } = require("../utils/httpAgent");

const BASE = "https://places.googleapis.com/v1/places:searchText";
/** Cold-connection p90 was ~1.45 s, so the old 1.6 s limit failed ~1 in 4 hotel searches. */
const TIMEOUT_MS = 2200;

function createPlacesService(apiKey, logger) {
  if (!apiKey) {
    return {
      enabled: false,
      searchHotels: async () => ({ error: "Places API is not configured." }),
      searchFood: async () => ({ error: "Places API is not configured." }),
      searchText: async () => ({ error: "Places API is not configured." }),
    };
  }

  const cache = new MemoryCache();
  const headers = {
    "X-Goog-Api-Key": apiKey,
    // Restrict fields for lower latency + lower billing.
    "X-Goog-FieldMask":
      "places.displayName,places.formattedAddress,places.rating,places.priceLevel",
  };

  async function search(query, cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    try {
      const res = await axios.post(
        BASE,
        { textQuery: query, languageCode: "en", maxResultCount: 3 },
        { headers, timeout: TIMEOUT_MS, httpsAgent: keepAliveAgent }
      );
      const places = (res.data?.places || []).slice(0, 3).map((p) => ({
        name: p.displayName?.text,
        address: p.formattedAddress,
        rating: p.rating,
        priceLevel: p.priceLevel,
      }));
      if (!places.length) return { error: "No places found right now." };
      return cache.set(cacheKey, { places }, 10 * 60 * 1000);
    } catch (err) {
      logger.warn({ err: err.message, query }, "Google Places request failed");
      return { error: "Could not fetch place recommendations." };
    }
  }

  /** tier: "budget" | "luxury" | undefined — matches the hotels named to the caller's budget. */
  function searchHotels(location, tier) {
    const loc = String(location || "").trim();
    if (!loc) return Promise.resolve({ error: "Please share a city for hotel search." });
    const kind = tier === "budget" ? "budget hotels" : tier === "luxury" ? "luxury hotels" : "best hotels";
    return search(`${kind} in ${loc}`, `hotel:${tier || "best"}:${loc.toLowerCase()}`);
  }

  function searchFood(location, cuisine) {
    const loc = String(location || "").trim();
    if (!loc) return Promise.resolve({ error: "Please share a city for food search." });
    const cuisinePart = cuisine ? `${cuisine} ` : "";
    return search(`best ${cuisinePart}restaurants in ${loc}`, `food:${loc.toLowerCase()}:${String(cuisine || "").toLowerCase()}`);
  }

  /** Free-form text (clinic near X, pharmacy in Y) — same Text Search, separate cache key. */
  function searchText(textQuery) {
    const q = String(textQuery || "").trim();
    if (!q) return Promise.resolve({ error: "Please describe what you are looking for." });
    return search(q, `txt:${q.toLowerCase().slice(0, 120)}`);
  }

  return {
    enabled: true,
    searchHotels,
    searchFood,
    searchText,
  };
}

module.exports = createPlacesService;
