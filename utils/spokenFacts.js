/**
 * Fast-path facts worded for the ear: units and place names spelled out, no airport,
 * airline, or currency codes read aloud.
 */
const { CITY_IATA_ENTRIES } = require("./intentRouter");

/** Countries that use Fahrenheit day to day. */
const FAHRENHEIT_COUNTRIES = new Set(["US", "PR", "GU", "VI", "AS", "MP", "BS", "KY", "BZ", "PW", "FM", "MH", "LR"]);

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code) {
  if (!code) return "";
  try {
    return regionNames.of(String(code).toUpperCase()) || "";
  } catch {
    return "";
  }
}

const toFahrenheit = (c) => Math.round((Number(c) * 9) / 5 + 32);

/**
 * "81 degrees Fahrenheit and clear sky in Miami, Florida, humidity 80%".
 * Callers on a +1 number also hear Fahrenheit for foreign cities.
 */
function formatWeatherFact(result, { callerNumber } = {}) {
  if (result.error) return result.error;
  const country = String(result.country || "").toUpperCase();
  const usesF = FAHRENHEIT_COUNTRIES.has(country);
  const region = usesF ? result.admin1 || countryName(country) : countryName(country) || country;
  const where = [result.city, region].filter(Boolean).join(", ");
  let temp;
  if (usesF) {
    temp = `${toFahrenheit(result.temp)} degrees Fahrenheit`;
  } else if (/^\+1/.test(String(callerNumber || ""))) {
    temp = `${result.temp} degrees Celsius, about ${toFahrenheit(result.temp)} Fahrenheit,`;
  } else {
    temp = `${result.temp} degrees Celsius`;
  }
  const humidity = result.humidity != null ? `, humidity ${result.humidity}%` : "";
  return `${temp} and ${result.description} in ${where}${humidity}`;
}

/** Spoken city name for an IATA city/airport code from the router's table ("BOG" → "Bogotá"). */
const CITY_NAMES = {};
for (const [name, code] of [...CITY_IATA_ENTRIES].reverse()) {
  // Accented spellings come first in the table; reverse so they win
  CITY_NAMES[code] = name.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}
CITY_NAMES.FCO = "Rome";
CITY_NAMES.JFK = "New York";
CITY_NAMES.LHR = "London";
CITY_NAMES.CDG = "Paris";

function cityName(code) {
  return CITY_NAMES[String(code || "").toUpperCase()] || String(code || "");
}

/** Airlines callers ask about most; unknown codes are left out rather than read as letters. */
const AIRLINES = {
  AV: "Avianca",
  AA: "American Airlines",
  DL: "Delta",
  UA: "United",
  B6: "JetBlue",
  NK: "Spirit",
  F9: "Frontier",
  WN: "Southwest",
  AS: "Alaska Airlines",
  CM: "Copa Airlines",
  LA: "LATAM",
  P5: "Wingo",
  JA: "JetSMART",
  AM: "Aeromexico",
  Y4: "Volaris",
  VB: "Viva Aerobus",
  AC: "Air Canada",
  WS: "WestJet",
  IB: "Iberia",
  UX: "Air Europa",
  VY: "Vueling",
  AZ: "ITA Airways",
  FR: "Ryanair",
  U2: "easyJet",
  W6: "Wizz Air",
  BA: "British Airways",
  AF: "Air France",
  KL: "KLM",
  LH: "Lufthansa",
  LX: "Swiss",
  TP: "TAP Air Portugal",
  TK: "Turkish Airlines",
  EK: "Emirates",
  QR: "Qatar Airways",
  EY: "Etihad",
  PK: "PIA",
  PA: "airblue",
  ER: "SereneAir",
  AI: "Air India",
  "6E": "IndiGo",
  SQ: "Singapore Airlines",
};

function airlineName(code) {
  return AIRLINES[String(code || "").toUpperCase()] || "";
}

const CURRENCY_WORDS = { USD: "US dollars", EUR: "euros", GBP: "British pounds", COP: "Colombian pesos", MXN: "Mexican pesos" };

/**
 * "The cheapest recent fare from Bogotá to Miami is about 410 US dollars, round trip, on Avianca.
 *  That's from recent searches, not your exact dates."
 */
function formatFareFact(result) {
  if (result.error) return result.error;
  const money = `${Math.round(result.price)} ${CURRENCY_WORDS[result.currency] || result.currency}`;
  const trip = result.returnAt ? "round trip" : "one-way";
  const airline = airlineName(result.airline);
  return (
    `The cheapest recent fare from ${cityName(result.origin)} to ${cityName(result.destination)} is about ${money}, ${trip}` +
    `${airline ? `, on ${airline}` : ""}. That's from recent searches, not your exact dates, so check Google Flights for your days.`
  );
}

/** Google Places priceLevel (already in the field mask) as a word; unknown / unspecified → "". */
const PRICE_LEVEL_WORDS = {
  PRICE_LEVEL_INEXPENSIVE: "budget",
  PRICE_LEVEL_MODERATE: "mid-range",
  PRICE_LEVEL_EXPENSIVE: "expensive",
  PRICE_LEVEL_VERY_EXPENSIVE: "luxury",
};

/** "Four Seasons Hotel Miami, rated 4.7, luxury; Mayfair House, rated 4.6" */
function placesList(places) {
  return places
    .map((p) => [p.name, `rated ${p.rating || "N A"}`, PRICE_LEVEL_WORDS[p.priceLevel]].filter(Boolean).join(", "))
    .join("; ");
}

/** Hotel or restaurant list for a city. */
function formatPlacesFact(result, { kind, city }) {
  if (result.error) return result.error;
  const where = city ? ` in ${city}` : "";
  return `Popular ${kind === "hotel" ? "hotels" : "restaurants"}${where}: ${placesList(result.places)}.`;
}

/**
 * Hotel price questions: no service we use has nightly rates (Places has names, ratings, and a
 * price level; Travelpayouts closed its hotel API), so the model gives a typical range from general
 * knowledge, clearly labelled as not live, next to the real hotels found. A trip ask says its
 * looked-up fare first, word for word.
 */
function hotelPriceInstruction(langName, { city, places = [], fareFact = "", question = "" }) {
  // Live test: the model priced named hotels ("Four Seasons… $500 to $800") — those would be guesses
  const hotels = places.length
    ? ` These hotels are real search results; name up to two of them with their rating and the price word given, if any: ${placesList(places)}.` +
      ` Never give a price or a price level for a named hotel beyond what is given here.`
    : "";
  return (
    `Reply in ${langName} only, in up to ${fareFact ? 70 : 50} words; this is a phone call, so keep it short.` +
    (fareFact ? ` First say this fare, keeping every name and number: ${fareFact}` : "") +
    ` Then give a typical nightly price range for hotels in ${city} from general knowledge (budget, mid-range, and luxury), ` +
    `in US dollars unless they used another currency.${hotels}` +
    ` If they named a budget, say honestly whether it's realistic there.` +
    ` Say clearly these are typical prices, not live rates, and that Booking dot com or Expedia show exact prices for their dates.` +
    ` This is your whole answer: don't say you'll check or look anything up, and don't ask them to hold on.` +
    ` The caller asked: "${String(question).slice(0, 200)}"`
  );
}

module.exports = {
  formatWeatherFact,
  formatFareFact,
  formatPlacesFact,
  hotelPriceInstruction,
  airlineName,
  cityName,
  countryName,
};
