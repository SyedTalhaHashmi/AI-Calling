const axios = require("axios");
const { MemoryCache } = require("./cache");
const { keepAliveAgent } = require("../utils/httpAgent");

/**
 * Exa web search — tools mode only, off unless WEB_SEARCH_ENABLED=true and EXA_API_KEY is set.
 * Lowest-cost "lite" search with 3 short highlights (~$7 per 1,000 searches).
 */
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const TIMEOUT_MS = 1500;
const NUM_RESULTS = 3;
const HIGHLIGHT_CHARS = 400;
const MAX_QUERY_CHARS = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;
/** ~40/day stays inside Exa's $10 monthly free credit at ~$7 per 1,000. */
const DEFAULT_DAILY_LIMIT = 40;

function parseWebSearchDailyLimit(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function createWebSearchService({
  apiKey,
  enabled = false,
  logger,
  dailyLimit = DEFAULT_DAILY_LIMIT,
  now = () => Date.now(),
} = {}) {
  if (!enabled || !apiKey) {
    return {
      enabled: false,
      search: async () => ({ error: "Web search is not configured." }),
    };
  }

  const cache = new MemoryCache({ now });
  let usageDay = "";
  let usedToday = 0;

  /** Counts every Exa request (failed ones may still bill) per UTC day. */
  function takeDailySlot() {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (day !== usageDay) {
      usageDay = day;
      usedToday = 0;
    }
    if (usedToday >= dailyLimit) return false;
    usedToday += 1;
    return true;
  }

  async function search(query) {
    const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
    if (!q) return { error: "What should I search for?" };

    const cacheKey = q.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    if (!takeDailySlot()) {
      logger.warn({ dailyLimit }, "Web search daily limit reached");
      return { error: "Web search limit reached for today." };
    }

    try {
      const res = await axios.post(
        EXA_SEARCH_URL,
        {
          query: q,
          type: "lite",
          numResults: NUM_RESULTS,
          contents: { highlights: { maxCharacters: HIGHLIGHT_CHARS } },
        },
        {
          headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
          timeout: TIMEOUT_MS,
          httpsAgent: keepAliveAgent,
        }
      );
      const results = (res.data?.results || []).slice(0, NUM_RESULTS).map((r) => ({
        title: r.title,
        source: hostOf(r.url),
        published: r.publishedDate ? String(r.publishedDate).slice(0, 10) : undefined,
        snippet: (r.highlights || []).join(" … ").slice(0, HIGHLIGHT_CHARS),
      }));
      if (!results.length) return { error: "No web results found." };
      return cache.set(cacheKey, { results }, CACHE_TTL_MS);
    } catch (err) {
      logger.warn({ err: err.message, status: err.response?.status }, "Exa web search failed");
      return { error: "Could not search the web right now." };
    }
  }

  return {
    enabled: true,
    search,
  };
}

module.exports = createWebSearchService;
module.exports.parseWebSearchDailyLimit = parseWebSearchDailyLimit;
