/**
 * AviationStack — flight status.
 * Free: 100 requests/month. Query by flight_iata (e.g. UA1004).
 */
const axios = require("axios");

const BASE = "https://api.aviationstack.com/v1/flights";

function createFlightsService(apiKey, logger) {
  if (!apiKey) {
    return {
      getFlightStatus: async () => ({ error: "Flights not configured. Set AVIATIONSTACK_API_KEY." }),
      enabled: false,
    };
  }

  async function getFlightStatus(flightIata) {
    if (!flightIata || flightIata.length < 4) {
      return { error: "Please say the flight number, for example flight U A 1004." };
    }
    try {
      const res = await axios.get(BASE, {
        params: { access_key: apiKey, flight_iata: flightIata.toUpperCase() },
        timeout: 8000,
      });
      const data = res.data;
      if (data.error) {
        return { error: data.error.message || "Could not get flight info." };
      }
      const flights = data.data;
      if (!flights || flights.length === 0) {
        return { error: `No flight found for ${flightIata}.` };
      }
      const f = flights[0];
      const status = f.flight_status || "unknown";
      const dep = f.departure?.iata || f.departure?.airport || "?";
      const arr = f.arrival?.iata || f.arrival?.airport || "?";
      const airline = f.airline?.name || "Flight";
      return {
        flight: f.flight?.iata || flightIata,
        airline,
        status,
        departure: dep,
        arrival: arr,
        message: `${airline} ${f.flight?.iata || flightIata}: ${status}, ${dep} to ${arr}.`,
      };
    } catch (err) {
      logger.warn({ err: err.message, flightIata }, "AviationStack request failed");
      return { error: "Could not fetch flight status." };
    }
  }

  return {
    getFlightStatus,
    enabled: true,
  };
}

module.exports = createFlightsService;
