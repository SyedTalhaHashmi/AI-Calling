/**
 * Current time — no API, uses server clock.
 * Optional timezone for "what time is it in New York".
 */
const COMMON_TZ = {
  "new york": "America/New_York",
  "london": "Europe/London",
  "paris": "Europe/Paris",
  "tokyo": "Asia/Tokyo",
  "dubai": "Asia/Dubai",
  "sydney": "Australia/Sydney",
  "los angeles": "America/Los_Angeles",
  "chicago": "America/Chicago",
  "miami": "America/New_York",
  "india": "Asia/Kolkata",
  "mumbai": "Asia/Kolkata",
  "delhi": "Asia/Kolkata",
  "karachi": "Asia/Karachi",
};

function getCurrentTime(timezone) {
  const tz = timezone || "UTC";
  try {
    const time = Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeStyle: "short",
      hour12: true,
    }).format(new Date());
    return { time, timezone: tz };
  } catch {
    return { time: new Date().toLocaleTimeString("en-US", { hour12: true }), timezone: "UTC" };
  }
}

function createTimeService() {
  return {
    enabled: true,
    getCurrentTime,
    /** Resolve "in X" to IANA timezone for common cities. */
    resolveTimezone(text) {
      const t = (text || "").toLowerCase();
      const inMatch = t.match(/\b(?:in|at)\s+([a-z\s]+?)(?:\?|\.|$)/i);
      const place = inMatch ? inMatch[1].trim().replace(/\s+/g, " ") : "";
      return COMMON_TZ[place] || null;
    },
  };
}

module.exports = createTimeService;
