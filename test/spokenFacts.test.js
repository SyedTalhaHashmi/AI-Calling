/**
 * What Buddy says for weather, fares, hotels, and restaurants, plus the per-call trip memory
 * (production log 2026-10-28).
 * Run: node test/spokenFacts.test.js
 */
const assert = require("assert");
const {
  formatWeatherFact,
  formatFareFact,
  formatPlacesFact,
  hotelPriceInstruction,
  airlineName,
  cityName,
} = require("../utils/spokenFacts");
const { completeRoute, rememberTrip, recentTrip, shortPlaceReply } = require("../utils/tripContext");

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

console.log("spoken facts and trip memory\n");

const miami = { city: "Miami", country: "US", admin1: "Florida", temp: 27, description: "clear sky", humidity: 80 };
const bogota = { city: "Bogotá", country: "CO", admin1: "Bogota D.C.", temp: 20, description: "light drizzle", humidity: 50 };

check("U.S. weather is in Fahrenheit with the state, never a bare '27 degrees'", () => {
  const f = formatWeatherFact(miami);
  assert.ok(/81 degrees Fahrenheit and clear sky in Miami, Florida/.test(f), f);
  assert.ok(!/\b27\b/.test(f), f);
});

check("weather elsewhere says Celsius and the country name, not its code", () => {
  const f = formatWeatherFact(bogota);
  assert.ok(/20 degrees Celsius/.test(f) && /Bogotá, Colombia/.test(f), f);
  assert.ok(!/\bCO\b/.test(f), f);
});

check("a caller from a +1 number also hears Fahrenheit for foreign cities", () => {
  const f = formatWeatherFact(bogota, { callerNumber: "+16614226105" });
  assert.ok(/20 degrees Celsius, about 68 Fahrenheit/.test(f), f);
  assert.ok(!/Fahrenheit/.test(formatWeatherFact(bogota, { callerNumber: "+573001234567" })));
});

check("weather errors pass through unchanged", () => {
  assert.strictEqual(formatWeatherFact({ error: "Could not fetch weather." }), "Could not fetch weather.");
});

check("fare names cities, airline, trip type, spoken currency, and that dates aren't exact", () => {
  const f = formatFareFact({ origin: "BOG", destination: "MIA", price: 410, currency: "USD", airline: "AV", returnAt: "2026-11-09" });
  assert.ok(/Bogotá to Miami/.test(f), f);
  assert.ok(/410 US dollars/.test(f) && /round trip/.test(f) && /Avianca/.test(f), f);
  assert.ok(/not your exact dates/i.test(f), f);
  assert.ok(!/\b(BOG|MIA|USD)\b/.test(f), f);
});

check("fare without a return date is one-way; unknown airline codes are not read out", () => {
  const f = formatFareFact({ origin: "MIL", destination: "FCO", price: 39, currency: "USD", airline: "ZZ" });
  assert.ok(/Milan to Rome/.test(f) && /one-way/.test(f), f);
  assert.ok(!/\bZZ\b/.test(f), f);
});

check("airline and city lookups", () => {
  assert.strictEqual(airlineName("AV"), "Avianca");
  assert.strictEqual(airlineName("AZ"), "ITA Airways");
  assert.strictEqual(airlineName("??"), "");
  assert.strictEqual(cityName("BOG"), "Bogotá");
  assert.strictEqual(cityName("MIA"), "Miami");
});

const hotels = { places: [{ name: "Four Seasons Hotel Miami", rating: 4.7 }, { name: "Mayfair House", rating: 4.6 }] };

check("hotel list names the city", () => {
  const f = formatPlacesFact(hotels, { kind: "hotel", city: "Miami" });
  assert.ok(/^Popular hotels in Miami: Four Seasons Hotel Miami, rated 4\.7/.test(f), f);
});

check("Google's price level is said in words when present, left out when not", () => {
  const f = formatPlacesFact(
    { places: [{ name: "Four Seasons", rating: 4.7, priceLevel: "PRICE_LEVEL_VERY_EXPENSIVE" }, { name: "Motel Six", rating: 3.9, priceLevel: "PRICE_LEVEL_INEXPENSIVE" }, { name: "Plain Inn", rating: 4.1, priceLevel: "PRICE_LEVEL_UNSPECIFIED" }] },
    { kind: "hotel", city: "Miami" }
  );
  assert.ok(/Four Seasons, rated 4\.7, luxury/.test(f) && /Motel Six, rated 3\.9, budget/.test(f), f);
  assert.ok(/Plain Inn, rated 4\.1(;|\.)/.test(f) && !/UNSPECIFIED|PRICE_LEVEL/.test(f), f);
});

check("hotel price instruction: typical nightly range, labelled as not live, with the real hotels", () => {
  const r = hotelPriceInstruction("English", { city: "Miami", places: hotels.places, question: "like $80 per night?" });
  assert.ok(/^Reply in English only/.test(r), r);
  assert.ok(/typical nightly price range/i.test(r) && /Miami/.test(r), r);
  assert.ok(/not live/i.test(r) && /Booking dot com/.test(r), r);
  assert.ok(/Four Seasons Hotel Miami, rated 4\.7/.test(r), r);
  assert.ok(/\$80 per night/.test(r), "the caller's budget is passed on so it can be judged");
  assert.ok(/don't say you'll check/i.test(r), r);
  assert.ok(/never give a price for a named hotel/i.test(r), "no invented per-hotel prices");
  assert.ok(/up to 50 words/.test(r), r);
});

check("hotel price instruction: nights → total for the stay; month → season", () => {
  const r = hotelPriceInstruction("English", { city: "Miami", places: [], question: "q", nights: 3, month: "2026-12" });
  assert.ok(/3 nights/.test(r) && /total/i.test(r), r);
  assert.ok(/in December/.test(r) && /season/i.test(r), r);
  const plain = hotelPriceInstruction("English", { city: "Miami", places: [], question: "q" });
  assert.ok(!/nights:|season/i.test(plain), plain);
});

check("hotel price instruction still gives a typical range when the hotel search found nothing", () => {
  const r = hotelPriceInstruction("English", { city: "Miami", places: [], question: "How much is a hotel in Miami?" });
  assert.ok(/typical nightly price range/i.test(r) && /Miami/.test(r), r);
  assert.ok(!/These hotels/.test(r), r);
});

check("hotel price instruction: no price word for a named hotel unless given (live: Places had none)", () => {
  const r = hotelPriceInstruction("English", { city: "Miami", places: hotels.places, question: "q" });
  assert.ok(/don't call a named hotel budget, mid-range, expensive, or luxury/i.test(r), r);
  const budget = hotelPriceInstruction("English", { city: "Miami", places: hotels.places, question: "q", tier: "budget" });
  assert.ok(/search for budget hotels/i.test(budget), budget);
});

check("hotel price instruction for a trip says the fare first, word for word", () => {
  const fare = "The cheapest recent fare from Bogotá to Miami is about 410 US dollars, round trip, on Avianca.";
  const r = hotelPriceInstruction("Spanish", { city: "Miami", places: [], fareFact: fare, question: "flights and hotels?" });
  assert.ok(/^Reply in Spanish only/.test(r) && r.includes(fare), r);
  assert.ok(r.indexOf(fare) < r.indexOf("typical nightly"), r);
});

check("restaurant list names the city", () => {
  const f = formatPlacesFact({ places: [{ name: "Da Vittorio", rating: 4.8 }] }, { kind: "food", city: "Bergamo" });
  assert.ok(/^Popular restaurants in Bergamo: Da Vittorio, rated 4\.8/.test(f), f);
});

check("route completion: a bare city answers the missing end of a pending route", () => {
  assert.deepStrictEqual(completeRoute("Rome.", { origin: "MIL", destination: null }), { origin: "MIL", destination: "FCO" });
  assert.deepStrictEqual(completeRoute("from Bogota", { origin: null, destination: "MIA" }), { origin: "BOG", destination: "MIA" });
  assert.deepStrictEqual(completeRoute("to Miami", { origin: "BOG", destination: null }), { origin: "BOG", destination: "MIA" });
  assert.deepStrictEqual(completeRoute("Bogota to Miami next week", null), { origin: "BOG", destination: "MIA" });
  assert.deepStrictEqual(completeRoute("next week", { origin: "MIL", destination: null }), { origin: "MIL", destination: null });
});

check("trip memory is reused only for a few turns", () => {
  const s = { callerTurns: 3 };
  rememberTrip(s, { origin: "BOG", destination: "MIA", hotelCity: "Miami" });
  s.callerTurns = 6;
  assert.deepStrictEqual(
    { ...recentTrip(s), turn: undefined },
    { origin: "BOG", destination: "MIA", hotelCity: "Miami", turn: undefined }
  );
  s.callerTurns = 9;
  assert.strictEqual(recentTrip(s), null);
});

check("remembering keeps earlier fields the new turn didn't mention", () => {
  const s = { callerTurns: 1 };
  rememberTrip(s, { origin: "BOG", destination: "MIA" });
  rememberTrip(s, { hotelCity: "Miami" });
  assert.strictEqual(recentTrip(s).origin, "BOG");
  assert.strictEqual(recentTrip(s).hotelCity, "Miami");
});

check("a short reply to 'Which city?' is taken as the place; a sentence is not", () => {
  assert.strictEqual(shortPlaceReply("Miami."), "Miami");
  assert.strictEqual(shortPlaceReply("In Fort Myers, please"), "Fort Myers");
  assert.strictEqual(shortPlaceReply("Tell me a fun fact about octopuses."), null);
  assert.strictEqual(shortPlaceReply("Never mind."), null);
});

if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
