/**
 * Fixed answers about the assistant itself: its name (Buddy) and who created it.
 */

const NAME_REPLY = "I'm Buddy, your AI friend.";
const CREATOR_REPLY = "I was created by Brash3D Media Group.";
const NAME_AND_CREATOR_REPLY = "I'm Buddy, and I was created by Brash3D Media Group.";
const MODEL_REPLY = "I'm Buddy, built by Brash3D Media Group.";

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

/** "What AI model are you?" / "Are you ChatGPT?" / "Is this OpenAI?" — about Buddy itself, not AI in general. */
function isModelQuestion(t) {
  return (
    /\b(?:what|which) (?:ai |language )?(?:model|llm|technology|tech|ai|engine)\b.*\b(?:are you|do you (?:use|run on)|you (?:use|run on)|powers you|are you (?:built|based|running) on)\b/.test(t) ||
    /\b(?:are you|is this|is it) (?:chat ?gpt|gpt(?:[- ]?\d\w*)?|open ?ai|an? open ?ai\b|gemini|claude)\b/.test(t) ||
    /\bare you (?:powered|made|built|run|based) (?:by|on) (?:chat ?gpt|gpt|open ?ai)\b/.test(t) ||
    /\bwhat (?:are you|do you) (?:built|based|running|run) on\b/.test(t) ||
    /\bwhat(?:'s| is) (?:your|the) (?:ai )?model\b/.test(t) ||
    // "Which company made the technology you run on?" / "Who made the AI behind you?"
    new RegExp(`\\b(?:who|which company|what company)\\b.*\\b(?:${MADE_VERBS}|owns)\\b.*\\b(?:technology|tech|ai|model|llm|engine)\\b.*\\b(?:you|behind you)\\b`).test(t) ||
    /\b(?:which|what) company'?s? (?:ai|model|technology)\b.*\byou\b/.test(t) ||
    /\b(?:eres|usas) (?:chat ?gpt|open ?ai)\b/.test(t)
  );
}

/** The fixed reply when the caller asks Buddy's name, creator, or underlying model; otherwise null. */
function identityReply(text) {
  const t = String(text || "").toLowerCase().replace(/[’]/g, "'");
  if (isModelQuestion(t)) return MODEL_REPLY;
  const name = isNameQuestion(t);
  const creator = isCreatorQuestion(t);
  if (name && creator) return NAME_AND_CREATOR_REPLY;
  if (creator) return CREATOR_REPLY;
  if (name) return NAME_REPLY;
  return null;
}

module.exports = { identityReply };
