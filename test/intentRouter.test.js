/**
 * Regression tests for intent router (failing production log cases).
 * Run: node test/intentRouter.test.js
 */
const assert = require("assert");
const {
  resolveIntent,
  isWeatherQuestion,
  extractTravelRoute,
  extractRouteIata,
  extractLocation,
  extractCityAndCountry,
  hasPhrase,
} = require("../utils/intentRouter");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`       ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("intentRouter regressions\n");

check("brain stretcher is chat, not weather (rain⊂brain)", () => {
  const text =
    "What is a good math teaser or like a brain stretcher or a new fact that students in grade 7 to 10 might find interesting?";
  assert.strictEqual(isWeatherQuestion(text), false);
  assert.strictEqual(resolveIntent(text), "chat");
});

check("hotel is hotel, not weather (hot⊂hotel)", () => {
  const text =
    "Do you mind if you give me the price for one night in one nice hotel in Miami?";
  assert.strictEqual(resolveIntent(text), "hotel");
  assert.strictEqual(isWeatherQuestion(text), false);
});

check("hotel follow-up stays hotel", () => {
  assert.strictEqual(resolveIntent("So you can not find hotel in Miami?"), "hotel");
});

check("Bogota to Miami ticket → travel_price + BOG/MIA (not ASK/YOU)", () => {
  const text =
    "Okay, perfect. I want to ask you something. I need to travel from Bogota to Miami on Monday, returning on Friday. Do you mind if you tell me what is the price of the ticket?";
  assert.strictEqual(resolveIntent(text), "travel_price");
  const route = extractTravelRoute(text);
  assert.strictEqual(route.origin, "BOG");
  assert.strictEqual(route.destination, "MIA");
  const bad = extractRouteIata(text);
  assert.notStrictEqual(bad.origin, "ASK");
  assert.notStrictEqual(bad.destination, "YOU");
});

check("average price follow-up does not use YOU/CAN as IATA", () => {
  const text = "So, what you can do, can you give me an average price?";
  assert.strictEqual(resolveIntent(text), "travel_price");
  const iata = extractRouteIata(text);
  assert.strictEqual(iata.origin, null);
  assert.strictEqual(iata.destination, null);
});

check("explicit BOG MIA codes still work", () => {
  const route = extractTravelRoute("cheapest flight from BOG to MIA");
  assert.strictEqual(route.origin, "BOG");
  assert.strictEqual(route.destination, "MIA");
});

check("extractLocation picks Miami from hotel phrase", () => {
  assert.strictEqual(
    extractLocation("price for one night in one nice hotel in Miami?"),
    "Miami"
  );
  assert.strictEqual(extractLocation("hotel in Miami"), "Miami");
});

check("weather in Bogota Colombia still weather", () => {
  const text =
    "what is the weather in Bogota, Colombia right now?";
  assert.strictEqual(resolveIntent(text), "weather");
});

check("session CO hint does not force Miami to Colombia", () => {
  const places = extractCityAndCountry("what is the weather in Miami?", {
    country: "CO",
    name: "Colombia",
  });
  assert.ok(places.length >= 1);
  assert.match(places[0].city, /miami/i);
  assert.notStrictEqual(places[0].country, "CO");
});

check("session CO hint still works for weather follow-up with no city", () => {
  const places = extractCityAndCountry("how's the weather there?", {
    country: "CO",
    name: "Colombia",
  });
  assert.ok(places.length >= 1);
  assert.strictEqual(places[0].country, "CO");
});

check("hasPhrase word boundaries", () => {
  assert.strictEqual(hasPhrase("hotel prices", "hot"), false);
  assert.strictEqual(hasPhrase("brain teaser", "rain"), false);
  assert.strictEqual(hasPhrase("is it hot outside", "hot"), true);
  assert.strictEqual(hasPhrase("will it rain today", "rain"), true);
});

check("is it hot in Miami is weather", () => {
  assert.strictEqual(resolveIntent("is it hot in Miami today?"), "weather");
});

if (process.exitCode) {
  console.log(`\nFAILED — ${passed} checks passed before failure`);
} else {
  console.log(`\nAll ${passed} checks passed`);
}
