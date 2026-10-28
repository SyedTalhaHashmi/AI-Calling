/**
 * ISO codes callers actually say. Deliberately not Intl's full list, which includes
 * English words (ALL, TOP, CUP, TRY) that would be misread as currencies.
 */
const CURRENCY_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "CNY", "INR", "PKR", "AED", "SAR", "COP", "MXN", "BRL", "ARS",
  "CLP", "PEN", "UYU", "DOP", "CRC", "GTQ", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK",
  "PLN", "CZK", "HUF", "KRW", "HKD", "SGD", "THB", "IDR", "MYR", "PHP", "ZAR", "ILS", "TWD",
]);

function isCurrencyCode(word) {
  return CURRENCY_CODES.has(String(word || "").toUpperCase());
}

module.exports = { CURRENCY_CODES, isCurrencyCode };
