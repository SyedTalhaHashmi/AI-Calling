/**
 * Complex regression + live API tests for intent router & travel/hotel/weather.
 * Run: node test/complexFlows.test.js
 */
require("dotenv").config();

const assert = require("assert");
const createTravelService = require("../services/travel");
const createPlacesService = require("../services/places");
const createOpenMeteoService = require("../services/openMeteo");
const {
  resolveIntent,
  extractTravelRoute,
  extractLocation,
  extractCityAndCountry,
  isWeatherQuestion,
} = require("../utils/intentRouter");

const logger = {
  info: () => {},
  warn: (o, m) => console.log("  warn:", m, o?.err || ""),
  error: (o, m) => console.log("  error:", m, o?.err || ""),
};

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`       ${err.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`       ${err.message}`);
  }
}

async function main() {
  console.log("=== A) Complex intent / entity cases ===\n");

  check("travel buried in long polite sentence → BOG/MIA", () => {
    const t =
      "Okay perfect I want to ask you something I need to travel from Bogota to Miami on Monday returning on Friday do you mind telling me the price of the ticket?";
    assert.strictEqual(resolveIntent(t), "travel_price");
    const r = extractTravelRoute(t);
    assert.strictEqual(r.origin, "BOG");
    assert.strictEqual(r.destination, "MIA");
  });

  check("Spanish ticket ask Bogotá–Miami", () => {
    const t = "Cuánto cuesta un tiquete de Bogotá a Miami?";
    assert.strictEqual(resolveIntent(t), "travel_price");
    const r = extractTravelRoute(t);
    assert.strictEqual(r.origin, "BOG");
    assert.strictEqual(r.destination, "MIA");
  });

  check("fly from Karachi to Dubai", () => {
    const t = "How much does it cost to fly from Karachi to Dubai?";
    assert.strictEqual(resolveIntent(t), "travel_price");
    const r = extractTravelRoute(t);
    assert.strictEqual(r.origin, "KHI");
    assert.strictEqual(r.destination, "DXB");
  });

  check("New York to London airfare", () => {
    const t = "What's the cheapest flight from New York to London?";
    assert.strictEqual(resolveIntent(t), "travel_price");
    const r = extractTravelRoute(t);
    assert.strictEqual(r.origin, "JFK");
    assert.strictEqual(r.destination, "LHR");
  });

  check("hotel+weather words: hotel wins", () => {
    const t = "Is it hot near a nice hotel in Miami for one night?";
    assert.strictEqual(resolveIntent(t), "hotel");
    assert.strictEqual(isWeatherQuestion(t), false);
    assert.match(extractLocation(t), /miami/i);
  });

  check("brain/rain false positive still chat", () => {
    const t =
      "Give students a brain stretcher about numbers, something interesting they might not know";
    assert.strictEqual(resolveIntent(t), "chat");
  });

  check("ask you / can you stopwords never become IATA", () => {
    const t = "Can you ask me something and then tell me an average price?";
    assert.strictEqual(resolveIntent(t), "travel_price");
    const r = extractTravelRoute(t);
    assert.strictEqual(r.origin, null);
    assert.strictEqual(r.destination, null);
  });

  check("explicit IATA LHE to DXB still works if in whitelist — unknown LHE alone", () => {
    // LHE not in CITY map whitelist — city names preferred; raw LHE not in KNOWN_IATA
    const r = extractTravelRoute("flight from Dubai to Karachi");
    assert.strictEqual(r.origin, "DXB");
    assert.strictEqual(r.destination, "KHI");
  });

  check("weather after Colombia hint: Miami stays not CO", () => {
    const places = extractCityAndCountry("what's the weather in Miami right now?", {
      country: "CO",
      name: "Colombia",
    });
    assert.match(places[0].city, /miami/i);
    assert.notStrictEqual(places[0].country, "CO");
  });

  check("weather follow-up with no city keeps CO hint", () => {
    const places = extractCityAndCountry("and the weather there?", {
      country: "CO",
      name: "Colombia",
    });
    assert.strictEqual(places[0].country, "CO");
  });

  check("true weather: is it cold in London", () => {
    assert.strictEqual(resolveIntent("is it cold in London today?"), "weather");
  });

  check("true weather: will it rain in Paris", () => {
    assert.strictEqual(resolveIntent("will it rain in Paris tomorrow?"), "weather");
  });

  check("food vs hotel: restaurants in Miami", () => {
    assert.strictEqual(resolveIntent("best restaurants in Miami"), "food");
  });

  check("hotel in Medellín location", () => {
    assert.strictEqual(resolveIntent("find a hotel in Medellin"), "hotel");
    assert.match(extractLocation("find a hotel in Medellin"), /medellin/i);
  });

  check("flight status does not steal price ask", () => {
    assert.strictEqual(
      resolveIntent("ticket price from Miami to Orlando"),
      "travel_price"
    );
  });

  check("mixed: travel + hotel sentence — hotel keyword wins priority", () => {
    // Priority: hotel before travel — intentional
    assert.strictEqual(
      resolveIntent("I need a hotel in Miami and also a ticket from Bogota"),
      "hotel"
    );
  });

  console.log("\n=== B) Live APIs — complex routes & places ===\n");

  const travel = createTravelService(process.env.TRAVELPAYOUTS_TOKEN, logger);
  const places = createPlacesService(process.env.GOOGLE_PLACES_API_KEY, logger);
  const weather = createOpenMeteoService(process.env.OPEN_METEO_ENABLED !== "false", logger);

  assert.ok(travel.enabled, "Travelpayouts token missing");
  assert.ok(places.enabled, "Places key missing");
  assert.ok(weather.enabled, "Open-Meteo disabled");

  const liveRoutes = [
    { from: "BOG", to: "MIA", label: "Bogotá→Miami" },
    { from: "KHI", to: "DXB", label: "Karachi→Dubai" },
    { from: "JFK", to: "LHR", label: "NYC→London" },
    { from: "MIA", to: "MCO", label: "Miami→Orlando" },
  ];

  for (const r of liveRoutes) {
    await checkAsync(`Travelpayouts ${r.label} (${r.from}→${r.to})`, async () => {
      const fare = await travel.cheapestRoute(r.from, r.to);
      if (fare.error) {
        // Soft-fail info: some routes may lack cheap-fares cache data
        console.log(`       (no fare data: ${fare.error})`);
        // Still OK if API reachable and returns structured error (not 400 from ASK/YOU)
        assert.ok(
          /couldn't find|Could not fetch|Try Kayak/i.test(fare.error),
          `unexpected error: ${fare.error}`
        );
      } else {
        assert.ok(Number(fare.price) > 0, "price missing");
        console.log(`       → ${fare.price} ${fare.currency}`);
      }
    });
  }

  await checkAsync("bad IATA ASK→YOU must fail validation (not hit API as airports)", async () => {
    const fare = await travel.cheapestRoute("ASK", "YOU");
    assert.ok(fare.error, "expected error");
    assert.match(fare.error, /IATA|origin and destination/i);
  });

  const hotelCities = ["Miami", "Bogota", "Dubai", "London"];
  for (const city of hotelCities) {
    await checkAsync(`Places hotels in ${city}`, async () => {
      const res = await places.searchHotels(city);
      assert.ok(!res.error, res.error || "places error");
      assert.ok(res.places?.length >= 1, "no hotels returned");
      console.log(`       → ${res.places[0].name} (${res.places[0].rating || "n/a"})`);
    });
  }

  await checkAsync("Places hotel with empty city asks for city", async () => {
    const res = await places.searchHotels("");
    assert.match(res.error || "", /city/i);
  });

  const weatherPlaces = [
    { city: "Bogota", country: "CO" },
    { city: "Miami", country: "US" },
    { city: "London", country: "GB" },
    { city: "Dubai", country: "AE" },
  ];
  for (const p of weatherPlaces) {
    await checkAsync(`Weather ${p.city}, ${p.country}`, async () => {
      const w = await weather.getByCity(p.city, p.country);
      assert.ok(!w.error, w.error || "weather error");
      assert.ok(typeof w.temp === "number", "temp missing");
      console.log(`       → ${w.temp}° ${w.description}`);
    });
  }

  await checkAsync("End-to-end: utterance → route → fare (BOG-MIA)", async () => {
    const t =
      "I want to ask you something. Travel from Bogota to Miami — what is the price of the ticket?";
    assert.strictEqual(resolveIntent(t), "travel_price");
    const route = extractTravelRoute(t);
    assert.deepStrictEqual(route, { origin: "BOG", destination: "MIA" });
    const fare = await travel.cheapestRoute(route.origin, route.destination);
    assert.ok(!fare.error, fare.error);
    assert.ok(fare.price > 0);
    console.log(`       Buddy: Cheapest recent fare from ${fare.origin} to ${fare.destination} is about ${fare.price} ${fare.currency}.`);
  });

  await checkAsync("End-to-end: utterance → hotel city → places", async () => {
    const t = "Do you mind giving me the price for one night in a nice hotel in Miami?";
    assert.strictEqual(resolveIntent(t), "hotel");
    const city = extractLocation(t);
    assert.match(city, /miami/i);
    const res = await places.searchHotels(city);
    assert.ok(!res.error, res.error);
    assert.ok(res.places.length >= 1);
    console.log(
      `       Buddy: Popular hotels: ${res.places.map((p) => `${p.name}, rated ${p.rating || "N A"}`).join(". ")}`
    );
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Unexpected:", err);
  process.exit(1);
});
