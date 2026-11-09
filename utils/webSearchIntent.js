/**
 * Regex mode: questions that go to web search (Exa, Tavily backup) because no other lookup covers them.
 * Two kinds, kept narrow so ordinary chat stays free and instant:
 *  - the caller asks to search ("look up…", "google…", "check their website…"), with or without a topic
 *  - a live question ("who is the current…", "latest on…", "…open today?", "who won…")
 */

/** Greetings and polite openers, removed before reading the question. */
const LEAD =
  /^(?:(?:hey|hi|hello|ok(?:ay)?|so|well|um+|uh+|buddy|and|but|alright)[,.!\s]+)*(?:(?:can|could|would|will) you(?: please)?|please|i (?:want|need) you to|do you know|(?:can|could) i ask you)?\s*/i;
/** "tell me / find out" after the opener: the rest is the question even without a question word. */
const ASK_VERB = /^(?:(?:just\s+)?(?:tell me|let me know|find out|check)\b\s*)/i;

const EXPLICIT = [
  /\b(?:search|google)\s+(?:it|that|this|for|about|online|up|the\s+web|the\s+internet)\b/i,
  /(?:^|\byou\s+(?:please\s+)?)(?:search|google)\b/i,
  /\bgoogle\s+(?:who|what|when|where|how|why|is|are|the)\b/i,
  /\blook\s+(?:it|that|this)\s+up\b/i,
  /\blook\s+up\b(?!\s+(?:at|to)\b)/i,
  /\bcheck\s+(?:it\s+|that\s+|this\s+)?(?:online|on\s+the\s+(?:web|internet))\b/i,
  /\bcheck\s+(?:the\s+|a\s+|their\s+|its\s+|that\s+|this\s+|your\s+)?(?:[a-z0-9'.-]+\s+){0,2}(?:website|web\s?site|site|web\s?page|page)\b/i,
  /\b(?:browse|surf|search)\s+(?:the\s+)?(?:web|internet)\b/i,
  /\bopen\s+(?:a\s+|the\s+)?(?:website|web\s?site|link|web\s?page)\b/i,
];

/** Search words removed from the query. */
const TRIGGER_WORDS =
  /\b(?:search|google)(?:\s+(?:the\s+)?(?:web|internet))?(?:\s+(?:online|up))?(?:\s+(?:for|about))?\b|\blook\s+(?:it|that|this)\s+up\b|\blook\s+up\b|\b(?:browse|surf)(?:\s+the\s+(?:web|internet))?\b|\b(?:on|from)\s+the\s+(?:web|internet)\b|\bonline\b|\bfor me\b|\bplease\b|\bquick(?:ly)?\b/gi;

/** Words that don't make a topic ("You can't check a website for me?" has none). */
const FILLER = new Set(
  (
    "you can can't cant cannot could would will a an the it that this these those me for to of please " +
    "website websites web site sites webpage page internet online check search look up google browse surf open " +
    "some something stuff things thing i do does did ok okay so just really yes yeah sure go ahead and or " +
    "anything link links real quick for me there here now again"
  ).split(" ")
);

const LIVE_WORD =
  /\b(?:today|tonight|right now|currently|at the moment|these days|this (?:week|weekend|month|year|morning|afternoon|evening)|latest|recent(?:ly)?|so far|updates? (?:on|about)|happening (?:with|in|at)|still open|open now)\b|\bcurrent\s+(?!(?:in|of|is|and|flows?|through)\b)[a-z]/i;
const QUESTION_START =
  /^(?:who|who's|whos|what|what's|whats|when|where|which|is|are|was|were|did|does|do|has|have|how much|how many|how is|how are|any)\b/i;
const WHO_WON = /\bwho\s+won\b/i;
/** About the caller or Buddy, not the world: chat. */
const PERSONAL = /\b(?:i|i'm|im|i've|i'll|i'd|me|my|mine|myself|we|we're|our|ours|you|your|you're|yourself|buddy)\b/i;
/** Lowercase "us" is the caller ("tell us"); "US" is the country. */
const PERSONAL_US = /\bus\b/;
/** Covered elsewhere or not a lookup. */
const NOT_LIVE_TOPIC = /\b(?:date|day|time|joke|story|riddle|poem|weather|temperature|mood|feeling|feel)\b/i;

function stripLead(text) {
  return String(text || "").trim().replace(LEAD, "");
}

function cleanQuery(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, "")
    .replace(/^(?:for|about|on)\s+/i, "")
    .trim();
}

function hasTopic(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.some((w) => !FILLER.has(w));
}

/**
 * { query } to search, { needsTopic: true } when they asked to search but didn't say what, or null.
 */
function detectWebSearch(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const body = stripLead(raw);

  if (EXPLICIT.some((re) => re.test(raw))) {
    const query = cleanQuery(body.replace(TRIGGER_WORDS, " ").replace(ASK_VERB, "").replace(TRIGGER_WORDS, " "));
    return hasTopic(query) ? { query } : { needsTopic: true };
  }

  const asked = ASK_VERB.test(body);
  const question = cleanQuery(body.replace(ASK_VERB, ""));
  if (!question || PERSONAL.test(question) || PERSONAL_US.test(question) || NOT_LIVE_TOPIC.test(question)) return null;
  const live = WHO_WON.test(question) || (LIVE_WORD.test(question) && (asked || QUESTION_START.test(question)));
  return live && hasTopic(question) ? { query: question } : null;
}

/** Buddy's last reply offered to search ("Want me to look that up?"). */
function offeredSearch(aiText) {
  return /\b(?:search(?:\s+the\s+(?:web|internet))?\s+for|search\s+(?:it|that|online|the\s+web)|look\s+(?:it|that|this)\s+up|check\s+(?:that\s+|it\s+)?online)\b/i.test(
    String(aiText || "")
  );
}

/** "Yes" / "Sure, go ahead" — a short yes with nothing new in it. */
function isSearchConfirmation(text) {
  const t = String(text || "").trim().toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 5 || /\b(?:no|nope|not|don't|dont|never)\b/.test(t)) return false;
  return /^(?:yes|yeah|yep|yup|sure|ok|okay|please|go ahead|do it|sounds good|alright|why not)\b/.test(t);
}

module.exports = { detectWebSearch, offeredSearch, isSearchConfirmation };
