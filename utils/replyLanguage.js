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
};

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Explicit "speak English / habla español" style switches. */
function explicitLanguageSwitch(text) {
  const t = String(text || "").toLowerCase();
  const pairs = [
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?english\b|\bin\s+english\b|\benglish\s+please\b/, code: "en" },
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?spanish\b|\bin\s+spanish\b|\bespa[nñ]ol\b|\bhabla\s+espa/, code: "es" },
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?french\b|\bin\s+french\b|\bfran[cç]ais\b/, code: "fr" },
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?(hindi|urdu)\b|\bin\s+(hindi|urdu)\b/, code: "hi" },
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?(portuguese|portugu[eê]s)\b/, code: "pt" },
    { re: /\b(speak|talk|reply|answer|switch)\s+(in\s+)?chinese\b|\bin\s+chinese\b/, code: "zh" },
    { re: /\bdo you speak spanish\b/, code: "es" },
    { re: /\bdo you speak (english|french|hindi|chinese)\b/, code: null }, // question only — handled below
  ];
  for (const { re, code } of pairs) {
    if (re.test(t) && code) return code;
  }
  // "Do you speak Spanish?" → lock Spanish for the yes + following turns
  if (/\bdo you speak spanish\b/.test(t) || /\bhabla(?:s)?\s+espa[nñ]ol\b/.test(t)) return "es";
  if (/\bdo you speak french\b/.test(t)) return "fr";
  if (/\bdo you speak hindi\b/.test(t)) return "hi";
  if (/\bdo you speak (english|english as well)\b/.test(t)) return "en";
  if (/\bdo you speak chinese\b/.test(t)) return "zh";
  if (/\bdo you speak portuguese\b/.test(t)) return "pt";
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
  updateReplyLanguage,
  languageLabel,
  languageInstruction,
  wordCount,
};
