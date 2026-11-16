/**
 * Family Premium on a call from the member's line:
 *  - first call: Buddy asks for consent to daily check-in calls (keypad 1 / 2, or yes / no),
 *    then what relatives may see (1 status, 2 summaries, 3 transcripts);
 *  - later: "stop my daily calls" or "change what my family sees".
 * The platform records every answer; this module only runs the little menu.
 */

const SHARING = { 1: "status", 2: "summaries", 3: "transcripts" };

const TEXT = {
  en: {
    consent: (f) =>
      `Hi ${f.memberName}, I'm Buddy.${f.holderName ? ` ${f.holderName} set me up for you.` : ""} If it's OK with you, I'll call you every day at ${f.time} to say hello, and call you for your reminders. These calls are made by an AI assistant and are transcribed. Is that OK? Say yes or no, or press 1 for yes and 2 for no.`,
    sharing:
      "Thank you! Would you like your family to see only whether you answered, a short summary of our calls, or the full transcripts? Press 1 for only whether you answered, 2 for summaries, or 3 for full transcripts. You can change this any time.",
    declined: "Okay, I won't call you. You can still call me any time, and if you change your mind, just tell me.",
    shared: { status: "Got it. Your family will only see whether you answered.", summaries: "Got it. Your family will see short summaries of our calls.", transcripts: "Got it. Your family will see the full transcripts of our calls." },
    withdrawAsk: "Do you want me to stop your daily check-in calls? Press 1 or say yes to stop them, or press 2 to keep them.",
    withdrawn: "Okay, I've stopped your daily check-in calls. Your family will be told. You can call me any time.",
    kept: "Okay, I'll keep calling you every day.",
    error: "Sorry, I couldn't save that right now. Please try again in a minute.",
  },
  es: {
    consent: (f) =>
      `Hola ${f.memberName}, soy Buddy.${f.holderName ? ` ${f.holderName} me configuró para ti.` : ""} Si te parece bien, te llamaré todos los días a las ${f.time} para saludarte, y también para tus recordatorios. Estas llamadas las hace un asistente de inteligencia artificial y se transcriben. ¿Te parece bien? Di sí o no, o marca 1 para sí y 2 para no.`,
    sharing:
      "¡Gracias! ¿Quieres que tu familia vea solo si contestaste, un breve resumen de nuestras llamadas, o las transcripciones completas? Marca 1 para solo si contestaste, 2 para resúmenes, o 3 para transcripciones completas. Puedes cambiarlo cuando quieras.",
    declined: "Está bien, no te llamaré. Puedes llamarme cuando quieras, y si cambias de opinión, solo dímelo.",
    shared: { status: "Entendido. Tu familia solo verá si contestaste.", summaries: "Entendido. Tu familia verá breves resúmenes de nuestras llamadas.", transcripts: "Entendido. Tu familia verá las transcripciones completas." },
    withdrawAsk: "¿Quieres que deje de hacer tus llamadas diarias? Marca 1 o di sí para dejarlas, o marca 2 para seguir.",
    withdrawn: "Listo, dejé de hacer tus llamadas diarias. Le avisaremos a tu familia. Puedes llamarme cuando quieras.",
    kept: "Está bien, te seguiré llamando todos los días.",
    error: "Lo siento, no pude guardarlo ahora. Inténtalo de nuevo en un minuto.",
  },
};

/**
 * A yes or no must be the whole, short reply ("Yes", "Sure, that's fine", "No thanks"),
 * never a word inside a longer sentence ("No problem", "no sé", "okay so about the weather").
 */
const YES_START = new Set(["yes", "yeah", "yep", "sure", "ok", "okay", "si", "sí", "claro", "vale", "certainly", "absolutely"]);
const YES_PHRASES = [/^of course\b/, /^that'?s (?:ok|okay|fine)\b/, /^est[aá] bien\b/, /^de acuerdo\b/];
const NO_EXACT = new Set(["no", "nope", "no thanks", "no thank you", "not really", "no gracias", "no no", "no i don't", "no i do not", "no thats not ok", "no that's not ok", "no it's not", "no its not", "please don't", "no please don't"]);
const FILLER = /\b(?:please|thanks|thank you|gracias|that's fine|that's ok|it's fine|fine|good|great)\b/g;

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?¿¡]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function yesNo(text) {
  const t = words(text);
  if (!t) return null;
  const list = t.split(" ");
  if (NO_EXACT.has(t)) return "no";
  if (list.length > 6) return null;
  const rest = list.slice(1).join(" ").replace(FILLER, "").trim();
  if ((YES_START.has(list[0]) || YES_PHRASES.some((r) => r.test(t))) && !/\b(?:no|not|don'?t|never)\b/.test(rest) && rest.split(" ").filter(Boolean).length <= 2) {
    return "yes";
  }
  return null;
}

const STOP_CALLS = /\b(?:stop|cancel|don'?t want)\b.*\b(?:daily|check-?in|morning)\s+calls?\b|\b(?:deja|cancela)\b.*\bllamadas? diarias?\b/i;
const START_CALLS = /\b(?:start|restart|want|turn on)\b.*\b(?:daily|check-?in|morning)\s+calls?\b|\bquiero\b.*\bllamadas? diarias?\b/i;
const CHANGE_SHARING = /\b(?:what|change)\b.*\b(?:my )?(?:family|relatives?|kids|children|son|daughter)\b.*\b(?:see|sees|share)\b|\bqu[eé] ve mi familia\b/i;

/** Only clear words choose what is shared; "everything's fine" chooses nothing. */
function sharingFromSpeech(text) {
  const t = words(text);
  if (/\b(?:full transcripts?|the transcripts?|transcripts?|transcripciones?)\b/.test(t)) return "transcripts";
  if (/\b(?:summary|summaries|resumen|resúmenes|resumenes)\b/.test(t)) return "summaries";
  if (/\b(?:only whether|just whether|whether i answered|only if i answered|solo si contest[eé])\b/.test(t)) return "status";
  return null;
}

/** After this many replies that don't answer, the question is dropped (asked again next call). */
const MAX_NON_ANSWERS = 2;

function createFamilyMenu({ platformApi, session, callSid, logger }) {
  const lang = () => (session?.family?.language === "es" || session?.replyLanguage === "es" ? "es" : "en");
  const t = () => TEXT[lang()];
  const active = () => Boolean(platformApi?.enabled && session?.family && session?.platformUserId);

  async function send(action, payload) {
    const out = await platformApi.family(action, { userId: session.platformUserId, callerNumber: session.callerNumber, callSid, ...payload });
    if (!out?.ok) logger.warn({ callSid, action, err: out?.error }, "Family request failed");
    return out?.ok ? out.data : null;
  }

  /** The opening line on the member's first call (consent still pending), else null. */
  function openingLine() {
    if (!active() || session.family.consent !== "pending" || session.outbound) return null;
    session.familyMenu = "consent";
    session.familyMisses = 0;
    return t().consent(session.family);
  }

  function open(menu) {
    session.familyMenu = menu;
    session.familyMisses = 0;
  }

  /** A reply that isn't an answer: keep the question for one more turn, then let it go. */
  function missed() {
    session.familyMisses = (session.familyMisses || 0) + 1;
    if (session.familyMisses >= MAX_NON_ANSWERS) {
      logger.info({ callSid, menu: session.familyMenu }, "Family question dropped: no answer");
      session.familyMenu = null;
    }
    return null;
  }

  async function answer(choice, method) {
    const menu = session.familyMenu;
    if (menu === "consent") {
      if (choice !== "yes" && choice !== "no") return null;
      session.familyMenu = null;
      const out = await send("consent", { agree: choice === "yes", method });
      if (!out) return t().error;
      session.family.consent = out.consent;
      if (choice === "no") return t().declined;
      session.reminderConsent = true;
      open("sharing");
      return t().sharing;
    }
    if (menu === "sharing") {
      if (!["status", "summaries", "transcripts"].includes(choice)) return null;
      session.familyMenu = null;
      const out = await send("sharing", { level: choice });
      if (!out) return t().error;
      session.family.sharingLevel = choice;
      return t().shared[choice];
    }
    if (menu === "withdraw") {
      if (choice !== "yes" && choice !== "no") return null;
      session.familyMenu = null;
      if (choice === "no") return t().kept;
      const out = await send("withdraw", {});
      if (!out) return t().error;
      session.family.consent = "declined";
      return t().withdrawn;
    }
    return null;
  }

  /** A keypad press. What Buddy says, or null when it means nothing here. */
  async function handleDigit(digit) {
    if (!active() || !session.familyMenu) return null;
    if (session.familyMenu === "sharing") return answer(SHARING[digit] || null, "keypad");
    return answer(digit === "1" ? "yes" : digit === "2" ? "no" : null, "keypad");
  }

  /** The caller's words. What Buddy says, or null to let the call go on as usual. */
  async function handleSpeech(text) {
    if (!active()) return null;
    const said = String(text || "").trim();
    if (session.familyMenu === "sharing") {
      const level = sharingFromSpeech(said);
      return level ? answer(level, "voice") : missed();
    }
    if (session.familyMenu === "consent" || session.familyMenu === "withdraw") {
      const choice = yesNo(said);
      return choice ? answer(choice, "voice") : missed();
    }
    if (session.family.consent === "agreed" && STOP_CALLS.test(said)) {
      open("withdraw");
      return t().withdrawAsk;
    }
    if (session.family.consent === "agreed" && CHANGE_SHARING.test(said)) {
      open("sharing");
      return t().sharing.replace(/^(Thank you! |¡Gracias! )/, "");
    }
    // After a "no": "start my daily calls" asks the consent question again
    if (session.family.consent === "declined" && START_CALLS.test(said)) {
      const out = await send("reopen", {});
      if (!out) return t().error;
      session.family.consent = "pending";
      open("consent");
      return t().consent(session.family);
    }
    return null;
  }

  /** Whether these words are for the menu (checked before the usual answers). */
  function wants(text) {
    if (!active()) return false;
    if (session.familyMenu) return true;
    const said = String(text || "");
    if (session.family.consent === "declined") return START_CALLS.test(said);
    return session.family.consent === "agreed" && (STOP_CALLS.test(said) || CHANGE_SHARING.test(said));
  }

  return { openingLine, handleDigit, handleSpeech, wants, isOpen: () => Boolean(session?.familyMenu) };
}

/** Opening line of a check-in call Buddy placed. */
function checkinOpening(outbound, now = new Date()) {
  let hour = 9;
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: outbound.timezone || "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now));
  } catch {
    /* default */
  }
  const name = outbound.memberName ? ` ${outbound.memberName}` : "";
  if (outbound.language === "es") {
    const g = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
    return `${g}${name}, soy Buddy con tu llamada de hoy. ¿Cómo estás?`;
  }
  const g = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${g}${name}, it's Buddy with your daily call. How are you today?`;
}

module.exports = { createFamilyMenu, checkinOpening, TEXT, yesNo, sharingFromSpeech };
