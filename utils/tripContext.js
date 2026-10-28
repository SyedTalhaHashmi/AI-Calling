/**
 * Per-call trip memory for the regex router: the route and hotel city from the last few turns,
 * so "average price?" or "$80 a night?" right after a trip question isn't asked again — and a
 * route split over turns ("from Milan to…" / "Rome.") is put back together.
 */
const { extractRouteParts } = require("./intentRouter");

/** Caller turns a remembered trip stays usable for. */
const RECENT_TURNS = 4;

function rememberTrip(session, fields) {
  if (!session) return;
  const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
  session.trip = { ...(session.trip || {}), ...kept, turn: session.callerTurns || 0 };
}

function recentTrip(session) {
  const trip = session?.trip;
  if (!trip || (session.callerTurns || 0) - trip.turn > RECENT_TURNS) return null;
  return trip;
}

/** This turn's cities, filled in from a route still waiting for one end. */
function completeRoute(text, pending) {
  const { from, to, others } = extractRouteParts(text);
  const rest = [...others];
  let origin = from;
  let destination = to;
  // A bare city answers whichever end is missing
  if (pending?.origin && !pending.destination && !origin && !destination && rest.length === 1) {
    return { origin: pending.origin, destination: rest[0] };
  }
  origin = origin || rest.shift() || null;
  destination = destination || rest.shift() || null;
  if (pending) {
    if (!origin && pending.origin !== destination) origin = pending.origin || null;
    if (!destination && pending.destination !== origin) destination = pending.destination || null;
  }
  return { origin, destination };
}

const NOT_A_PLACE = /\b(no|nope|never ?mind|forget it|nothing|thanks|thank you|okay|ok|yes|yeah|what|why|how|who|tell|help)\b/i;

/** "Miami." / "In Fort Myers, please" after "Which city?" → the place; anything longer is a new request. */
function shortPlaceReply(text) {
  const cleaned = String(text || "")
    .replace(/[.?!,]/g, " ")
    .replace(/\b(please|in|at|near|the city of)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.split(" ").length > 3 || NOT_A_PLACE.test(cleaned)) return null;
  return cleaned;
}

module.exports = { rememberTrip, recentTrip, completeRoute, shortPlaceReply, RECENT_TURNS };
