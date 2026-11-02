/**
 * Fixed answers about the assistant itself: its name (Buddy), who created it, and what the
 * service does (recording, texting) — production 2026-10-30, the model said calls are recorded
 * and that Buddy can text.
 */

const NAME_REPLY = "I'm Buddy, your AI friend.";
const CREATOR_REPLY = "I was created by Brash3D Media Group.";
const NAME_AND_CREATOR_REPLY = "I'm Buddy, and I was created by Brash3D Media Group.";
const MODEL_REPLY = "I'm Buddy, built by Brash3D Media Group.";
const RECORDING_REPLY =
  "No, this call isn't recorded. If you have a BuddyCallAI account, we email a text transcript of our conversation to your registered email.";
const TEXTING_REPLY =
  "I'm voice only for now, so there's no texting or text chat. You can call me anytime.";

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

/** "Is this thing recorded?" / "Are you recording me?" / "¿Se está grabando?" */
function isRecordingQuestion(t) {
  return (
    /\b(?:is|was)\s+(?:this|it|that)(?:\s+(?:thing|call|conversation|chat|line))?\s+(?:being\s+)?recorded\b/.test(t) ||
    /\b(?:is|are)\s+(?:the|our|my|these)\s+(?:call|calls|conversation|conversations|chat|chats)\s+(?:being\s+)?recorded\b/.test(t) ||
    /\b(?:do|are|will|did)\s+you\s+(?:record|recording|save|store|keep)\b.*\b(?:call|calls|me|this|conversation|voice|audio)\b/.test(t) ||
    /\bare\s+you\s+recording\b/.test(t) ||
    /\b(?:se\s+)?(?:est[aá]s?\s+)?grab(?:a|ando|ada|ado|an)\b/.test(t)
  );
}

/** "Do you text?" / "Can I text you?" / "Are the texts free?" — not "text me the link" (the model gives a site). */
function isTextingQuestion(t) {
  return (
    /^[\s,]*(?:so|and|but|ok|okay)?[\s,]*(?:do|can|could)\s+(?:you|i|we)\s+(?:also\s+)?(?:text|sms|message)(?:\s+(?:you|me|with you|each other))?[\s.?!]*$/.test(t) ||
    /\btext\s+chat\b|\bchat\s+by\s+text\b|\btexting\b/.test(t) ||
    /\b(?:are|is)\s+(?:the\s+)?(?:texts?|text messages|messages)\s+free\b/.test(t) ||
    /\bmensajes?\s+de\s+texto\b/.test(t)
  );
}

/** The fixed reply when the caller asks Buddy's name, creator, model, or about recording or texting; otherwise null. */
function identityReply(text) {
  const t = String(text || "").toLowerCase().replace(/[’]/g, "'");
  if (isRecordingQuestion(t)) return RECORDING_REPLY;
  if (isTextingQuestion(t)) return TEXTING_REPLY;
  if (isModelQuestion(t)) return MODEL_REPLY;
  const name = isNameQuestion(t);
  const creator = isCreatorQuestion(t);
  if (name && creator) return NAME_AND_CREATOR_REPLY;
  if (creator) return CREATOR_REPLY;
  if (name) return NAME_REPLY;
  return null;
}

module.exports = { identityReply };
