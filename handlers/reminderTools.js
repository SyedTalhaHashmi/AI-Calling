/**
 * Reminder calls by voice: set, list and cancel reminders, and the keypad consent
 * ("press 1 to agree to reminder calls"). The platform keeps the reminders and the
 * rules (plan, monthly limit, consent); this module turns tool calls into platform
 * requests and the platform's answers into what Buddy says.
 */

const REMINDER_TOOL_DEFS = [
  {
    type: "function",
    name: "set_reminder",
    description:
      "Set a reminder call: Buddy will phone the caller at that time and say the reminder. Use only when the caller asks to be reminded and gave both what and when; if either is missing, ask for it first instead of calling. Convert their words to a local date and time (24-hour) using the current local time you were given.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "What to remind them about, short, in their words, e.g. Take my blood pressure pills" },
        when: { type: "string", description: "Local date and time, format YYYY-MM-DDTHH:mm, e.g. 2026-11-17T09:00" },
      },
      required: ["message", "when"],
    },
  },
  {
    type: "function",
    name: "list_reminders",
    description: "List the caller's upcoming reminder calls.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "cancel_reminder",
    description:
      "Cancel one upcoming reminder call. Pass number (its position in the list you read out) or a few words of what it is about.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "integer", description: "1 for the first reminder in the list, 2 for the second…" },
        about: { type: "string", description: "Words from the reminder, e.g. pills" },
      },
    },
  },
];

const REMINDER_TOOL_NAMES = new Set(REMINDER_TOOL_DEFS.map((t) => t.name));

/**
 * "Remind me to/at/tomorrow…", "set a reminder", "my reminders", "cancel the
 * reminder", Spanish too. Not "remind me what the weather is" (a question, not a
 * reminder call), which goes to the usual answers.
 */
const QUESTION_WORD = /^(?:what|who|whom|how|when|where|which|why|if|whether|qu[eé]|qui[eé]n|c[oó]mo|cu[aá]ndo|d[oó]nde|cu[aá]l)(?=[\s,?.!]|$)/i;
function isReminderAsk(text) {
  const t = String(text || "");
  if (/\breminders?\b|\brecordatorios?\b/i.test(t)) return true;
  const m = /\b(?:remind me|recu[eé]rdame|recordarme)\b[\s,]*(.*)$/i.exec(t);
  if (!m) return false;
  return !QUESTION_WORD.test(m[1].trim());
}

/** "2026-11-16T14:05" now in the zone. */
function localNow(tz, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "America/New_York",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
    }).formatToParts(now);
    const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return { iso: `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`, weekday: m.weekday };
  } catch {
    return localNow("America/New_York", now);
  }
}

/** Instructions for a reply that may set, list or cancel reminders. */
function reminderTurnInstruction(langName, session, now = new Date()) {
  const tz = session?.timezone || "America/New_York";
  const n = localNow(tz, now);
  return (
    `Reply in ${langName} only, briefly. The caller's local time is ${n.weekday} ${n.iso} (${tz}). ` +
    `They are asking about reminder calls (Buddy phones them at a set time and says the reminder). ` +
    `To set one you need what to remind them about and the day and time: if either is missing, ask for it in one short question and don't call a tool. ` +
    `When you have both, call set_reminder. To hear their reminders call list_reminders; to cancel one call cancel_reminder. ` +
    `Never say a reminder is set unless the tool result says so.`
  );
}

/** After a reminder tool ran: say its result. */
function reminderFollowUpInstruction(langName) {
  return (
    `Reply in ${langName} only. Tell the caller the result of the reminder tool in one or two short sentences, using its "say" text when there is one, ` +
    `keeping every date, time and number. If the result asks them to press a key, say exactly that and stop.`
  );
}

function createReminderExecutor({ platformApi, session, callSid, logger }) {
  const member = () => Boolean(platformApi?.enabled && session?.platformUserId && session?.billingMode !== "trial");

  async function ask(action, payload) {
    const out = await platformApi.reminders(action, { userId: session.platformUserId, callSid, ...payload });
    if (!out?.ok || !out.data) {
      logger.warn({ callSid, action, err: out?.error || `status ${out?.status}` }, "Reminder request failed");
      return null;
    }
    return out.data;
  }

  async function list() {
    const data = await ask("list", {});
    if (!data) return null;
    session.lastReminderList = (data.reminders || []).map((r) => ({ id: r.id, message: r.message, when: r.when }));
    return session.lastReminderList;
  }

  async function execute(name, args = {}) {
    if (!member()) {
      return { error: "Reminder calls are for members.", say: "Reminder calls are for members. You can sign up at buddycallai dot com." };
    }
    if (name === "set_reminder") {
      const data = await ask("set", { callerNumber: session.callerNumber, message: args.message, when: args.when });
      if (!data) return { error: "unavailable", say: "Sorry, I couldn't set the reminder right now. Please try again in a minute." };
      if (data.code === "no_consent") {
        // Waiting for the keypad: 1 agrees and the reminder is set, 2 says no
        session.pendingReminder = { message: args.message, when: args.when };
        return { needsConsent: true, say: data.say };
      }
      if (data.ok) session.pendingReminder = null;
      return data.ok ? { ok: true, say: data.say } : { error: data.code, say: data.say };
    }
    if (name === "list_reminders") {
      const items = await list();
      if (!items) return { error: "unavailable", say: "Sorry, I couldn't check your reminders right now." };
      if (!items.length) return { reminders: [], say: "You have no reminder calls coming up." };
      return {
        reminders: items.map((r, i) => ({ number: i + 1, when: r.when, message: r.message })),
        say: items.map((r, i) => `${i + 1}: ${r.when}, ${r.message}.`).join(" "),
      };
    }
    if (name === "cancel_reminder") {
      const items = session.lastReminderList?.length ? session.lastReminderList : await list();
      if (!items) return { error: "unavailable", say: "Sorry, I couldn't reach your reminders right now." };
      let pick = null;
      const n = Number(args.number);
      if (Number.isInteger(n) && n >= 1 && n <= items.length) pick = items[n - 1];
      if (!pick && args.about) {
        const words = String(args.about).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
        const hits = items.filter((r) => words.some((w) => r.message.toLowerCase().includes(w)));
        if (hits.length === 1) pick = hits[0];
        else if (hits.length > 1) return { error: "ambiguous", say: "More than one reminder matches. Which one: " + hits.map((r) => `${r.when}, ${r.message}`).join("; or ") + "?" };
      }
      if (!pick && items.length === 1) pick = items[0];
      if (!pick) return { error: "which", say: items.length ? "Which reminder should I cancel?" : "You have no reminder calls coming up." };
      const data = await ask("cancel", { reminderId: pick.id });
      if (!data) return { error: "unavailable", say: "Sorry, I couldn't cancel it right now." };
      if (data.ok) session.lastReminderList = items.filter((r) => r.id !== pick.id);
      return data.ok ? { ok: true, say: `Okay, I cancelled the reminder for ${pick.when}: ${pick.message}.` } : { error: data.code, say: data.say };
    }
    return { error: "unknown tool" };
  }

  /** A keypad press. Returns what Buddy should say, or null when it means nothing now. */
  async function handleDigit(digit) {
    const pending = session?.pendingReminder;
    if (!pending || !member()) return null;
    if (digit === "2") {
      session.pendingReminder = null;
      return "Okay, no reminder calls. You can change your mind any time.";
    }
    if (digit !== "1") return null;
    session.pendingReminder = null;
    const consent = await ask("consent", { callerNumber: session.callerNumber });
    if (!consent?.ok) return "Sorry, I couldn't save that right now. Please try again in a minute.";
    session.reminderConsent = true;
    logger.info({ callSid }, "Reminder calls agreed by keypad");
    const set = await ask("set", { callerNumber: session.callerNumber, message: pending.message, when: pending.when });
    if (!set) return "Thanks, you're signed up for reminder calls, but I couldn't set this one right now. Please ask me again.";
    return set.ok ? `Thank you. ${set.say}` : `Thank you, you're signed up for reminder calls. ${set.say}`;
  }

  return { execute, handleDigit, isMember: member };
}

module.exports = {
  REMINDER_TOOL_DEFS,
  REMINDER_TOOL_NAMES,
  isReminderAsk,
  localNow,
  reminderTurnInstruction,
  reminderFollowUpInstruction,
  createReminderExecutor,
};
