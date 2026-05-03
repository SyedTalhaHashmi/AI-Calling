const axios = require("axios");
const { MemoryCache } = require("./cache");

const BASE = "https://api.frankfurter.dev/v2";

function createFxService(enabled, logger) {
  if (!enabled) {
    return {
      enabled: false,
      getRate: async () => ({ error: "Exchange rate service is disabled." }),
    };
  }

  const cache = new MemoryCache();

  async function getRate(base, quote) {
    const from = String(base || "").toUpperCase();
    const to = String(quote || "").toUpperCase();
    if (!from || !to) return { error: "Please share both currencies, like USD to PKR." };

    const cacheKey = `fx:${from}:${to}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get(`${BASE}/rate/${from}/${to}`, { timeout: 1200 });
      const rate = Number(res.data?.rate);
      if (!Number.isFinite(rate)) return { error: "Rate not available right now." };
      const result = { base: from, quote: to, rate };
      return cache.set(cacheKey, result, 15 * 60 * 1000);
    } catch (err) {
      logger.warn({ err: err.message, base: from, quote: to }, "Frankfurter request failed");
      return { error: "Could not fetch exchange rate." };
    }
  }

  return {
    enabled: true,
    getRate,
  };
}

module.exports = createFxService;
