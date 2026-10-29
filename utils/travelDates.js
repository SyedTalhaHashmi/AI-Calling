/**
 * Spoken travel dates → ISO dates for fare and hotel price questions.
 * "Bogota to Miami, Monday to Friday next week" → out 2026-11-02, back 2026-11-06.
 * Dates are calendar days (UTC); a date already past rolls to next year.
 */

const WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, lunes: 1, martes: 2, "miércoles": 3, miercoles: 3, jueves: 4, viernes: 5, "sábado": 6, sabado: 6,
};
const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
};

const NL = "(?<![\\p{L}])"; // no letter before
const NR = "(?![\\p{L}])"; // no letter after
const WEEKDAY_RE = new RegExp(`${NL}(${Object.keys(WEEKDAYS).join("|")})${NR}`, "giu");
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

const iso = (d) => d.toISOString().slice(0, 10);
const fromIso = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => iso(new Date(fromIso(s).getTime() + n * 864e5));
const dow = (s) => fromIso(s).getUTCDay();

function monthName(ym) {
  const m = Number(String(ym || "").slice(5, 7));
  return MONTH_NAMES[m - 1] || "";
}

/** Calendar date for month/day on or after `notBefore` (rolls to next year). */
function dateOnOrAfter(month, day, notBefore) {
  const year = Number(notBefore.slice(0, 4));
  let d = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (d < notBefore) d = `${year + 1}${d.slice(4)}`;
  return d;
}

/** Every date mention with its position, in spoken order. */
function dateMentions(t, today) {
  const found = [];
  const taken = [];
  const free = (i, j) => !taken.some(([a, b]) => i < b && j > a);
  const add = (index, length, kind, value) => {
    if (!free(index, index + length)) return;
    taken.push([index, index + length]);
    found.push({ index, kind, value });
  };

  for (const m of t.matchAll(/\b(day after tomorrow|pasado mañana)/giu)) add(m.index, m[0].length, "date", addDays(today, 2));
  for (const m of t.matchAll(/(?<!por la |de la |esta )\b(tomorrow|mañana)(?![\p{L}])/giu)) add(m.index, m[0].length, "date", addDays(today, 1));
  for (const m of t.matchAll(/\b(today|tonight|hoy)\b/giu)) add(m.index, m[0].length, "date", today);

  // "November 10th" / "Nov 10" / "10th of November" / "10 de noviembre"
  for (const m of t.matchAll(new RegExp(`${NL}(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "giu"))) {
    add(m.index, m[0].length, "monthDay", { month: MONTHS[m[1].toLowerCase()], day: Number(m[2]) });
  }
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+|de\\s+)?(${MONTH_ALT})${NR}`, "giu"))) {
    add(m.index, m[0].length, "monthDay", { month: MONTHS[m[2].toLowerCase()], day: Number(m[1]) });
  }
  // "on the 15th" — this month, or next month if already past
  for (const m of t.matchAll(/\bthe (\d{1,2})(st|nd|rd|th)\b/gi)) add(m.index, m[0].length, "dayOnly", Number(m[1]));

  for (const m of t.matchAll(WEEKDAY_RE)) add(m.index, m[0].length, "weekday", WEEKDAYS[m[1].toLowerCase()]);
  return found.sort((a, b) => a.index - b.index);
}

/**
 * { departDate, returnDate, departMonth ("YYYY-MM"), window ({start,end} for "next week"),
 *   oneWay (true / false / null = not said), nights }
 */
function parseTravelDates(text, now = Date.now()) {
  const t = String(text || "").toLowerCase();
  const today = iso(new Date(now));
  const nextWeek = /\bnext week\b|\bla (?:pr[oó]xima|otra) semana\b|\bsemana que viene\b/.test(t);
  const nextMonday = addDays(today, ((1 - dow(today) + 7) % 7) || 7);

  const dates = [];
  for (const m of dateMentions(t, today)) {
    const prev = dates.at(-1);
    const notBefore = prev ? addDays(prev, 1) : today;
    if (m.kind === "date") dates.push(m.value);
    else if (m.kind === "monthDay") dates.push(dateOnOrAfter(m.value.month, m.value.day, notBefore));
    else if (m.kind === "dayOnly") {
      // This month if still ahead, otherwise next month
      const [y, mo] = notBefore.split("-").map(Number);
      const thisMonth = iso(new Date(Date.UTC(y, mo - 1, m.value)));
      dates.push(thisMonth >= notBefore ? thisMonth : iso(new Date(Date.UTC(y, mo, m.value))));
    } else if (m.kind === "weekday") {
      if (nextWeek && !prev) dates.push(addDays(nextMonday, (m.value + 6) % 7));
      else {
        // The coming one (today's weekday → next week's); a later mention comes after the previous date
        const from = prev || today;
        dates.push(addDays(from, (m.value - dow(from) + 7) % 7 || 7));
      }
    }
    if (dates.length && dates.at(-1) < notBefore && prev) dates[dates.length - 1] = addDays(dates.at(-1), 7);
  }

  let departDate = dates[0] || null;
  let returnDate = dates[1] || null;

  const n = t.match(/\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|un|una|dos|tres|cuatro|cinco|seis|siete)\s+(nights?|noches?|days?|d[ií]as?|weeks?|semanas?)\b/);
  let nights = null;
  if (n) {
    const count = /^\d+$/.test(n[1]) ? Number(n[1]) : NUMBER_WORDS[n[1]];
    nights = /^(weeks?|semanas?)$/.test(n[2]) ? count * 7 : count;
  }
  if (departDate && nights && !returnDate) returnDate = addDays(departDate, nights);
  if (departDate && returnDate && !nights) nights = Math.round((fromIso(returnDate) - fromIso(departDate)) / 864e5);

  let departMonth = departDate ? departDate.slice(0, 7) : null;
  let window = null;
  if (!departDate) {
    // "in December" / "en diciembre" (full month names only: "in may" / "for mar" are too ambiguous)
    const monthOnly = t.match(
      /\b(?:in|en|for|during|para|de)\s+(january|february|march|april|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?![\p{L}])/u
    );
    if (monthOnly) {
      const m = MONTHS[monthOnly[1]];
      const [y, mo] = today.split("-").map(Number);
      departMonth = `${m < mo ? y + 1 : y}-${String(m).padStart(2, "0")}`;
    } else if (/\bnext month\b|\bel (?:pr[oó]ximo )?mes que viene\b|\bel pr[oó]ximo mes\b/.test(t)) {
      const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1));
      departMonth = iso(d).slice(0, 7);
    } else if (nextWeek) {
      window = { start: nextMonday, end: addDays(nextMonday, 6) };
      departMonth = nextMonday.slice(0, 7);
    }
  }

  let oneWay = null;
  if (/\bone[- ]way\b|\bsolo ida\b|\bida solamente\b|\bsolo de ida\b/.test(t)) oneWay = true;
  else if (returnDate || /\bround[- ]?trip\b|\breturn(?:ing)?\b|\bcoming back\b|\bback on\b|\bida y vuelta\b|\bregres/.test(t)) oneWay = false;

  return { departDate, returnDate, departMonth, window, oneWay, nights };
}

/** Nights in a stay ("three nights", "Monday to Friday"), or null. */
function stayNights(text, now = Date.now()) {
  return parseTravelDates(text, now).nights;
}

/** "Monday, November 2" */
function spokenDate(isoDate) {
  return fromIso(String(isoDate).slice(0, 10)).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
}

module.exports = { parseTravelDates, stayNights, monthName, spokenDate, addDays };
