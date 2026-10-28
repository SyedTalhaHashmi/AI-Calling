/**
 * Crisis messages (self-harm, suicide, abuse, immediate danger) get a dedicated caring turn
 * with 988 / 911 — this must not depend on the model remembering the session prompt.
 * Everyday figures of speech ("I'd die for a pizza", "this traffic is killing me") are not crises.
 */

const CRISIS_PATTERNS = [
  /\b(?:kill|hurt|harm|cut|cutting) myself\b/,
  /\bsuicid(?:e|al)\b(?! squad)/,
  /\b(?:want|wanna|going|planning|ready) to die\b/,
  /\bjust want to die\b/,
  /\bdon'?t want to (?:live|be alive|wake up)\b/,
  /\bend (?:my life|it all)\b/,
  /\btake my (?:own )?life\b/,
  /\bno reason to live\b/,
  /\bbetter off (?:dead|without me)\b/,
  /\b(?:is|keeps|has been|was|been) (?:hitting|beating|hurting|abusing|choking) me\b/,
  /\bi'?m (?:being )?(?:abused|in danger)\b/,
  /\bsomeone (?:is )?(?:trying|going) to (?:kill|hurt) me\b/,
  /\b(?:quiero|me quiero) (?:morir|matar)\b/,
  /\bno quiero vivir\b/,
  /\bsuicid(?:io|arme)\b/,
];

function isCrisisMessage(text) {
  const t = String(text || "").toLowerCase().replace(/[’]/g, "'");
  return CRISIS_PATTERNS.some((re) => re.test(t));
}

/** Turn instruction for a crisis message (no tools, no subject change). */
function crisisInstruction(langName) {
  return (
    `Reply in ${langName} only. The caller may be in crisis or in danger. Respond with real warmth in 2 or 3 short sentences: ` +
    `thank them for telling you, encourage them to call or text 988 (Suicide & Crisis Lifeline, US and Canada) right now, ` +
    `or 911 if they are in immediate danger; if they are outside the US or Canada, their local emergency number. ` +
    `If someone is hurting or abusing them, also give the National Domestic Violence Hotline, 1-800-799-7233. ` +
    `Then gently ask what's going on. Stay with them: do not change the subject, joke, or lecture.`
  );
}

/**
 * Appended to every ordinary model turn: the per-turn text outweighs the session prompt, which
 * gave cold brush-offs to sexual remarks and "I can't check live updates" in a sample run.
 */
const SENSITIVE_TURN_NOTE =
  " If the message is sexual, rude, hateful, or asks for something harmful, be kind: acknowledge it in one calm sentence, " +
  "say what you can't do, and offer something helpful (for sexual remarks, offer to talk about dating or relationships). " +
  "If asked what you can do or about live information, say you can check live weather, local time, news, exchange rates, flights, sports scores, stocks, and crypto.";

module.exports = { isCrisisMessage, crisisInstruction, SENSITIVE_TURN_NOTE };
