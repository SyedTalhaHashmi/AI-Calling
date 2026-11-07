const axios = require("axios");
const { MemoryCache } = require("./cache");
const { keepAliveAgent } = require("../utils/httpAgent");
const { isCurrencyCode } = require("../utils/currencyCodes");

const BASE = "https://api.frankfurter.dev/v2";
/** Per attempt; one retry on timeout / network / 5xx keeps the worst case near 2 s. */
const ATTEMPT_TIMEOUT_MS = 1000;

/** Map spoken currency words to ISO codes (Frankfurter-supported majors). */
function wordToIso(token) {
  const raw = String(token || "")
    .toLowerCase()
    .trim()
    .replace(/[?.!,;:]+$/g, "");
  if (!raw) return null;
  if (isCurrencyCode(raw)) return raw.toUpperCase();
  if (/\b(us\s*)?dollar(s)?\b|\bd[oó]lar(es)?\b|\busd\b|\$\b/.test(raw)) return "USD";
  if (/\beuro?s?\b|\beur\b/.test(raw)) return "EUR";
  if (/\bpound(s)?\b|\bgbp\b|\bsterling\b/.test(raw)) return "GBP";
  if (/\bmexican\s*peso(s)?\b|\bmxn\b/.test(raw)) return "MXN";
  if (/\bchilean\s*peso(s)?\b|\bclp\b/.test(raw)) return "CLP";
  if (/\bcolombian\s*peso(s)?\b|\bcop\b/.test(raw)) return "COP";
  if (/\bpeso(s)?\b/.test(raw)) return "COP";
  if (/\b(real|reais)\b|\bbrl\b/.test(raw)) return "BRL";
  if (/\b(yen|jpy)\b/.test(raw)) return "JPY";
  if (/\b(yuan|rmb|cny)\b/.test(raw)) return "CNY";
  if (/\b(inr|rupee|rupees)\b/.test(raw)) return "INR";
  if (/\b(pkr|pakistani)\b/.test(raw)) return "PKR";
  return null;
}

/**
 * Parse base/quote from natural phrases: "pesos to dollars", "COP to USD", "from euros to pounds".
 */
function parsePairFromUtterance(text) {
  const t = String(text || "");
  const codes = (t.toUpperCase().match(/\b[A-Z]{3}\b/g) || []).filter(isCurrencyCode);
  if (codes.length >= 2) return { base: codes[0], quote: codes[1] };

  let m = t.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\?|\.|!|$)/i);
  if (m) {
    const base = wordToIso(m[1]);
    const quote = wordToIso(m[2]);
    if (base && quote) return { base, quote };
  }
  // "dollars to pesos", "a dollar in pesos", "dollar to Mexican peso" (two-word quote)
  const toMatches = [...t.matchAll(/\b([\w]+)\s+(?:to|in|into)\s+([\w]+(?:\s+[\w]+)?)\b/gi)];
  for (let i = toMatches.length - 1; i >= 0; i--) {
    const base = wordToIso(toMatches[i][1]);
    const quote = wordToIso(toMatches[i][2]);
    if (base && quote) return { base, quote };
  }
  // "How many Colombian pesos is one U.S. dollar?" / "¿Cuántos pesos es un dólar?" — rate of the second
  // in the first (live replay 2026-11-02: answered "Please share both currencies")
  m = t.match(
    /\b(?:how\s+many|cu[aá]ntos)\s+(.+?)\s+(?:is|are|for|per|equals?|makes?|es|son|vale|por|hay\s+en)\s+(?:a|an|one|1|un|uno)?\s*(.+?)(?:\s+(?:today|now|right now|hoy|ahora))?\s*[?.!]*\s*$/i
  );
  if (m) {
    const quote = wordToIso(m[1]);
    const base = wordToIso(m[2]);
    if (base && quote && base !== quote) return { base, quote };
  }
  return { base: null, quote: null };
}

/**
 * A rate rounded for speech: 3176.91 → 3177, 0.9234 → 0.92, 0.000315 → 0.0003150. Live replay
 * 2026-11-02: "One USD equals 3176.9100 COP" / "three thousand one hundred seventy-six point nine one".
 */
function roundRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r)) return rate;
  if (Math.abs(r) >= 100) return Math.round(r);
  if (Math.abs(r) >= 1) return Math.round(r * 100) / 100;
  return Number(r.toPrecision(4));
}

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
const PLURAL_NAMES = { USD: "US dollars", EUR: "euros", GBP: "British pounds", COP: "Colombian pesos", MXN: "Mexican pesos", CLP: "Chilean pesos", BRL: "Brazilian reais", INR: "Indian rupees", PKR: "Pakistani rupees", CAD: "Canadian dollars", AUD: "Australian dollars" };
const SINGULAR_NAMES = { USD: "US dollar", EUR: "euro", GBP: "British pound", COP: "Colombian peso", MXN: "Mexican peso" };

function currencyName(code, plural) {
  const c = String(code || "").toUpperCase();
  const known = plural ? PLURAL_NAMES[c] : SINGULAR_NAMES[c];
  if (known) return known;
  try {
    return currencyNames.of(c) || c;
  } catch {
    return c;
  }
}

/** "One US dollar is about 3,177 Colombian pesos." */
function spokenRate(result) {
  const n = roundRate(result.rate);
  return `One ${currencyName(result.base, false)} is about ${Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${currencyName(result.quote, true)}.`;
}

/** Timeouts, dropped connections and 5xx are worth one retry; a 4xx (bad pair) is not. */
function isRetryable(err) {
  const status = err?.response?.status;
  return status ? status >= 500 : true;
}

function createFxService(enabled, logger) {
  if (!enabled) {
    return {
      enabled: false,
      getRate: async () => ({ error: "Exchange rate service is disabled." }),
      parsePairFromUtterance,
    };
  }

  const cache = new MemoryCache();

  async function getRate(base, quote) {
    const from = String(base || "").toUpperCase();
    const to = String(quote || "").toUpperCase();
    if (!from || !to) return { error: "Which two currencies? For example, dollars to Colombian pesos." };

    const cacheKey = `fx:${from}:${to}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const fetchRate = () =>
      axios.get(`${BASE}/rate/${from}/${to}`, {
        timeout: ATTEMPT_TIMEOUT_MS,
        httpsAgent: keepAliveAgent,
      });
    try {
      let res;
      try {
        res = await fetchRate();
      } catch (err) {
        if (!isRetryable(err)) throw err;
        res = await fetchRate();
      }
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
    parsePairFromUtterance,
  };
}

module.exports = createFxService;
module.exports.roundRate = roundRate;
module.exports.spokenRate = spokenRate;
