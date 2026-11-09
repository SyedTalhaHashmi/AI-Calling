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
  extractRouteParts,
  isHotelPriceQuestion,
  mentionsFlights,
  hotelTier,
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

check("schedule questions are not clock lookups (what time does X open)", () => {
  for (const text of [
    "What time does the pharmacy open?",
    "What time does the store close?",
    "What time do you open?",
    "What time does the museum open in Madrid?",
  ]) {
    assert.notStrictEqual(resolveIntent(text), "time", text);
  }
});

check("pharmacy hours with a city stay a pharmacy lookup", () => {
  assert.strictEqual(resolveIntent("What time does the pharmacy in Bogota open?"), "local_service");
});

check("genuine clock questions stay time", () => {
  for (const text of [
    "What time is it?",
    "What time is it in Bogota?",
    "what time is it now in Tokyo",
    "What time is now in Bogota?",
    "Time in Tokyo",
    "What's the time in Madrid right now?",
    "current time in London",
    "What time zone is Bogota in?",
    "Tell me the time in New York",
    "what time do you have in Tokyo",
  ]) {
    assert.strictEqual(resolveIntent(text), "time", text);
  }
});

check("'Is it hot in Miami or Orlando?' asks for both cities, not Italy", () => {
  for (const text of [
    "Is it hot in Miami or Orlando?",
    "Is it hot in Miami or Orlando today?",
  ]) {
    assert.strictEqual(resolveIntent(text), "weather", text);
    assert.deepStrictEqual(
      extractCityAndCountry(text).map((p) => p.city),
      ["Miami", "Orlando"],
      text
    );
  }
});

check("pronoun 'it' is never read as a city or as Italy", () => {
  for (const [text, city] of [
    ["Is it cold in Chicago?", "Chicago"],
    ["Is it sunny in Madrid right now?", "Madrid"],
    ["Is it going to be hot in Miami tomorrow?", "Miami"],
  ]) {
    assert.deepStrictEqual(
      extractCityAndCountry(text).map((p) => p.city),
      [city],
      text
    );
  }
  for (const text of ["Is it hot today?", "Is it cold there?", "Is it cold in my area?"]) {
    const places = extractCityAndCountry(text);
    assert.ok(
      places.every((p) => p.country !== "IT" && !/^(?:it|there|my area)\b/i.test(p.city)),
      `${text} -> ${JSON.stringify(places)}`
    );
  }
  // A real mention of Italy still works
  assert.deepStrictEqual(extractCityAndCountry("Is it hot in Italy?"), [
    { city: "Rome", country: "IT" },
  ]);
});

check("'it' with no place falls back to the caller's country hint, not Italy", () => {
  assert.deepStrictEqual(extractCityAndCountry("Is it cold there?", { country: "CO" }), [
    { city: "Bogota", country: "CO" },
  ]);
});

check("'UK' means Great Britain (GB), so London lookups don't fail", () => {
  const { normalizeCountryCode } = require("../utils/placeResolve");
  assert.strictEqual(normalizeCountryCode("UK"), "GB");
  assert.strictEqual(normalizeCountryCode("uk"), "GB");
  assert.strictEqual(normalizeCountryCode("GB"), "GB");
  assert.strictEqual(normalizeCountryCode("CO"), "CO");
  assert.deepStrictEqual(extractCityAndCountry("What's the weather in London, UK?"), [
    { city: "London", country: "GB" },
  ]);
});

check("rain, snow, wind, humidity and Spanish heat questions are weather", () => {
  for (const [text, city] of [
    ["Is it raining in London?", "London"],
    ["Is it snowing in Denver?", "Denver"],
    ["Is it windy in Chicago?", "Chicago"],
    ["Is it humid in Houston?", "Houston"],
    ["Do I need an umbrella in Seattle?", "Seattle"],
    ["¿Hace calor en Miami?", "Miami"],
    ["¿Está lloviendo en Bogotá?", "Bogotá"],
  ]) {
    assert.strictEqual(resolveIntent(text), "weather", text);
    assert.deepStrictEqual(extractCityAndCountry(text).map((p) => p.city), [city], text);
  }
});

check("flight on-time and delay questions are flight status, not time or chat", () => {
  assert.strictEqual(resolveIntent("Is flight AA100 on time?"), "flight_status");
  assert.strictEqual(resolveIntent("Is my flight delayed?"), "flight_status");
  assert.strictEqual(resolveIntent("Has flight UA 1004 landed?"), "flight_status");
});

check("'Real Madrid' is not the Brazilian real", () => {
  // Not a currency; and the sports lookup only has live scores, so schedule asks go to chat
  assert.strictEqual(resolveIntent("When is the next Real Madrid match?"), "chat");
  // Live question with no sports-schedule lookup: web search (chat when search is off)
  assert.strictEqual(resolveIntent("Is Real Madrid playing today?"), "web_search");
  assert.strictEqual(resolveIntent("How much is the Brazilian real in dollars?"), "fx");
  assert.strictEqual(resolveIntent("Convert 100 reais to dollars"), "fx");
});

check("upcoming-game questions are chat; live scores stay sports", () => {
  for (const text of [
    "When is the next Lakers game?",
    "When does Barcelona play their next match?",
    "Is there an upcoming NFL game on Sunday?",
  ]) {
    assert.strictEqual(resolveIntent(text), "chat", text);
  }
  assert.strictEqual(resolveIntent("What's the soccer schedule this weekend?"), "web_search");
  assert.strictEqual(resolveIntent("What's the score of the Lakers game?"), "sports");
  assert.strictEqual(resolveIntent("Who won the game last night?"), "sports");
  assert.strictEqual(resolveIntent("live football scores"), "sports");
});

check("stock market hours are a schedule question (chat), not a ticker lookup", () => {
  // Web search (the handler adds the market clock); chat when search is off
  assert.strictEqual(resolveIntent("Is the stock market open today?"), "web_search");
  assert.strictEqual(resolveIntent("When does the stock market close?"), "chat");
  assert.strictEqual(resolveIntent("What is Apple stock at?"), "stocks");
});

// Production log 2026-10-28: routing misses and false matches
check("city names match whole words only (climate ≠ Lima, California ≠ Cali)", () => {
  assert.deepStrictEqual(extractTravelRoute("Is the Bogota climate nice for a trip?"), { origin: "BOG", destination: null });
  assert.ok(!/^cali$/i.test(extractLocation("best hotels in California")), extractLocation("best hotels in California"));
});

check("'from' / 'to' decide the route direction, whatever the word order", () => {
  assert.deepStrictEqual(extractTravelRoute("flights to Miami from Bogota"), { origin: "BOG", destination: "MIA" });
  assert.deepStrictEqual(extractTravelRoute("Bogota to Miami leaving on Monday"), { origin: "BOG", destination: "MIA" });
  assert.deepStrictEqual(extractRouteParts("I want to travel from Milan to..."), { from: "MIL", to: null, others: [] });
  assert.deepStrictEqual(extractRouteParts("Rome."), { from: null, to: null, others: ["FCO"] });
});

check("half a route or a bare 'airline tickets' ask is a fare question", () => {
  assert.strictEqual(resolveIntent("I want to travel from Milan to..."), "travel_price");
  assert.strictEqual(resolveIntent("Yeah, what about airline tickets?"), "travel_price");
});

check("food intent only for finding restaurants, not any mention of food", () => {
  assert.strictEqual(resolveIntent("Mi puoi dire per favore quale è il miglior food to eat in Italia?"), "chat");
  assert.strictEqual(resolveIntent("what is the best option to give food to a cow?"), "chat");
  assert.strictEqual(resolveIntent("best restaurants in Miami"), "food");
  assert.strictEqual(resolveIntent("Where can I eat in Medellin?"), "food");
  assert.strictEqual(resolveIntent("Any good places to eat in Miami?"), "food");
});

check("hotel price asks are told apart from hotel lists", () => {
  assert.strictEqual(isHotelPriceQuestion("Can you give me a nice average ticket per hotel, like $80 per night, please?"), true);
  assert.strictEqual(isHotelPriceQuestion("Give me the price for my hotel in Miami three nights"), true);
  assert.strictEqual(isHotelPriceQuestion("What are the best hotels in Miami?"), false);
});

check("hotel tier from the caller's words or budget", () => {
  assert.strictEqual(hotelTier("like $80 per night"), "budget");
  assert.strictEqual(hotelTier("a cheap hotel in Bogota"), "budget");
  assert.strictEqual(hotelTier("under 100 dollars a night"), "budget");
  assert.strictEqual(hotelTier("hotel barato en Cartagena"), "budget");
  assert.strictEqual(hotelTier("a luxury hotel in Miami"), "luxury");
  assert.strictEqual(hotelTier("five-star hotels"), "luxury");
  assert.strictEqual(hotelTier("about $400 a night"), "luxury");
  assert.strictEqual(hotelTier("hotels in Miami for 3 nights"), null);
});

check("a trip ask that mentions flights is recognised next to hotels", () => {
  const t = "I have plans to travel from Bogota to Miami next Monday. Do you mind if you tell me the prices for the airline tickets and hotels?";
  assert.strictEqual(resolveIntent(t), "hotel");
  assert.strictEqual(mentionsFlights(t), true);
  assert.strictEqual(mentionsFlights("best hotels in Miami"), false);
});

check("weather 'City, Country' keeps the city (production: 'Medellín, Colombia' fetched Bogotá)", () => {
  assert.deepStrictEqual(extractCityAndCountry("Do you mind if you give me the weather in Medellín, Colombia?"), [
    { city: "Medellín", country: "CO" },
  ]);
  assert.deepStrictEqual(extractCityAndCountry("¿Cuál es el clima de Bogotá-Colombia hoy?"), [{ city: "Bogotá", country: "CO" }]);
  // A country alone still uses its main city; a hyphenated city is not split
  assert.deepStrictEqual(extractCityAndCountry("What's the weather in Colombia?"), [{ city: "Bogota", country: "CO" }]);
  assert.strictEqual(extractCityAndCountry("weather in Winston-Salem")[0].city, "Winston-Salem");
});

check("weather follow-up without a city uses the last city asked about, not the country's default", () => {
  const hint = { country: "CO", city: "Medellín" };
  assert.deepStrictEqual(extractCityAndCountry("Do you think it's going to rain today?", hint), [{ city: "Medellín", country: "CO" }]);
  assert.deepStrictEqual(extractCityAndCountry("Do you think it's going to rain today?", { country: "CO" }), [
    { city: "Bogota", country: "CO" },
  ]);
});

check("rain / forecast questions ask for a forecast day", () => {
  const { weatherForecastDay } = require("../utils/intentRouter");
  assert.strictEqual(weatherForecastDay("Do you think it's going to rain today?"), "today");
  assert.strictEqual(weatherForecastDay("What's the forecast for tomorrow in Miami?"), "tomorrow");
  assert.strictEqual(weatherForecastDay("¿Va a llover mañana en Bogotá?"), "tomorrow");
  assert.strictEqual(weatherForecastDay("¿Va a llover por la mañana?"), "today");
  assert.strictEqual(weatherForecastDay("What's the weather in Miami?"), null);
});

check("general sports knowledge is chat; scores are sports (production: soccer rules fetched live scores)", () => {
  assert.strictEqual(
    resolveIntent("I would like if you could tell me something about the sport of soccer, the rules and what it's all about."),
    "chat"
  );
  assert.strictEqual(resolveIntent("Who is the GOAT of football?"), "chat");
  assert.strictEqual(resolveIntent("What's the football score today?"), "sports");
  assert.strictEqual(resolveIntent("Who won the NBA game last night?"), "sports");
});

check("Spanish 'viajar desde X a Y' is a fare question; a city's metro price is not", () => {
  // Production 2026-10-31: answered with a guessed price
  const t = "ok perfecto una última pregunta debo viajar desde desde medellín a bogotá mañana una sola vía me puedes dar más o menos un precio de etiquete";
  assert.strictEqual(resolveIntent(t), "travel_price");
  assert.deepStrictEqual(extractTravelRoute(t), { origin: "MDE", destination: "BOG" });
  assert.strictEqual(resolveIntent("No te escuché lo del precio desde Medellín a Bogotá."), "travel_price");
  assert.notStrictEqual(resolveIntent("¿Cuál es el precio del metro de Medellín?"), "travel_price");
});

check("Italian and Portuguese weather questions look up the city (live replay: Rome weather was invented)", () => {
  assert.strictEqual(resolveIntent("Che tempo fa a Roma oggi?"), "weather");
  // Local names become the English name + country (the geocoder returned Romania for "Roma")
  assert.deepStrictEqual(extractCityAndCountry("Che tempo fa a Roma oggi?"), [{ city: "Rome", country: "IT" }]);
  assert.deepStrictEqual(extractCityAndCountry("Com'è il meteo a Milano?"), [{ city: "Milan", country: "IT" }]);
  assert.strictEqual(resolveIntent("Vai chover em São Paulo amanhã?"), "weather");
  assert.strictEqual(extractCityAndCountry("Vai chover em São Paulo amanhã?")[0].city, "São Paulo");
  // "tempo" alone is also "time / how long"
  assert.strictEqual(resolveIntent("Quanto tempo dura il volo?"), "chat");
});

check("'How many pesos is one dollar?' is an exchange-rate question with both currencies", () => {
  const fx = require("../services/fx")(true, { info() {}, warn() {}, error() {} });
  for (const t of ["How many Colombian pesos is one U.S. dollar today?", "¿Cuántos pesos es un dólar hoy?", "How many pesos is a dollar?"]) {
    assert.strictEqual(resolveIntent(t), "fx", t);
    assert.deepStrictEqual(fx.parsePairFromUtterance(t), { base: "USD", quote: "COP" }, t);
  }
  assert.deepStrictEqual(fx.parsePairFromUtterance("How many people live in Miami?"), { base: null, quote: null });
});

check("exchange rates are said as people say them (live replay: '3176.9100 COP')", () => {
  const { spokenRate, roundRate } = require("../services/fx");
  assert.strictEqual(spokenRate({ base: "USD", quote: "COP", rate: 3176.91 }), "One US dollar is about 3,177 Colombian pesos.");
  assert.strictEqual(spokenRate({ base: "EUR", quote: "USD", rate: 1.08734 }), "One euro is about 1.09 US dollars.");
  assert.strictEqual(roundRate(0.000314812), 0.0003148);
});

check("geocoder: a country or region entry is never taken as the city", () => {
  const { pickGeoResult } = require("../utils/placeResolve");
  const results = [
    { name: "Romania", country_code: "RO", population: 19020271, feature_code: "PCLI" },
    { name: "Roma", country_code: "RO", population: 3218, feature_code: "PPLA2" },
  ];
  assert.strictEqual(pickGeoResult(results).name, "Roma");
  // A country-only list still returns something
  assert.strictEqual(pickGeoResult([results[0]]).name, "Romania");
});

if (process.exitCode) {
  console.log(`\nFAILED — ${passed} checks passed before failure`);
} else {
  console.log(`\nAll ${passed} checks passed`);
}
