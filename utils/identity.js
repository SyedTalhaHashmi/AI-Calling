/**
 * Fixed answers about the assistant itself: its name (Buddy) and who created it.
 */

const NAME_REPLY = "I'm Buddy, your AI friend.";
const CREATOR_REPLY = "I was created by Brash3D Media Group.";
const NAME_AND_CREATOR_REPLY = "I'm Buddy, and I was created by Brash3D Media Group.";

const MADE_VERBS = "made|created|built|developed|designed|programmed|trained";

/** "What's your name?" / "Who are you?" / "¿Cómo te llamas?" */
function isNameQuestion(t) {
  return (
    /\bwhat(?:'s| is) your name\b/.test(t) ||
    /\bwho are you\b(?!\s+(?:made|created|built|developed) by)/.test(t) ||
    /\bdo you have a name\b/.test(t) ||
    /\bwhat (?:should|can|do) i call you\b/.test(t) ||
    /c[oó]mo te llamas|cu[aá]l es tu nombre/.test(t)
  );
}

/** "Who made you?" / "Which company created you?" / "¿Quién te creó?" */
function isCreatorQuestion(t) {
  return (
    new RegExp(`\\bwho (?:${MADE_VERBS}|owns) (?:you|buddy)\\b`).test(t) ||
    /\bwho(?:'s| is) (?:your|buddy's) (?:creator|maker|developer|owner|company)\b/.test(t) ||
    new RegExp(`\\b(?:which|what) company (?:${MADE_VERBS}|owns) you\\b`).test(t) ||
    new RegExp(`\\bwho (?:are|were) you (?:${MADE_VERBS}) by\\b`).test(t) ||
    /\bwho(?:'s| is) behind (?:you|buddy)\b/.test(t) ||
    /qui[eé]n te (?:cre[oó]|hizo|desarroll[oó]|construy[oó]|program[oó])/.test(t)
  );
}

/** The fixed reply when the caller asks Buddy's name and/or creator; otherwise null. */
function identityReply(text) {
  const t = String(text || "").toLowerCase().replace(/[’]/g, "'");
  const name = isNameQuestion(t);
  const creator = isCreatorQuestion(t);
  if (name && creator) return NAME_AND_CREATOR_REPLY;
  if (creator) return CREATOR_REPLY;
  if (name) return NAME_REPLY;
  return null;
}

module.exports = { identityReply };
