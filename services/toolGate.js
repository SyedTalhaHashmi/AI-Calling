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

/** An admin switched the service off (kill switch). */
function unavailable(key) {
  const what = NOUN[key]?.one || "this lookup";
  return `Sorry, ${what} isn't available right now. Please try again later.`;
}

function limitReached(key, { limit, resetsAt, canUpgrade }, now = Date.now) {
  const many = NOUN[key]?.many || "lookups";
  let when = "";
  const d = resetsAt ? new Date(resetsAt) : null;
  if (d && !Number.isNaN(d.getTime())) {
    // The monthly reset runs a few minutes after the period ends
    when =
      d.getTime() <= now()
        ? " They reset in the next few minutes."
        : ` They reset on ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}.`;
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
  // Keys are unique per stream too, so a reconnect of the same call never reuses one
  const streamTag = require("crypto").randomBytes(4).toString("hex");
  const OK = { ok: true, done() {}, giveBack() {} };
  /** Tools the platform said are used up, with the sentence to say. */
  const exhausted = new Map();

  async function check(key, toolName) {
    if (!key) return OK;
    const access = session?.toolAccess;
    // Switched off by an admin: not called, for any plan
    if (access?.off?.includes(key)) return { ok: false, say: unavailable(key), done() {}, giveBack() {} };
    // Platform off, or an older platform that doesn't send tool info: tools stay on.
    // Platform off, or an older platform that doesn't send tool info: tools stay on.
    // Old unlimited plans still ask (always allowed), so a switch-off during the call
    // applies and every lookup is recorded for the cost report.
    if (!platformApi?.enabled || !access) return OK;
    if (access.mode === "unlimited" && !session?.platformUserId) return OK;
    const trial = session?.billingMode === "trial" || !session?.platformUserId;
    if (access.mode === "none" || trial) {
      return { ok: false, say: notInPlan(key, { trial, canUpgrade: access.canUpgrade }), done() {}, giveBack() {} };
    }
    if (access.mode === "limited" && !(access.limits?.[key] > 0)) {
      return { ok: false, say: notInPlan(key, { trial: false, canUpgrade: access.canUpgrade }), done() {}, giveBack() {} };
    }

    const used = exhausted.get(key);
    if (used) return { ok: false, say: used, done() {}, giveBack() {} };

    seq += 1;
    const payload = {
      action: "reserve",
      userId: session.platformUserId,
      key: `${callSid || "nocall"}:${streamTag}:${key}:${seq}`,
      tool: key,
      toolName,
      callSid,
    };
    const refusal = (data) =>
      data.reason === "service_off"
        ? unavailable(key)
        : data.reason === "limit_reached"
          ? limitReached(key, data)
          : notInPlan(key, { trial: false, canUpgrade: data.canUpgrade });

    const asked = Promise.resolve().then(() => platformApi.toolUse(payload));
    const out = await withTimeout(asked, timeoutMs).catch((err) => ({ ok: false, error: err.message }));
    if (out?.ok && out.data) {
      if (!out.data.allowed) {
        logger.info({ callSid, tool: key, reason: out.data.reason }, "Tool refused by plan limit");
        const say = refusal(out.data);
        // Used up for the rest of this call: later asks are refused without asking again
        exhausted.set(key, say);
        return { ok: false, say, done() {}, giveBack() {} };
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        platformApi.queueToolReport("tool-release", { ...payload, action: "release" });
      };
      return {
        ok: true,
        // A failed lookup gives its unit back
        done(result) {
          if (result?.error) release();
        },
        // The answer was not used (another part of the turn was refused), even after it worked
        giveBack: release,
      };
    }
    // No answer in time: answer anyway, and count the use later if the lookup worked
    // (same key, so a reserve that did arrive is not counted twice).
    logger.warn({ callSid, tool: key, err: out?.error || (out?.timedOut ? "timeout" : `status ${out?.status}`) }, "Tool check unavailable; answering and counting later");
    // If the late answer says the tool is used up, the rest of the call knows it
    asked
      .then((late) => {
        if (late?.ok && late.data && !late.data.allowed) exhausted.set(key, refusal(late.data));
      })
      .catch(() => {});
    let recorded = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      platformApi.queueToolReport("tool-release", { ...payload, action: "release" });
    };
    return {
      ok: true,
      done(result) {
        if (result?.error) return release();
        if (recorded || released) return;
        recorded = true;
        platformApi.queueToolReport("tool-record", { ...payload, action: "record" });
      },
      // Record and release use the same key; in either order the platform ends with no unit.
      giveBack: release,
    };
  }

  return { check };
}

module.exports = { createToolGate, toolLimitKey, labelLimitKey, notInPlan, limitReached, unavailable };
