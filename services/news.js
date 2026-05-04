const axios = require("axios");
const { MemoryCache } = require("./cache");

const BASE = "https://newsapi.org/v2";

const COUNTRY_NAME_TO_CODE = {
  colombia: "co",
  mexico: "mx",
  spain: "es",
  france: "fr",
  germany: "de",
  italy: "it",
  brazil: "br",
  argentina: "ar",
  chile: "cl",
  peru: "pe",
  india: "in",
  pakistan: "pk",
  "united states": "us",
  usa: "us",
  "united kingdom": "gb",
  uk: "gb",
  canada: "ca",
  australia: "au",
};

function createNewsService(apiKey, logger) {
  if (!apiKey) {
    return {
      enabled: false,
      topHeadlines: async () => ({ error: "News API is not configured." }),
    };
  }

  const cache = new MemoryCache();

  async function topHeadlines(query, language = "en") {
    const raw = String(query || "").trim().toLowerCase();
    const countryCode = COUNTRY_NAME_TO_CODE[raw] || null;
    const cacheKey = `news:${language}:${countryCode || raw}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      let endpoint = "top-headlines";
      let params = { pageSize: 5 };
      if (countryCode) {
        params.country = countryCode;
      } else if (raw) {
        endpoint = "everything";
        params = { q: raw, language, sortBy: "publishedAt", pageSize: 5 };
      } else {
        params.language = language;
      }
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
