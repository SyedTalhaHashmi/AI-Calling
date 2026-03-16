/**
 * OpenWeather API - current weather by city name.
 * Used by Realtime API tool for fast weather answers.
 */
const axios = require("axios");

const BASE = "https://api.openweathermap.org/data/2.5/weather";

function createWeatherService(apiKey, logger) {
  if (!apiKey) {
    return {
      getByCity: async () => ({ error: "Weather not configured. Set OPENWEATHER_API_KEY." }),
      enabled: false,
    };
  }

  async function getByCity(city, country) {
    const q = country ? `${city},${country}` : city;
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
