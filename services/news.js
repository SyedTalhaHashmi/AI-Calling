const axios = require("axios");
const { MemoryCache } = require("./cache");

const BASE = "https://newsapi.org/v2";

function createNewsService(apiKey, logger) {
  if (!apiKey) {
    return {
      enabled: false,
      topHeadlines: async () => ({ error: "News API is not configured." }),
    };
  }

  const cache = new MemoryCache();

  async function topHeadlines(query, language = "en") {
    const q = String(query || "").trim().toLowerCase();
    const cacheKey = `news:${language}:${q}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const endpoint = q ? "everything" : "top-headlines";
      const params = q
        ? { q, language, sortBy: "publishedAt", pageSize: 3 }
        : { language, pageSize: 3 };
      const res = await axios.get(`${BASE}/${endpoint}`, {
        params,
        headers: { "X-Api-Key": apiKey },
        timeout: 1500,
      });
      const articles = (res.data?.articles || [])
        .slice(0, 3)
        .map((a) => ({
          title: a.title,
          source: a.source?.name,
          publishedAt: a.publishedAt,
        }));
      if (!articles.length) return { error: "No fresh news found right now." };
      const result = { articles };
      return cache.set(cacheKey, result, 90 * 1000);
    } catch (err) {
      logger.warn({ err: err.message, query }, "News API request failed");
      return { error: "Could not fetch the latest news." };
    }
  }

  return {
    enabled: true,
    topHeadlines,
  };
}

module.exports = createNewsService;
