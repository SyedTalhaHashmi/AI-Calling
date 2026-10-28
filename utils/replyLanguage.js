/**
 * Per-call reply language lock for voice.
 * Locks on first clear utterance; switches only on explicit ask or a strong new language turn.
 */

const LANG_NAMES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  pt: "Portuguese",
  hi: "Hindi",
  ur: "Urdu",
  zh: "Chinese",
  ja: "Japanese",
  yi: "Yiddish",
  he: "Hebrew",
};

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Language names callers say (English and native spellings) → reply language code. */
const LANGUAGE_WORDS = {
  english: "en",
  spanish: "es",
  "español": "es",
  espanol: "es",
  french: "fr",
  "français": "fr",
  francais: "fr",
  portuguese: "pt",
  "português": "pt",
  portugues: "pt",
  hindi: "hi",
  urdu: "hi",
  chinese: "zh",
  mandarin: "zh",
  japanese: "ja",
  yiddish: "yi",
  hebrew: "he",
};
const LANGUAGE_WORD_RE = Object.keys(LANGUAGE_WORDS).join("|");

/** "How do you say … in Spanish?" — about a language, not a request to speak it. */
const TRANSLATION_ASK = new RegExp(
  `\\b(how (do|would|can|could) (you|i|we) say|how to say|translate|translation|what does .+ mean|what(?:'s| is) .+ in (?:${LANGUAGE_WORD_RE}))(?![\\p{L}])`,
  "iu"
);
const CAPABILITY_ASK = new RegExp(
  `\\b(?:(?:do|can|could) you (?:also |even )?(?:speak|understand|know)|if you (?:can|could) speak|are you able to speak)\\s+(${LANGUAGE_WORD_RE})(?![\\p{L}])`,
  "iu"
);
/** "Can you speak Spanish please?" / "…switch to Spanish" — a question that is really a request. */
const REQUEST_CUE = /\b(please|switch|change|let'?s|i want you|i'?d like you|from now on)\b/i;

/**
 * "Do you speak Spanish?" / "Can you speak Yiddish?" → that language's code (asking, not asking to switch).
 * Null when it is a clear request ("Can you speak Spanish please?").
 */
function languageCapabilityAsk(text) {
  const t = String(text || "").toLowerCase();
  const m = t.match(CAPABILITY_ASK);
  if (!m || REQUEST_CUE.test(t)) return null;
  return LANGUAGE_WORDS[m[1]] || null;
}

/** Answer to "Would you like me to switch?" */
const AFFIRMATIVE =
  /^[\s¡¿]*(yes|yeah|yep|yup|sure|ok|okay|please|of course|go ahead|do it|s[ií]|claro|por favor|oui|haan|ji)(?![\p{L}])/iu;

/** Explicit "speak English / habla español" style switches (not capability or translation questions). */
function explicitLanguageSwitch(text) {
  const t = String(text || "").toLowerCase();
  if (TRANSLATION_ASK.test(t) || languageCapabilityAsk(t)) return null;
  const toLanguage = t.match(new RegExp(`\\b(?:switch|change)\\s+(?:it\\s+|over\\s+)?to\\s+(${LANGUAGE_WORD_RE})(?![\\p{L}])`, "iu"));
  if (toLanguage) return LANGUAGE_WORDS[toLanguage[1]];
  const pairs = [
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?english\b|\bin\s+english\b|\benglish\s+please\b/, code: "en" },
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?spanish\b|\bin\s+spanish\b|\bespa[nñ]ol\b|\bhabla\s+espa/, code: "es" },
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?french\b|\bin\s+french\b|\bfran[cç]ais\b/, code: "fr" },
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?(hindi|urdu)\b|\bin\s+(hindi|urdu)\b/, code: "hi" },
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?(portuguese|portugu[eê]s)\b/, code: "pt" },
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?chinese\b|\bin\s+chinese\b/, code: "zh" },
    {
      re: /\b(speak|talk|reply|answer|switch|continue)\s+(in\s+)?yiddish\b|\bin\s+yiddish\b|\byiddish\s+please\b|\bspeak\s+yiddish\s+for\s+me\b/,
      code: "yi",
    },
    {
      re: /\b(speak|talk|reply|answer|switch|continue)\s+(in\s+)?hebrew\b|\bin\s+hebrew\b|\bhebrew\s+please\b/,
      code: "he",
    },
  ];
  for (const { re, code } of pairs) {
    if (re.test(t)) return code;
  }
  // "¿Hablas español?" — the caller is already speaking Spanish
  if (/\bhabla(?:s)?\s+espa[nñ]ol\b/.test(t)) return "es";
  return null;
}

/**
 * Heuristic language from script + clear markers.
 * Returns null when unsure (short / mixed / noise).
 */
function detectLanguage(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  if (/[\u0900-\u097F]/.test(raw)) return "hi";
  if (/[\u0600-\u06FF]/.test(raw)) return "ur";
  if (/[\u4e00-\u9fff]/.test(raw)) return "zh";
  if (/[\u3040-\u30ff]/.test(raw)) return "ja";
  // Hebrew alphabet (also used for Yiddish text) — treat as Hebrew unless session already locked Yiddish
  if (/[\u0590-\u05FF]/.test(raw)) return "he";

  const t = raw.toLowerCase();
  const words = wordCount(raw);

  // Very short English fillers must not flip language ("Hello?", "Nah.", "Your")
  if (words <= 2 && /^(hello|hi|hey|yes|yeah|yep|no|nah|ok|okay|thanks|thank you|bye|bye-bye|your|sure)[\s.?!]*$/i.test(raw)) {
    return null;
  }

  if (
    /[¿¡]/.test(raw) ||
    /\b(hola|gracias|clima|puedes|usted|ustedes|qué|cómo|espa[nñ]ol|recomienda|comer|viaje|tiquete|por favor)\b/i.test(
      t
    )
  ) {
    return "es";
  }
  if (
    /\b(bonjour|merci|fran[cç]ais|parlez|vous|oui)\b/i.test(t) ||
    /\bje (parle|suis|veux)\b/i.test(t)
  ) {
    return "fr";
  }
  if (
    /\b(você|voce|obrigad|portugu[eê]s|e a[ií]|como est[aá]|não|nao)\b/i.test(t)
  ) {
    return "pt";
  }
  if (
    words >= 3 &&
    /\b(the|you|what|how|please|english|thanks|thank|would|could|about|with|this|that|have|from|want)\b/i.test(
      t
    )
  ) {
    return "en";
  }
  return null;
}

function languageLabel(code) {
  return LANG_NAMES[code] || "English";
}

/**
 * Update session.replyLanguage. Returns { changed, language }.
 */
function updateReplyLanguage(session, userText) {
  if (!session) return { changed: false, language: "en" };

  // Reply to our "Would you like me to switch to …?" — the offer lasts one turn
  const offered = session.languageOffer;
  if (offered) {
    session.languageOffer = null;
    if (AFFIRMATIVE.test(String(userText || "")) && !/^\s*no\b/i.test(String(userText || ""))) {
      session.replyLanguage = offered;
      return { changed: true, language: offered, acceptedOffer: true };
    }
    // Simply carrying on in the offered language counts as yes
    if (detectLanguage(userText) === offered && session.replyLanguage !== offered) {
      session.replyLanguage = offered;
      return { changed: true, language: offered };
    }
  }

  // "Do you speak Spanish?" — offer, don't switch
  const asked = languageCapabilityAsk(userText);
  if (asked) {
    const current = session.replyLanguage || "en";
    if (asked === current) return { changed: false, language: current };
    session.languageOffer = asked;
    return { changed: false, language: current, offer: asked };
  }

  const explicit = explicitLanguageSwitch(userText);
  if (explicit) {
    const changed = session.replyLanguage !== explicit;
    session.replyLanguage = explicit;
    return { changed, language: explicit };
  }

  const detected = detectLanguage(userText);
  if (!detected) {
    return { changed: false, language: session.replyLanguage || "en" };
  }

  // First clear lock
  if (!session.replyLanguage) {
    session.replyLanguage = detected;
    return { changed: true, language: detected };
  }

  // Already locked: only switch on a strong, longer turn in a new language
  if (detected !== session.replyLanguage && wordCount(userText) >= 6) {
    session.replyLanguage = detected;
    return { changed: true, language: detected };
  }

  return { changed: false, language: session.replyLanguage };
}

function languageInstruction(session) {
  const code = session?.replyLanguage || "en";
  const name = languageLabel(code);
  if (code === "yi") {
    return (
      `Reply ONLY in Yiddish for this call (spoken Yiddish the caller can hear). ` +
      `Do not say you can only speak English. Do not refuse Yiddish. ` +
      `Switch away only if the caller clearly asks for another language.`
    );
  }
  if (code === "he") {
    return (
      `Reply ONLY in Hebrew for this call. ` +
      `Do not say you can only speak English. ` +
      `Switch away only if the caller clearly asks for another language.`
    );
  }
  return (
    `Reply ONLY in ${name} for this call. ` +
    `Do not switch language unless the caller clearly asks to speak another language. ` +
    `Ignore short noisy words (hello, ok, nah) as a reason to change language.`
  );
}

module.exports = {
  LANG_NAMES,
  detectLanguage,
  explicitLanguageSwitch,
  languageCapabilityAsk,
  updateReplyLanguage,
  languageLabel,
  languageInstruction,
  wordCount,
};
