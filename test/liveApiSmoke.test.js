/**
 * Live API smoke test for the fixed user-error flows.
 * Loads .env; never prints secrets.
 */
require("dotenv").config();

const createTravelService = require("../services/travel");
const createPlacesService = require("../services/places");
const createOpenMeteoService = require("../services/openMeteo");
const {
  resolveIntent,
  extractTravelRoute,
  extractLocation,
} = require("../utils/intentRouter");

const logger = {
  info: () => {},
  warn: (obj, msg) => console.log("  warn:", msg, obj?.err || obj?.query || ""),
  error: (obj, msg) => console.log("  error:", msg, obj?.err || ""),
};

async function run() {
  const travel = createTravelService(process.env.TRAVELPAYOUTS_TOKEN, logger);
  const places = createPlacesService(process.env.GOOGLE_PLACES_API_KEY, logger);
  const weather = createOpenMeteoService(process.env.OPEN_METEO_ENABLED !== "false", logger);

  console.log("=== 1) Intent + entities (log utterances) ===");
  const flightText =
    "Okay, perfect. I want to ask you something. I need to travel from Bogota to Miami on Monday, returning on Friday. Do you mind if you tell me what is the price of the ticket?";
  const hotelText =
    "Let me ask you something. Do you mind if you give me the price for one night in one nice hotel in Miami?";

  const flightIntent = resolveIntent(flightText);
  const route = extractTravelRoute(flightText);
  const hotelIntent = resolveIntent(hotelText);
  const hotelCity = extractLocation(hotelText);

  console.log("  flight intent:", flightIntent, "route:", route);
  console.log("  hotel intent:", hotelIntent, "city:", hotelCity);

  if (flightIntent !== "travel_price" || route.origin !== "BOG" || route.destination !== "MIA") {
    console.error("FAIL: flight routing incorrect");
    process.exitCode = 1;
  }
  if (hotelIntent !== "hotel" || !/miami/i.test(hotelCity)) {
    console.error("FAIL: hotel routing incorrect");
    process.exitCode = 1;
  }

  console.log("\n=== 2) Travelpayouts BOG → MIA ===");
  console.log("  enabled:", travel.enabled);
  if (!travel.enabled) {
    console.error("FAIL: Travelpayouts not configured");
    process.exitCode = 1;
  } else {
    const fare = await travel.cheapestRoute(route.origin, route.destination);
    if (fare.error) {
      console.log("  API reply ERROR:", fare.error);
      process.exitCode = 1;
    } else {
      console.log(
        "  API reply OK:",
        `${fare.origin}→${fare.destination} ~ ${fare.price} ${fare.currency}` +
          (fare.airline ? ` airline ${fare.airline}` : "")
      );
      console.log(
        "  Buddy would say:",
        `Cheapest recent fare from ${fare.origin} to ${fare.destination} is about ${fare.price} ${fare.currency}.`
      );
    }
  }

  console.log("\n=== 3) Google Places hotels in Miami ===");
  console.log("  enabled:", places.enabled);
  if (!places.enabled) {
    console.error("FAIL: Places not configured");
    process.exitCode = 1;
  } else {
    const hotels = await places.searchHotels(hotelCity);
    if (hotels.error) {
      console.log("  API reply ERROR:", hotels.error);
      process.exitCode = 1;
    } else {
      const names = (hotels.places || []).map(
        (p) => `${p.name}, rated ${p.rating || "N A"}`
      );
      console.log("  API reply OK:", names.join(" | "));
      console.log("  Buddy would say:", `Popular hotels: ${names.join(". ")}`);
    }
  }

  console.log("\n=== 4) Weather Bogotá (control) ===");
  console.log("  enabled:", weather.enabled);
  if (weather.enabled) {
    const w = await weather.getByCity("Bogota", "CO");
    if (w.error) {
      console.log("  API reply ERROR:", w.error);
      process.exitCode = 1;
    } else {
      console.log(
        "  API reply OK:",
        `${w.temp}° ${w.description} in ${w.city}, ${w.country}`
      );
    }
  }

  console.log("\n=== DONE ===");
  if (process.exitCode) console.log("RESULT: FAILED");
  else console.log("RESULT: PASSED — routing + live API replies OK");
}

run().catch((err) => {
  console.error("Unexpected:", err.message);
  process.exit(1);
});
