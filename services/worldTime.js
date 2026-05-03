const axios = require("axios");
const { MemoryCache } = require("./cache");

const BASE = "https://world-time-api3.p.rapidapi.com/api";

function createWorldTimeService(rapidApiKey, host, logger) {
  if (!rapidApiKey) {
    return {
      enabled: false,
      getTimeByTimezone: async () => ({ error: "World time API is not configured." }),
    };
  }

  const cache = new MemoryCache();
  const apiHost = host || "world-time-api3.p.rapidapi.com";

  async function getTimeByTimezone(timezone) {
    const tz = String(timezone || "").trim();
    if (!tz) return { error: "Please share a timezone." };
    const cacheKey = `time:${tz.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get(`${BASE}/timezone/${encodeURIComponent(tz)}`, {
        headers: {
          "x-rapidapi-key": rapidApiKey,
          "x-rapidapi-host": apiHost,
        },
        timeout: 1200,
      });
      const data = res.data || {};
      const out = {
        timezone: data.timezone || tz,
        datetime: data.datetime || "",
      };
      return cache.set(cacheKey, out, 30 * 1000);
    } catch (err) {
      logger.warn({ err: err.message, timezone: tz }, "World time API failed");
      return { error: "Could not fetch world time." };
    }
  }

  return {
    enabled: true,
    getTimeByTimezone,
  };
}

module.exports = createWorldTimeService;
