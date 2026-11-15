/**
 * Live-tool gate (FINAL APIs §6): before a paid lookup, check the caller's plan and
 * monthly limit with the platform and reserve one unit; give it back if the lookup
 * fails. When a tool isn't in the plan or is used up, Buddy says so (and offers an
 * upgrade) and no paid API is called.
 *
 * If the platform can't be reached in time, the caller still gets the answer (the
 * plan includes the tool) and the use is reported later through the outbox.
 */

const TOOL_KEYS = {
  get_weather: "weather",
  get_flight_fare: "flights",
  get_flight_status: "flights",
  web_search: "research",
  get_news: "research",
  get_sports_scores: "research",
  get_crypto_price: "research",
  get_stock_quote: "research",
  get_us_interest_rate: "research",
  get_exchange_rate: "research",
};

/** Regex-mode lookups, by their timing label. */
const LABEL_KEYS = {
  weather: "weather",
  places_hotels: "hotels",
  places_food: "maps",
  places_text: "maps",
  travel_fare: "flights",
  flight_status: "flights",
  news: "research",
  sports: "research",
  fx: "research",
  crypto: "research",
  rates: "research",
  stocks: "research",
  web_search: "research",
};

/** Plan limit key for a tools-mode call, or null when the tool is free (time). */
function toolLimitKey(name, args = {}) {
  if (name === "find_places") return args?.kind === "hotel" ? "hotels" : "maps";
  return TOOL_KEYS[name] || null;
}

function labelLimitKey(label) {
  return LABEL_KEYS[label] || null;
}

const NOUN = {
  research: { one: "live internet search", many: "internet searches" },
  weather: { one: "live weather", many: "weather checks" },
  flights: { one: "live flight search", many: "flight searches" },
  hotels: { one: "live hotel search", many: "hotel searches" },
  maps: { one: "live places search", many: "places searches" },
  reminders: { one: "reminder calls", many: "reminder calls" },
};

const SITE = "buddycallai dot com";

function notInPlan(key, { trial, canUpgrade = true }) {
  const what = NOUN[key]?.one || "this lookup";
  if (trial) return `Sorry, ${what} is for members. You can sign up at ${SITE}.`;
  return canUpgrade
    ? `Sorry, ${what} isn't included in your plan. Plus and Family Premium include it; you can upgrade at ${SITE}.`
    : `Sorry, ${what} isn't included in your plan.`;
}

function limitReached(key, { limit, resetsAt, canUpgrade }) {
  const many = NOUN[key]?.many || "lookups";
  let when = "";
  const d = resetsAt ? new Date(resetsAt) : null;
  if (d && !Number.isNaN(d.getTime())) {
    when = ` They reset on ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}.`;
  }
  const count = limit ? `all ${limit} ${many}` : `all the ${many}`;
  const upgrade = canUpgrade === false ? "" : ` For more, you can upgrade your plan at ${SITE}.`;
  return `You've used ${count} included in your plan this month.${when}${upgrade}`;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, timedOut: true }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {{ platformApi, session, callSid, logger, timeoutMs? }} opts
 *   session: the call's store entry (toolAccess, platformUserId, billingMode)
 */
function createToolGate({ platformApi, session, callSid, logger, timeoutMs = 1500 }) {
  let seq = 0;
  const OK = { ok: true, done() {} };

  async function check(key, toolName) {
    if (!key) return OK;
    const access = session?.toolAccess;
    // Platform off, or an older platform that doesn't send tool info: tools stay on.
    if (!platformApi?.enabled || !access || access.mode === "unlimited") return OK;
    const trial = session?.billingMode === "trial" || !session?.platformUserId;
    if (access.mode === "none" || trial) {
      return { ok: false, say: notInPlan(key, { trial, canUpgrade: access.canUpgrade }), done() {} };
    }
    if (access.mode === "limited" && !(access.limits?.[key] > 0)) {
      return { ok: false, say: notInPlan(key, { trial: false }), done() {} };
    }

    seq += 1;
    const payload = {
      action: "reserve",
      userId: session.platformUserId,
      key: `${callSid}:${key}:${seq}`,
      tool: key,
      toolName,
      callSid,
    };
    let released = false;
    const done = (result) => {
      if (released || !result?.error) return;
      released = true;
      platformApi.queueToolReport("tool-release", { ...payload, action: "release" });
    };

    const out = await withTimeout(Promise.resolve().then(() => platformApi.toolUse(payload)), timeoutMs).catch((err) => ({
      ok: false,
      error: err.message,
    }));
    if (out?.ok && out.data) {
      if (out.data.allowed) return { ok: true, done };
      logger.info({ callSid, tool: key, reason: out.data.reason }, "Tool refused by plan limit");
      const say =
        out.data.reason === "limit_reached"
          ? limitReached(key, out.data)
          : notInPlan(key, { trial: false, canUpgrade: out.data.canUpgrade });
      return { ok: false, say, done() {} };
    }
    // No answer in time: answer anyway, and count the use later if the lookup worked
    // (same key, so a reserve that did arrive is not counted twice).
    logger.warn({ callSid, tool: key, err: out?.error || (out?.timedOut ? "timeout" : `status ${out?.status}`) }, "Tool check unavailable; answering and counting later");
    let reported = false;
    return {
      ok: true,
      done(result) {
        if (reported) return;
        reported = true;
        if (result?.error) platformApi.queueToolReport("tool-release", { ...payload, action: "release" });
        else platformApi.queueToolReport("tool-record", { ...payload, action: "record" });
      },
    };
  }

  return { check };
}

module.exports = { createToolGate, toolLimitKey, labelLimitKey, notInPlan, limitReached };
