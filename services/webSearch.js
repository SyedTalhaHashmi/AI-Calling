const axios = require("axios");
const { MemoryCache } = require("./cache");
const { keepAliveAgent } = require("../utils/httpAgent");

/**
 * Web search for live questions no other lookup covers (regex and tools mode).
 * Off unless WEB_SEARCH_ENABLED=true and at least one key is set.
 *
 * Exa first (lowest-cost "lite" search, 3 short highlights, ~$7 per 1,000), Tavily as the backup
 * (basic search, 1 credit). Tavily is tried only when Exa can't serve the search: no Exa key, Exa's
 * daily cap used up, or an Exa HTTP error (out of credit, rate limit, server error). An Exa timeout
 * is NOT retried on Tavily — the caller would sit through two searches.
 */
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const EXA_TIMEOUT_MS = 1500;
/** Tavily runs after a fast Exa failure; a little more room, still short for a phone call. */
const TAVILY_TIMEOUT_MS = 2000;
const NUM_RESULTS = 3;
const HIGHLIGHT_CHARS = 400;
const MAX_QUERY_CHARS = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;
/** ~40/day stays inside Exa's $10 monthly free credit at ~$7 per 1,000. */
const DEFAULT_DAILY_LIMIT = 40;
/** ~30/day stays inside Tavily's 1,000 free credits a month. */
const DEFAULT_TAVILY_DAILY_LIMIT = 30;

function parseDailyLimit(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseWebSearchDailyLimit(value) {
  return parseDailyLimit(value, DEFAULT_DAILY_LIMIT);
}

function parseTavilyDailyLimit(value) {
  return parseDailyLimit(value, DEFAULT_TAVILY_DAILY_LIMIT);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isTimeout(err) {
  return err?.code === "ECONNABORTED" || err?.code === "ETIMEDOUT" || /timeout/i.test(err?.message || "");
}

const PROVIDERS = {
  exa: {
    label: "Exa",
    async request(q, apiKey) {
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
          timeout: EXA_TIMEOUT_MS,
          httpsAgent: keepAliveAgent,
        }
      );
      return (res.data?.results || []).slice(0, NUM_RESULTS).map((r) => ({
        title: r.title,
        source: hostOf(r.url),
        published: r.publishedDate ? String(r.publishedDate).slice(0, 10) : undefined,
        snippet: (r.highlights || []).join(" … ").slice(0, HIGHLIGHT_CHARS),
      }));
    },
  },
  tavily: {
    label: "Tavily",
    async request(q, apiKey) {
      const res = await axios.post(
        TAVILY_SEARCH_URL,
        {
          query: q,
          search_depth: "basic",
          max_results: NUM_RESULTS,
          include_answer: false,
          include_raw_content: false,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          timeout: TAVILY_TIMEOUT_MS,
          httpsAgent: keepAliveAgent,
        }
      );
      return (res.data?.results || []).slice(0, NUM_RESULTS).map((r) => ({
        title: r.title,
        source: hostOf(r.url),
        published: r.published_date ? String(r.published_date).slice(0, 10) : undefined,
        snippet: String(r.content || "").slice(0, HIGHLIGHT_CHARS),
      }));
    },
  },
};

function createWebSearchService({
  /** Exa key (older name kept for existing callers). */
  apiKey,
  exaApiKey = apiKey,
  tavilyApiKey,
  enabled = false,
  logger,
  dailyLimit = DEFAULT_DAILY_LIMIT,
  tavilyDailyLimit = DEFAULT_TAVILY_DAILY_LIMIT,
  now = () => Date.now(),
} = {}) {
  const providers = [
    exaApiKey && { name: "exa", apiKey: exaApiKey, limit: dailyLimit },
    tavilyApiKey && { name: "tavily", apiKey: tavilyApiKey, limit: tavilyDailyLimit },
  ]
    .filter(Boolean)
    .map((p) => ({ ...p, ...PROVIDERS[p.name], usageDay: "", usedToday: 0 }));

  if (!enabled || !providers.length) {
    return {
      enabled: false,
      providers: [],
      search: async () => ({ error: "Web search is not configured." }),
    };
  }

  const cache = new MemoryCache({ now });

  /** Counts every request (failed ones may still bill) per UTC day, per provider. */
  function takeDailySlot(p) {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (day !== p.usageDay) {
      p.usageDay = day;
      p.usedToday = 0;
    }
    if (p.usedToday >= p.limit) return false;
    p.usedToday += 1;
    return true;
  }

  async function search(query) {
    const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
    if (!q) return { error: "What should I search for?" };

    const cacheKey = q.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    let limited = 0;
    for (const p of providers) {
      if (!takeDailySlot(p)) {
        limited += 1;
        logger.warn({ provider: p.name, dailyLimit: p.limit }, `${p.label} web search daily limit reached`);
        continue;
      }
      try {
        const results = await p.request(q, p.apiKey);
        if (!results.length) return { error: "No web results found." };
        return cache.set(cacheKey, { provider: p.name, results }, CACHE_TTL_MS);
      } catch (err) {
        logger.warn({ provider: p.name, err: err.message, status: err.response?.status }, `${p.label} web search failed`);
        if (isTimeout(err)) return { error: "Could not search the web right now." };
      }
    }
    if (limited === providers.length) return { error: "Web search limit reached for today." };
    return { error: "Could not search the web right now." };
  }

  return {
    enabled: true,
    providers: providers.map((p) => p.name),
    search,
  };
}

module.exports = createWebSearchService;
module.exports.parseWebSearchDailyLimit = parseWebSearchDailyLimit;
module.exports.parseTavilyDailyLimit = parseTavilyDailyLimit;
