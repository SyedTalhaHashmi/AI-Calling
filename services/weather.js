/**
 * OpenWeather API - current weather by city name.
 * Used by Realtime API tool for fast weather answers.
 */
const axios = require("axios");
const {
  normalizeCountryCode,
  defaultCityForCountry,
} = require("../utils/placeResolve");

const BASE = "https://api.openweathermap.org/data/2.5/weather";

function createWeatherService(apiKey, logger) {
  if (!apiKey) {
    return {
      getByCity: async () => ({ error: "Weather not configured. Set OPENWEATHER_API_KEY." }),
      enabled: false,
    };
  }

  async function getByCity(city, country) {
    let placeName = String(city || "").trim();
    let countryCode = normalizeCountryCode(country);

    // "Puerto Rico" as city → San Juan, PR
    const cityAsCountry = normalizeCountryCode(placeName);
    if (cityAsCountry) {
      countryCode = countryCode || cityAsCountry;
      placeName = defaultCityForCountry(cityAsCountry) || placeName;
    }

    if (!placeName || /^unknown$/i.test(placeName)) {
      if (countryCode && defaultCityForCountry(countryCode)) {
        placeName = defaultCityForCountry(countryCode);
      } else {
        return { error: "Please share a city or country name." };
      }
    }

    const q = countryCode ? `${placeName},${countryCode}` : placeName;
    try {
      const res = await axios.get(BASE, {
        params: { q, appid: apiKey, units: "metric" },
        timeout: 5000,
      });
      const d = res.data;
      return {
        city: d.name,
        country: d.sys?.country,
        temp: Math.round(d.main?.temp),
        feelsLike: Math.round(d.main?.feels_like),
        description: d.weather?.[0]?.description,
        humidity: d.main?.humidity,
      };
    } catch (err) {
      // Retry without country if qualified lookup 404s
      if (err.response?.status === 404 && countryCode) {
        try {
          const res = await axios.get(BASE, {
            params: { q: placeName, appid: apiKey, units: "metric" },
            timeout: 5000,
          });
          const d = res.data;
          // Prefer same-country match only
          if (
            d.sys?.country &&
            String(d.sys.country).toUpperCase() !== countryCode
          ) {
            return {
              error: `I couldn't find ${placeName} in that country. Try another city.`,
            };
          }
          return {
            city: d.name,
            country: d.sys?.country,
            temp: Math.round(d.main?.temp),
            feelsLike: Math.round(d.main?.feels_like),
            description: d.weather?.[0]?.description,
            humidity: d.main?.humidity,
          };
        } catch (err2) {
          if (err2.response?.status === 404) {
            return { error: "City not found." };
          }
        }
      }
      if (err.response?.status === 404) {
        return { error: "City not found." };
      }
      logger.warn({ err: err.message, q }, "OpenWeather request failed");
      return { error: "Could not fetch weather." };
    }
  }

  return {
    getByCity,
    enabled: true,
  };
}

module.exports = createWeatherService;
