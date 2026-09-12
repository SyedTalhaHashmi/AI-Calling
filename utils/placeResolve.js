/**
 * Country/region → ISO 3166-1 alpha-2 and default city for weather disambiguation.
 * Keeps Open-Meteo / OpenWeather from picking the wrong "San Juan", "London", etc.
 */

/** Lowercase name/alias → ISO2 */
const COUNTRY_ALIASES = {
  // Americas
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  america: "US",
  canada: "CA",
  mexico: "MX",
  méxico: "MX",
  brazil: "BR",
  brasil: "BR",
  argentina: "AR",
  chile: "CL",
  colombia: "CO",
  peru: "PE",
  perú: "PE",
  venezuela: "VE",
  ecuador: "EC",
  bolivia: "BO",
  paraguay: "PY",
  uruguay: "UY",
  "costa rica": "CR",
  panama: "PA",
  panamá: "PA",
  guatemala: "GT",
  honduras: "HN",
  "el salvador": "SV",
  nicaragua: "NI",
  cuba: "CU",
  "dominican republic": "DO",
  "republica dominicana": "DO",
  "república dominicana": "DO",
  jamaica: "JM",
  haiti: "HT",
  haïti: "HT",
  "puerto rico": "PR",
  "porto rico": "PR",
  trinidad: "TT",
  "trinidad and tobago": "TT",
  bahamas: "BS",
  barbados: "BB",
  // Europe
  "united kingdom": "GB",
  uk: "GB",
  britain: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  ireland: "IE",
  france: "FR",
  germany: "DE",
  deutschland: "DE",
  spain: "ES",
  españa: "ES",
  italy: "IT",
  italia: "IT",
  portugal: "PT",
  netherlands: "NL",
  holland: "NL",
  belgium: "BE",
  switzerland: "CH",
  austria: "AT",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  poland: "PL",
  "czech republic": "CZ",
  czechia: "CZ",
  greece: "GR",
  turkey: "TR",
  türkiye: "TR",
  russia: "RU",
  ukraine: "UA",
  romania: "RO",
  hungary: "HU",
  // Middle East / Africa
  "saudi arabia": "SA",
  uae: "AE",
  "united arab emirates": "AE",
  dubai: "AE",
  qatar: "QA",
  kuwait: "KW",
  bahrain: "BH",
  oman: "OM",
  israel: "IL",
  egypt: "EG",
  "south africa": "ZA",
  nigeria: "NG",
  kenya: "KE",
  morocco: "MA",
  ghana: "GH",
  ethiopia: "ET",
  // Asia / Pacific
  india: "IN",
  pakistan: "PK",
  bangladesh: "BD",
  "sri lanka": "LK",
  nepal: "NP",
  china: "CN",
  japan: "JP",
  "south korea": "KR",
  korea: "KR",
  "hong kong": "HK",
  taiwan: "TW",
  singapore: "SG",
  malaysia: "MY",
  thailand: "TH",
  vietnam: "VN",
  philippines: "PH",
  indonesia: "ID",
  australia: "AU",
  "new zealand": "NZ",
};

/** When caller names only a country/territory, use a sensible default city. */
const COUNTRY_DEFAULT_CITY = {
  US: "Washington",
  CA: "Toronto",
  MX: "Mexico City",
  BR: "Sao Paulo",
  AR: "Buenos Aires",
  CL: "Santiago",
  CO: "Bogota",
  PE: "Lima",
  PR: "San Juan",
  DO: "Santo Domingo",
  CU: "Havana",
  JM: "Kingston",
  GB: "London",
  IE: "Dublin",
  FR: "Paris",
  DE: "Berlin",
  ES: "Madrid",
  IT: "Rome",
  PT: "Lisbon",
  NL: "Amsterdam",
  BE: "Brussels",
  CH: "Zurich",
  AT: "Vienna",
  SE: "Stockholm",
  NO: "Oslo",
  DK: "Copenhagen",
  FI: "Helsinki",
  PL: "Warsaw",
  GR: "Athens",
  TR: "Istanbul",
  RU: "Moscow",
  UA: "Kyiv",
  AE: "Dubai",
  SA: "Riyadh",
  QA: "Doha",
  IL: "Tel Aviv",
  EG: "Cairo",
  ZA: "Johannesburg",
  NG: "Lagos",
  KE: "Nairobi",
  IN: "Delhi",
  PK: "Karachi",
  BD: "Dhaka",
  CN: "Beijing",
  JP: "Tokyo",
  KR: "Seoul",
  HK: "Hong Kong",
  TW: "Taipei",
  SG: "Singapore",
  MY: "Kuala Lumpur",
  TH: "Bangkok",
  VN: "Ho Chi Minh City",
  PH: "Manila",
  ID: "Jakarta",
  AU: "Sydney",
  NZ: "Auckland",
};

/** Sorted longest-first so "Puerto Rico" wins over "Rico", "United States" over "States". */
const COUNTRY_ALIAS_ENTRIES = Object.entries(COUNTRY_ALIASES).sort(
  (a, b) => b[0].length - a[0].length
);

function normalizeCountryCode(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const key = s.toLowerCase().replace(/\s+/g, " ");
  return COUNTRY_ALIASES[key] || null;
}

function findCountryInText(text) {
  const lower = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const [alias, code] of COUNTRY_ALIAS_ENTRIES) {
    const aliasNorm = alias.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (new RegExp(`\\b${aliasNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)) {
      return { code, name: alias };
    }
  }
  return null;
}

function defaultCityForCountry(code) {
  if (!code) return null;
  return COUNTRY_DEFAULT_CITY[String(code).toUpperCase()] || null;
}

/**
 * Split "A or B" / "A o B" / "A and B" / "A y B" city lists.
 */
function splitCityAlternatives(chunk) {
  const raw = String(chunk || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/\s+(?:or|o|and|y|\/)\s+/i)
    .map((p) =>
      p
        .replace(/^(?:the|el|la|los|las|le|la)\s+/i, "")
        .replace(/\s+(?:today|hoy|tomorrow|manana|mañana|tonight|this week|next week|la otra semana|esta semana)\s*$/i, "")
        .replace(/[?.!,;:]+$/g, "")
        .trim()
    )
    .filter((p) => p.length >= 2 && !/^(unknown|there|here|please|por favor)$/i.test(p));
  // Dedupe case-insensitively, keep order
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out.slice(0, 3);
}

/**
 * Extract one or more weather places from free text (EN/ES/etc.).
 * @returns {{ places: { city: string, country?: string }[], countryHint?: string }}
 */
function extractWeatherPlaces(text) {
  const t = String(text || "").trim();
  const countryHit = findCountryInText(t);
  const countryHint = countryHit?.code;

  const patterns = [
    // EN: weather in/at/for/of X
    /\b(?:weather|temperature|forecast|temp|climate)\s+(?:in|at|for|of)\s+(.+?)(?:\s*[?!]|\s*$)/i,
    // EN: in X weather
    /\bin\s+([a-zA-ZÀ-ÿ .'-]{2,60}?)\s+(?:weather|temperature|forecast)\b/i,
    // ES: clima / tiempo de|en|para X  (do not treat "St." abbreviation period as end)
    /\b(?:clima|tiempo|temperatura|pron[oó]stico)\s+(?:de|en|para|del?)\s+(.+?)(?:\s*[?!]|\s*$)/i,
    // ES: en X el clima
    /\ben\s+([a-zA-ZÀ-ÿ .'-]{2,60}?)\s+(?:el\s+)?(?:clima|tiempo|temperatura)\b/i,
    // EN how warm/cold in X
    /\b(?:how\s+(?:warm|cold|hot)|temperature)\s+(?:is\s+it\s+)?(?:in|at|for)\s+(.+?)(?:\s*[?!]|\s*$)/i,
    // generic: in/at/for/of X[, country]
    /\b(?:in|at|for|of|en|de|para)\s+([a-zA-ZÀ-ÿ .'-]{2,80}?)(?:\s*,\s*([a-zA-ZÀ-ÿ .'-]{2,40}))?(?:\s*[?!]|\s*$)/i,
  ];

  let cityChunk = null;
  let inlineCountry = null;

  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    cityChunk = (m[1] || "").trim();
    if (m[2]) inlineCountry = m[2].trim();
    // Drop leading filler from city chunk
    cityChunk = cityChunk
      .replace(/^(?:the|el|la|los|las)\s+/i, "")
      .replace(/\b(?:hoy|today|tomorrow|manana|mañana|please|por favor|ahora|right now)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Ignore time-only phrases ("la otra semana", "next week") — use country hint instead
    if (
      /^(?:la\s+)?(?:otra\s+)?semana$/i.test(cityChunk) ||
      /^(?:this|next|last)\s+week$/i.test(cityChunk) ||
      /^(?:today|tomorrow|tonight|hoy|manana|mañana)$/i.test(cityChunk) ||
      cityChunk.length < 2
    ) {
      cityChunk = null;
      continue;
    }
    if (cityChunk) break;
  }

  const countryFromInline = normalizeCountryCode(inlineCountry) || countryHint;

  // Country-only ask: "weather in Puerto Rico"
  if (cityChunk) {
    const asCountry = normalizeCountryCode(cityChunk) || findCountryInText(cityChunk)?.code;
    if (asCountry && splitCityAlternatives(cityChunk).length <= 1) {
      const def = defaultCityForCountry(asCountry);
      if (def) {
        return {
          places: [{ city: def, country: asCountry }],
          countryHint: asCountry,
        };
      }
    }
  }

  const cities = cityChunk ? splitCityAlternatives(cityChunk) : [];
  if (!cities.length && countryFromInline) {
    const def = defaultCityForCountry(countryFromInline);
    if (def) {
      return {
        places: [{ city: def, country: countryFromInline }],
        countryHint: countryFromInline,
      };
    }
  }

  const places = cities.map((city) => ({
    city,
    country: countryFromInline || undefined,
  }));

  return {
    places: places.length ? places : [],
    countryHint: countryFromInline || undefined,
  };
}

/**
 * Pick best geocoding hit when API returns multiple places.
 * @param {Array<{ name?: string, country_code?: string, country?: string, population?: number }>} results
 * @param {string|null|undefined} wantCountry ISO2 or name
 */
function pickGeoResult(results, wantCountry) {
  if (!Array.isArray(results) || !results.length) return null;
  const code = normalizeCountryCode(wantCountry);
  if (code) {
    const match = results.find(
      (r) => String(r.country_code || "").toUpperCase() === code
    );
    if (match) return match;
  }
  // Prefer higher population when ambiguous
  const ranked = [...results].sort(
    (a, b) => Number(b.population || 0) - Number(a.population || 0)
  );
  return ranked[0];
}

module.exports = {
  normalizeCountryCode,
  findCountryInText,
  defaultCityForCountry,
  extractWeatherPlaces,
  pickGeoResult,
  splitCityAlternatives,
  COUNTRY_ALIASES,
  COUNTRY_DEFAULT_CITY,
};
