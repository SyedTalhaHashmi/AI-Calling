const axios = require("axios");
const { MemoryCache } = require("./cache");

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

function createOpenMeteoService(enabled, logger) {
  if (!enabled) {
    return {
      enabled: false,
      getByCity: async () => ({ error: "Weather service is disabled." }),
    };
  }

  const cache = new MemoryCache();

  async function getByCity(city, country) {
    const q = `${city || ""}|${country || ""}`.trim().toLowerCase();
    if (!q) return { error: "Please share a city name." };
    const cacheKey = `weather:${q}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const geo = await axios.get(GEO_URL, {
        params: {
          name: city,
          count: 1,
          language: "en",
          format: "json",
        },
        timeout: 1400,
      });
      const place = geo.data?.results?.[0];
      if (!place) return { error: "City not found." };

      const weather = await axios.get(WEATHER_URL, {
        params: {
          latitude: place.latitude,
          longitude: place.longitude,
          current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
          timezone: "auto",
        },
        timeout: 1400,
      });
      const current = weather.data?.current;
      if (!current) return { error: "Could not fetch weather." };
      const result = {
        city: place.name,
        country: place.country_code,
        temp: Math.round(Number(current.temperature_2m)),
        feelsLike: Math.round(Number(current.apparent_temperature)),
        description: `weather code ${current.weather_code}`,
        windSpeed: current.wind_speed_10m,
      };
      return cache.set(cacheKey, result, 2 * 60 * 1000);
    } catch (err) {
      logger.warn({ err: err.message, city, country }, "Open-Meteo request failed");
      return { error: "Could not fetch weather." };
    }
  }

  return {
    enabled: true,
    getByCity,
  };
}

module.exports = createOpenMeteoService;
