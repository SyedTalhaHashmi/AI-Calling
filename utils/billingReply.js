/**
 * Honest billing / trial answers from session facts (never invent "unlimited free").
 */

/**
 * Plans and prices — keep in sync with backend/src/lib/plans.js and backend/src/config.js
 * (DISPLAY_PRICE_*_USD, PAYG_PER_MINUTE_USD, PLATINUM_OVERAGE_PER_MINUTE_USD defaults).
 */
const PLAN_CATALOG_REPLY =
  "BuddyCallAI has Pay-As-You-Go at 59 cents a minute with no monthly fee. " +
  "Silver is 9 dollars a month for 20 minutes, Gold is 29 dollars a month for 60 minutes, " +
  "and Platinum is 69 dollars a month for 150 minutes, then 55 cents a minute. " +
  "You can sign up at buddycallai dot com.";
const PLAN_CATALOG_FACTS =
  "Plans (authoritative): Pay-As-You-Go $0.59/min, no monthly fee; Silver $9/month, 20 min; " +
  "Gold $29/month, 60 min; Platinum $69/month, 150 min then $0.55/min. Sign up at buddycallai.com.";

/** "What are the Buddy Call plans / packages / prices?" — the plan list, not this call's time. */
function isPlanCatalogQuestion(text) {
  const t = String(text || "").toLowerCase();
  const offer = /\b(plans?|packages?|pricing|prices?|costs?|subscriptions?|tiers?|planes|precios?|paquetes?)\b/i;
  if (/\bbuddy\s*call/i.test(t) && offer.test(t) && !/\b(talking|talk) about\b/i.test(t)) return true;
  return (
    /\b(what|which)\s+(plans|packages|subscriptions)\s+do\s+you\s+(have|offer)\b/i.test(t) ||
    /\bwhat\s+(plans|packages|subscriptions)\s+(are there|are available)\b/i.test(t) ||
    /\b(your|the buddy\w*)\s+(packages|pricing|prices|subscriptions?)\b/i.test(t)
  );
}

function isBillingQuestion(text) {
  const t = String(text || "").toLowerCase();
  if (isPlanCatalogQuestion(t)) return true;
  // "this call is free or what" — same ask as "is this call free?"
  if (/\b(this|the|my)\s+(phone\s+)?call\s+(is\s+)?free\b/i.test(t)) return true;
  // Trial-call wordings (production 2026-10-28) that chat answered with "no strict limit" / "it's free"
  if (
    /\bhow long (does|will|can|do) (this|the|my) ?(call|conversation|chat|trial)?\s*(last|go on|go)\b/i.test(t) ||
    /\bhow long can (i|we) (talk|chat|speak|stay)\b/i.test(t) ||
    /^[\s,]*(the|this|my)\s+(phone\s+)?(call|trial)[\s.?!]*$/i.test(t) ||
    /\blimit\b.*\b(with you|to talk|(on|for) (this|the|my) call)\b|\b(talk|call|time|trial) limit\b/i.test(t) ||
    /\bis there (a|any) (time |call |talk )?limit[\s.?!]*$/i.test(t) ||
    /^[\s,]*(and|so|but|oh)?[\s,]*(it['’]?s|it is|this is|is this|is it|that['’]?s)\s+(really\s+|totally\s+|completely\s+)?free\b/i.test(t)
  ) {
    return true;
  }
  // Avoid stealing "how long is the flight" — require plan/free/trial/cost cues
  const hasPlanCue =
    /\b(free|trial|subscribe|subscription|minutes?|unlimited|no charge|pricing|plan|pay|cost|limit|usage)\b/i.test(
      t
    ) || /\b(gratis|prueba|minutos|ilimitado)\b/i.test(t);
  const hasTimeAsk =
    /\b(how long|how much time|time left|minutes left|talk for|cu[aá]nto tiempo)\b/i.test(
      t
    );
  if (hasTimeAsk && hasPlanCue) return true;
  if (
    /\b(free trial|talk for free|for free|without paying|no charge|unlimited)\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b((do|does|did|have|has|will|must|need) i (have to |need to )?pay|have to pay|need to pay|is (this|it) free|do i (have|need) to pay)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // "Is this call free?" / "Are calls free?" — free asked about this call or service only
  // (not "is the museum free"). Baseline miss: went to chat, which said "completely free".
  if (
    /\b(is|are)\s+(this|the|my|these|our|your)\s+(phone\s+)?(call|calls|chat|conversation|service)\s+free\b/i.test(
      t
    ) ||
    /\b(is|are)\s+(calling|talking)(\s+(to|with))?(\s+you)?\s+free\b/i.test(t) ||
    /\bllamadas?\b.*\bgratis\b|\bgratis\b.*\bllamadas?\b/i.test(t)
  ) {
    return true;
  }
  // Monthly/usage limits, minutes caps — never let chat invent "unlimited"
  if (
    /\b((monthly|daily|weekly|usage|talk|call|minute|time)\s+limit|limit\s+to\s+speak|how many minutes|minutes (per|a) month)\b/i.test(
      t
    ) ||
    /\bdo i have a (monthly|daily|weekly|usage)?\s*limit\b/i.test(t) ||
    /\b(is there|any) (a )?(monthly|daily|usage) limit\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b(subscribe|subscription|pricing|how much (does|do) (it|this) cost)\b/i.test(t) &&
    /\b(call|talk|minute|plan|buddy)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

function formatSecondsFriendly(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s < 90) return `about ${s} seconds`;
  const mins = Math.round(s / 60);
  return `about ${mins} minute${mins === 1 ? "" : "s"} (${s} seconds)`;
}

/**
 * Fixed spoken answer from session billing fields; the plan list when they asked about plans.
 */
function billingReply(session, text = "") {
  if (isPlanCatalogQuestion(text)) return PLAN_CATALOG_REPLY;
  const mode = session?.billingMode || "legacy";
  const max = session?.maxBillableSeconds;

  if (mode === "trial" && max != null && max > 0) {
    return (
      `This free trial call lasts ${formatSecondsFriendly(max)}. ` +
      `To keep talking after that, subscribe or add minutes at buddycallai dot com.`
    );
  }

  if (mode === "subscriber" && max != null && max > 0) {
    return (
      `You have ${formatSecondsFriendly(max)} remaining on your plan right now. ` +
      `You can add minutes at buddycallai dot com.`
    );
  }

  if (mode === "subscriber_platinum" || mode === "overage") {
    return (
      `You're on a plan that can continue past included minutes. ` +
      `Check your balance anytime at buddycallai dot com.`
    );
  }

  if (max != null && max > 0) {
    return (
      `This call can last up to ${formatSecondsFriendly(max)}. ` +
      `For plans and pricing, see buddycallai dot com.`
    );
  }

  return (
    `Call time depends on your Buddy Call plan. ` +
    `See minutes and pricing at buddycallai dot com.`
  );
}

/** Extra session instruction so chat path stays honest even without fast path. */
/**
 * Appended to every model turn: a missed billing question still can't get "free with no limit"
 * (the session-level facts alone were ignored on a production trial call).
 */
function billingTurnNote(session) {
  const mode = session?.billingMode || "legacy";
  const max = Math.floor(Number(session?.maxBillableSeconds) || 0);
  if (mode === "trial" && max > 0) {
    return ` This call is a free trial that lasts ${max} seconds. If asked about cost, free time, or limits, say exactly that; never say it is free with no limit or unlimited.`;
  }
  if (mode === "subscriber" && max > 0) {
    return ` The caller has about ${max} seconds left on their plan. If asked about time or cost, say that; never say it is free or unlimited.`;
  }
  if (mode === "subscriber_platinum" || mode === "overage") {
    return " If asked about time or cost, point to buddycallai dot com; never say it is free or unlimited.";
  }
  return "";
}

function billingInstruction(session) {
  // Plan list too, so follow-ups ("which plan has the most minutes?") are answered from facts
  return `${sessionBillingFacts(session)} ${PLAN_CATALOG_FACTS}`;
}

function sessionBillingFacts(session) {
  const mode = session?.billingMode || "legacy";
  const max = session?.maxBillableSeconds;
  if (mode === "trial" && max != null && max > 0) {
    return (
      `Billing facts (authoritative): this is a trial call capped at ${Math.floor(max)} seconds. ` +
      `If asked about free time, length, cost, or minutes, say that clearly and mention buddycallai.com to subscribe. ` +
      `Never say unlimited, forever free, or no charge for unlimited talking.`
    );
  }
  if (mode === "subscriber" && max != null && max > 0) {
    return (
      `Billing facts (authoritative): subscriber with about ${Math.floor(max)} seconds remaining this call. ` +
      `If asked about time left or cost, use that fact. Never say unlimited free.`
    );
  }
  if (mode === "subscriber_platinum" || mode === "overage") {
    return (
      `Billing facts: platinum/overage plan — may continue past included minutes. ` +
      `If asked about cost/time, point to buddycallai.com. Never invent free unlimited time.`
    );
  }
  return (
    `Billing facts: if asked about free time or cost, do not invent unlimited free talking; ` +
    `point callers to buddycallai.com for plans.`
  );
}

module.exports = {
  isBillingQuestion,
  isPlanCatalogQuestion,
  billingReply,
  billingInstruction,
  billingTurnNote,
  formatSecondsFriendly,
};
