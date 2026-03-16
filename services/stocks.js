/**
 * Alpha Vantage — stock quote (GLOBAL_QUOTE).
 * Free: 5 req/min, 500/day.
 */
const axios = require("axios");

const BASE = "https://www.alphavantage.co/query";

const COMMON_SYMBOLS = {
  apple: "AAPL",
  google: "GOOGL",
  microsoft: "MSFT",
  amazon: "AMZN",
  meta: "META",
  tesla: "TSLA",
  nvidia: "NVDA",
  netflix: "NFLX",
};

function createStocksService(apiKey, logger) {
  if (!apiKey) {
    return {
      getQuote: async () => ({ error: "Stocks not configured. Set ALPHAVANTAGE_API_KEY." }),
      enabled: false,
    };
  }

  function resolveSymbol(text) {
    const t = (text || "").toLowerCase().trim();
    const word = t.replace(/\s+/g, " ");
    if (COMMON_SYMBOLS[word]) return COMMON_SYMBOLS[word];
    const upper = text.replace(/\s+/g, "").toUpperCase();
    if (/^[A-Z]{1,5}$/.test(upper)) return upper;
    const match = text.match(/\b([A-Z]{1,5})\b/);
    return match ? match[1].toUpperCase() : null;
  }

  async function getQuote(symbol) {
    const sym = resolveSymbol(symbol) || symbol?.toUpperCase();
    if (!sym) {
      return { error: "Which stock? Say the symbol or company name, like Apple or A A P L." };
    }
    try {
      const res = await axios.get(BASE, {
        params: { function: "GLOBAL_QUOTE", symbol: sym, apikey: apiKey },
        timeout: 8000,
      });
      const data = res.data;
      const quote = data["Global Quote"];
      if (!quote || !quote["01. symbol"]) {
        return { error: `No quote found for ${sym}.` };
      }
      const price = quote["05. price"];
      const change = quote["09. change"];
      const percent = quote["10. change percent"];
      return {
        symbol: quote["01. symbol"],
        price: price ? Number(price) : null,
        change: change ? Number(change) : null,
        changePercent: percent ? percent.replace("%", "") : null,
        message: price
          ? `${quote["01. symbol"]} is $${Number(price).toFixed(2)}${percent ? ", " + percent : ""}.`
          : `No price for ${quote["01. symbol"]}.`,
      };
    } catch (err) {
      logger.warn({ err: err.message, symbol: sym }, "Alpha Vantage request failed");
      return { error: "Could not fetch stock price." };
    }
  }

  return {
    getQuote,
    resolveSymbol,
    enabled: true,
  };
}

module.exports = createStocksService;
