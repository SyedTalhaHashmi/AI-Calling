/**
 * Honest billing / trial answers from session facts (never invent "unlimited free").
 */

function isBillingQuestion(text) {
  const t = String(text || "").toLowerCase();
  // Avoid stealing "how long is the flight" — require plan/free/trial/cost cues
  const hasPlanCue =
    /\b(free|trial|subscribe|subscription|minutes?|unlimited|no charge|pricing|plan|pay|cost)\b/i.test(
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
 * Fixed spoken answer from session billing fields.
 */
function billingReply(session) {
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
    `See minutes and pricing at buddycallai dot com. Never assume unlimited free time.`
  );
}

/** Extra session instruction so chat path stays honest even without fast path. */
function billingInstruction(session) {
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
  billingReply,
  billingInstruction,
  formatSecondsFriendly,
};
