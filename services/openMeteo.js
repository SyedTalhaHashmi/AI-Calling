const axios = require("axios");
const { MemoryCache } = require("./cache");
const {
  normalizeCountryCode,
  defaultCityForCountry,
  pickGeoResult,
} = require("../utils/placeResolve");

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

const WMO_DESC = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "foggy",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "rain showers",
  82: "heavy rain showers",
  95: "thunderstorm",
  96: "thunderstorm",
  99: "thunderstorm",
};

function createOpenMeteoService(enabled, logger) {
  if (!enabled) {
    return {
      enabled: false,
      getByCity: async () => ({ error: "Weather service is disabled." }),
    };
  }

  const cache = new MemoryCache();

  async function getByCity(city, country) {
    let placeName = String(city || "").trim();
    let effectiveCountry = normalizeCountryCode(country);

    // Country-only: city arg is "Puerto Rico" / "France" / etc.
    const cityAsCountry = normalizeCountryCode(placeName);
    if (cityAsCountry) {
      effectiveCountry = effectiveCountry || cityAsCountry;
      placeName = defaultCityForCountry(cityAsCountry) || placeName;
    }

    if (!placeName && effectiveCountry) {
      placeName = defaultCityForCountry(effectiveCountry) || "";
    }

    if (!placeName || /^unknown$/i.test(placeName)) {
      if (effectiveCountry && defaultCityForCountry(effectiveCountry)) {
        placeName = defaultCityForCountry(effectiveCountry);
      } else {
        return { error: "Please share a city or country name." };
      }
    }

    const cacheKey = `weather:${placeName}|${effectiveCountry || ""}`.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const geoParams = {
        name: placeName,
        count: 10,
        language: "en",
        format: "json",
      };
      if (effectiveCountry) {
        geoParams.countryCode = effectiveCountry;
      }

      const geo = await axios.get(GEO_URL, {
        params: geoParams,
        timeout: 2500,
      });

      let results = geo.data?.results || [];
      // If country filter returned nothing, retry without filter then pick by country
      if (!results.length && effectiveCountry) {
        const retry = await axios.get(GEO_URL, {
          params: { name: placeName, count: 10, language: "en", format: "json" },
          timeout: 2500,
        });
        results = retry.data?.results || [];
      }

      const place = pickGeoResult(results, effectiveCountry);
      if (!place) return { error: `I couldn't find ${placeName}. Try another city name.` };

      // If caller specified a country and best match still differs, prefer retry message
      if (
        effectiveCountry &&
        place.country_code &&
        String(place.country_code).toUpperCase() !== effectiveCountry
      ) {
        const forced = results.find(
          (r) => String(r.country_code || "").toUpperCase() === effectiveCountry
        );
        if (!forced) {
          return {
            error: `I couldn't find ${placeName} in that country. Try a clearer city name.`,
          };
        }
      }

      const weather = await axios.get(WEATHER_URL, {
        params: {
          latitude: place.latitude,
          longitude: place.longitude,
          current:
            "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m",
          daily: "weather_code,temperature_2m_max,temperature_2m_min",
          forecast_days: 7,
          timezone: "auto",
        },
        timeout: 2500,
      });
      const current = weather.data?.current;
      if (!current) return { error: "Could not fetch weather." };

      const code = Number(current.weather_code);
      const result = {
        city: place.name,
        country: place.country_code,
        admin1: place.admin1 || null,
        temp: Math.round(Number(current.temperature_2m)),
        feelsLike: Math.round(Number(current.apparent_temperature)),
        description: WMO_DESC[code] || `weather code ${code}`,
        humidity: current.relative_humidity_2m != null
          ? Math.round(Number(current.relative_humidity_2m))
          : undefined,
        windSpeed: current.wind_speed_10m,
      };
      return cache.set(cacheKey, result, 2 * 60 * 1000);
    } catch (err) {
      logger.warn({ err: err.message, city: placeName, country: effectiveCountry }, "Open-Meteo request failed");
      return { error: "Could not fetch weather." };
    }
  }

  return {
    enabled: true,
    getByCity,
  };
}

module.exports = createOpenMeteoService;
