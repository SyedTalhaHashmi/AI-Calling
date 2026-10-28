/**
 * Current time — no API, uses the server clock and Node's built-in time-zone data.
 * resolvePlace("what time is it in Bogotá") → { timezone: "America/Bogota", label: "Bogotá" };
 * unknown or missing place → null (callers ask "Which city?" — never answer UTC as local time).
 */
const {
  findCountryInText,
  defaultCityForCountry,
} = require("../utils/placeResolve");

/** Cities callers name that are not themselves IANA zone names (plus legacy spellings). */
const CITY_ALIASES = {
  "new york": "America/New_York",
  "washington": "America/New_York",
  "washington dc": "America/New_York",
  "miami": "America/New_York",
  "orlando": "America/New_York",
  "tampa": "America/New_York",
  "atlanta": "America/New_York",
  "boston": "America/New_York",
  "philadelphia": "America/New_York",
  "houston": "America/Chicago",
  "dallas": "America/Chicago",
  "austin": "America/Chicago",
  "san antonio": "America/Chicago",
  "san francisco": "America/Los_Angeles",
  "las vegas": "America/Los_Angeles",
  "seattle": "America/Los_Angeles",
  "san diego": "America/Los_Angeles",
  "medellin": "America/Bogota",
  "cali": "America/Bogota",
  "cartagena": "America/Bogota",
  "barranquilla": "America/Bogota",
  "pereira": "America/Bogota",
  "bucaramanga": "America/Bogota",
  "quito": "America/Guayaquil",
  "guadalajara": "America/Mexico_City",
  "ciudad de mexico": "America/Mexico_City",
  "cdmx": "America/Mexico_City",
  "rio de janeiro": "America/Sao_Paulo",
  "buenos aires": "America/Buenos_Aires",
  "cordoba": "America/Argentina/Cordoba",
  "mendoza": "America/Argentina/Mendoza",
  "montreal": "America/Toronto",
  "barcelona": "Europe/Madrid",
  "sevilla": "Europe/Madrid",
  "kyiv": "Europe/Kiev",
  "india": "Asia/Kolkata",
  "delhi": "Asia/Kolkata",
  "new delhi": "Asia/Kolkata",
  "mumbai": "Asia/Kolkata",
  "bangalore": "Asia/Kolkata",
  "kolkata": "Asia/Kolkata",
  "islamabad": "Asia/Karachi",
  "lahore": "Asia/Karachi",
  "beijing": "Asia/Shanghai",
  "tel aviv": "Asia/Jerusalem",
  "saigon": "Asia/Saigon",
  "ho chi minh city": "Asia/Saigon",
  "california": "America/Los_Angeles",
  "texas": "America/Chicago",
  "florida": "America/New_York",
  "new jersey": "America/New_York",
  "arizona": "America/Phoenix",
  "hawaii": "Pacific/Honolulu",
  "alaska": "America/Anchorage",
};

/** Zone city names that are also everyday words — never matched on their own. */
const ZONE_WORD_STOPLIST = new Set([
  "wake", "midway", "easter", "christmas", "reunion", "resolute", "jersey",
  "center", "knox", "marengo", "petersburg", "vevay", "winamac", "beulah", "oral",
]);

const ZONE_REGIONS = new Set(["Africa", "America", "Asia", "Atlantic", "Australia", "Europe", "Indian", "Pacific"]);
const MAX_PLACE_WORDS = 4;

function normalizeWord(word) {
  return word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function titleCase(words) {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** normalized place name → IANA zone, built once from Node's zone list + aliases. */
function buildPlaceIndex() {
  const index = new Map();
  for (const zone of Intl.supportedValuesOf("timeZone")) {
    const parts = zone.split("/");
    if (parts.length !== 2 || !ZONE_REGIONS.has(parts[0])) continue;
    const name = normalizeWord(parts[1].replace(/_/g, " ")).replace(/-/g, " ");
    if (!ZONE_WORD_STOPLIST.has(name)) index.set(name, zone);
  }
  for (const [name, zone] of Object.entries(CITY_ALIASES)) index.set(name, zone);
  return index;
}

const PLACE_INDEX = buildPlaceIndex();

function getCurrentTime(timezone) {
  const tz = timezone || "UTC";
  try {
    const time = Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeStyle: "short",
      hour12: true,
    }).format(new Date());
    return { time, timezone: tz };
  } catch {
    return { time: new Date().toLocaleTimeString("en-US", { hour12: true }), timezone: "UTC" };
  }
}

/** City first (longest phrase wins), then country → its main city's zone; else null. */
function resolvePlace(text) {
  const words = String(text || "").match(/[\p{L}]+/gu) || [];
  const norm = words.map(normalizeWord);
  let best = null;
  for (let i = 0; i < norm.length; i++) {
    for (let n = Math.min(MAX_PLACE_WORDS, norm.length - i); n >= 1; n--) {
      const zone = PLACE_INDEX.get(norm.slice(i, i + n).join(" "));
      if (zone && (!best || n > best.n)) {
        best = { n, timezone: zone, label: titleCase(words.slice(i, i + n)) };
        break;
      }
    }
  }
  if (best) return { timezone: best.timezone, label: best.label };

  const country = findCountryInText(text);
  if (country?.code) {
    const city = defaultCityForCountry(country.code);
    const zone = city ? PLACE_INDEX.get(normalizeWord(city)) : null;
    if (zone) return { timezone: zone, label: titleCase(country.name.split(/\s+/)) };
  }
  return null;
}

function createTimeService() {
  return {
    enabled: true,
    getCurrentTime,
    resolvePlace,
    /** IANA zone for a spoken place, or null when unknown/missing. */
    resolveTimezone(text) {
      return resolvePlace(text)?.timezone || null;
    },
  };
}

module.exports = createTimeService;
