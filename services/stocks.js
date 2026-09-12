/**
 * Alpha Vantage — stocks (GLOBAL_QUOTE), crypto exchange rate, US rates.
 * Free: 5 req/min, 500/day. Cache callers should prefer short TTLs.
 */
const axios = require("axios");

const BASE = "https://www.alphavantage.co/query";

const COMMON_SYMBOLS = {
  apple: "AAPL",
  google: "GOOGL",
  alphabet: "GOOGL",
  microsoft: "MSFT",
  amazon: "AMZN",
  meta: "META",
  facebook: "META",
  tesla: "TSLA",
  nvidia: "NVDA",
  netflix: "NFLX",
};

const CRYPTO_SYMBOLS = {
  bitcoin: "BTC",
  btc: "BTC",
  ethereum: "ETH",
  eth: "ETH",
  solana: "SOL",
  sol: "SOL",
  dogecoin: "DOGE",
  doge: "DOGE",
  ripple: "XRP",
  xrp: "XRP",
  cardano: "ADA",
  ada: "ADA",
};

function createStocksService(apiKey, logger) {
  if (!apiKey) {
    return {
      getQuote: async () => ({ error: "Stocks not configured. Set ALPHAVANTAGE_API_KEY." }),
      getCryptoQuote: async () => ({ error: "Crypto not configured. Set ALPHAVANTAGE_API_KEY." }),
      getUsInterestRate: async () => ({
        error: "Rates not configured. Set ALPHAVANTAGE_API_KEY.",
      }),
      resolveSymbol: () => null,
      resolveCryptoSymbol: () => null,
      enabled: false,
    };
  }

  function resolveSymbol(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const lower = raw.toLowerCase().replace(/\s+/g, " ");

    if (COMMON_SYMBOLS[lower]) return COMMON_SYMBOLS[lower];

    for (const [name, sym] of Object.entries(COMMON_SYMBOLS)) {
      if (new RegExp(`\\b${name}\\b`, "i").test(lower)) return sym;
    }

    const ofMatch = lower.match(
      /\b(?:price|share price|stock|quote|ticker)\s+(?:of\s+)?([a-z0-9.\- ]{2,40})/i
    );
    if (ofMatch) {
      const chunk = ofMatch[1].trim().replace(/\s+/g, " ");
      if (COMMON_SYMBOLS[chunk]) return COMMON_SYMBOLS[chunk];
      const compact = chunk.replace(/\s+/g, "").toUpperCase();
      if (/^[A-Z]{1,5}$/.test(compact)) return compact;
    }

    const howMuch = lower.match(/\bhow much is\s+([a-z0-9.\- ]+?)(?:\s+stock|\s+share|\?|$)/i);
    if (howMuch) {
      const chunk = howMuch[1].trim();
      if (COMMON_SYMBOLS[chunk]) return COMMON_SYMBOLS[chunk];
    }

    const upperOnly = raw.replace(/\s+/g, "").toUpperCase();
    if (/^[A-Z]{1,5}$/.test(upperOnly)) return upperOnly;

    const tickerMatch = raw.match(/\b([A-Z]{1,5})\b/);
    if (tickerMatch && !/^(OKAY|WHAT|ABOUT|THE|PRICE|STOCK|SHARE|HOW|MUCH|IS)$/.test(tickerMatch[1])) {
      return tickerMatch[1];
    }

    return null;
  }

  function resolveCryptoSymbol(text) {
    const lower = String(text || "").toLowerCase();
    for (const [name, sym] of Object.entries(CRYPTO_SYMBOLS)) {
      if (new RegExp(`\\b${name}\\b`, "i").test(lower)) return sym;
    }
    return null;
  }

  async function getQuote(textOrSymbol) {
    const sym = resolveSymbol(textOrSymbol);
    if (!sym) {
      return {
        error:
          "Which stock? Say the company or ticker, for example Apple or A A P L.",
      };
    }
    try {
      const res = await axios.get(BASE, {
        params: { function: "GLOBAL_QUOTE", symbol: sym, apikey: apiKey },
        timeout: 8000,
      });
      const data = res.data;
      const quote = data["Global Quote"];
      if (!quote || !quote["01. symbol"]) {
        return {
          error: `I couldn't get a live quote for ${sym} right now. Try again in a moment.`,
        };
      }
      const price = quote["05. price"];
      const percent = quote["10. change percent"];
      return {
        symbol: quote["01. symbol"],
        price: price ? Number(price) : null,
        changePercent: percent ? percent.replace("%", "") : null,
        message: price
          ? `${quote["01. symbol"]} is $${Number(price).toFixed(2)}${percent ? ", " + percent : ""}.`
          : `I couldn't get a price for ${quote["01. symbol"]} right now.`,
      };
    } catch (err) {
      logger.warn({ err: err.message, symbol: sym }, "Alpha Vantage stock request failed");
      return { error: "I couldn't fetch that stock price right now. Please try again shortly." };
    }
  }

  async function getCryptoQuote(textOrSymbol) {
    const sym = resolveCryptoSymbol(textOrSymbol) || resolveCryptoSymbol(String(textOrSymbol || "").toUpperCase());
    if (!sym) {
      return {
        error: "Which crypto? Say Bitcoin, Ethereum, or another coin name.",
      };
    }
    try {
      const res = await axios.get(BASE, {
        params: {
          function: "CURRENCY_EXCHANGE_RATE",
          from_currency: sym,
          to_currency: "USD",
          apikey: apiKey,
        },
        timeout: 8000,
      });
      const row = res.data?.["Realtime Currency Exchange Rate"];
      const price = row?.["5. Exchange Rate"];
      if (!price) {
        return {
          error: `I couldn't get a live ${sym} price right now. Check a crypto exchange for the latest number.`,
        };
      }
      const n = Number(price);
      const pretty = Number.isFinite(n)
        ? n >= 1
          ? n.toFixed(2)
          : n.toPrecision(4)
        : String(price);
      return {
        symbol: sym,
        price: n,
        message: `${sym} is about $${pretty} U S D right now.`,
      };
    } catch (err) {
      logger.warn({ err: err.message, symbol: sym }, "Alpha Vantage crypto request failed");
      return {
        error: `I couldn't fetch ${sym} right now. Please try again in a moment.`,
      };
    }
  }

  async function getUsInterestRate() {
    try {
      const res = await axios.get(BASE, {
        params: {
          function: "FEDERAL_FUNDS_RATE",
          interval: "monthly",
          apikey: apiKey,
        },
        timeout: 8000,
      });
      const series = res.data?.data;
      if (!Array.isArray(series) || !series.length || series[0].value == null) {
        return {
          error:
            "I couldn't fetch the latest Fed rate right now. Many U S savings rates are often around four to five percent — check your bank for exact APY.",
        };
      }
      const latest = series[0];
      const value = Number(latest.value);
      const date = latest.date || "recently";
      if (!Number.isFinite(value)) {
        return {
          error:
            "I couldn't read the Fed rate just now. Many banks offer savings around four to five percent — confirm with your bank.",
        };
      }
      return {
        rate: value,
        date,
        message: `The latest U S Federal Funds rate is about ${value.toFixed(2)} percent as of ${date}. Bank savings APYs vary, often near that range — check your bank for the exact rate.`,
      };
    } catch (err) {
      logger.warn({ err: err.message }, "Alpha Vantage rates request failed");
      return {
        error:
          "I couldn't fetch live U S rates right now. Many savings accounts are around four to five percent — check your bank for the latest APY.",
      };
    }
  }

  return {
    getQuote,
    getCryptoQuote,
    getUsInterestRate,
    resolveSymbol,
    resolveCryptoSymbol,
    enabled: true,
  };
}

module.exports = createStocksService;
