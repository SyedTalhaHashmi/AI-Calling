const fs = require("fs");
const path = require("path");

/**
 * Durable outbox for call reports to the platform API (minutes used, free minute).
 *
 * A report is written to disk before it is sent, and removed only when the
 * platform confirms it. Failed sends are retried with growing pauses (5 s, 10 s,
 * 20 s … up to 10 min) for as long as it takes, including after a restart. Each
 * report carries the call id, and the platform applies a repeat only once, so
 * retrying is always safe.
 *
 * A report the platform rejects as invalid (400/404) is moved to a ".dead" file
 * for a person to look at, instead of being retried forever.
 */
function createUsageOutbox({
  filePath,
  send,
  logger,
  now = () => Date.now(),
  baseDelayMs = 5000,
  maxDelayMs = 10 * 60 * 1000,
  tickMs = 10000,
}) {
  const items = new Map();
  const sending = new Set();
  let timer = null;

  function load() {
    try {
      const list = JSON.parse(fs.readFileSync(filePath, "utf8"));
      // A fresh process tries every waiting report straight away.
      for (const item of Array.isArray(list) ? list : []) if (item?.id) items.set(item.id, { ...item, nextAt: now() });
      if (items.size) logger.info({ pending: items.size }, "Usage outbox: pending reports loaded");
    } catch (err) {
      if (err.code !== "ENOENT") logger.error({ err: err.message }, "Usage outbox: could not read file");
    }
  }

  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...items.values()]));
    fs.renameSync(tmp, filePath);
  }

  function deadLetter(item, status, error) {
    try {
      // Call transcripts are not kept in the dead-letter file (it is never cleaned up)
      const payload = item.payload && "transcript" in item.payload ? { ...item.payload, transcript: "[removed]" } : item.payload;
      fs.appendFileSync(`${filePath}.dead`, `${JSON.stringify({ ...item, payload, status, error, at: new Date(now()).toISOString() })}\n`);
    } catch (err) {
      logger.error({ err: err.message }, "Usage outbox: could not write dead-letter file");
    }
  }

  async function attempt(item) {
    if (sending.has(item.id)) return;
    sending.add(item.id);
    try {
      const out = await send(item.kind, item.payload);
      if (out?.ok) {
        items.delete(item.id);
      } else if (out?.status === 400 || out?.status === 404) {
        logger.error({ id: item.id, status: out.status, err: out.error }, "Usage outbox: report rejected; moved to dead-letter file");
        deadLetter(item, out.status, out.error);
        items.delete(item.id);
      } else {
        item.attempts = (item.attempts || 0) + 1;
        item.nextAt = now() + Math.min(maxDelayMs, baseDelayMs * 2 ** (item.attempts - 1));
        item.lastError = out?.error || `status ${out?.status}`;
        logger.warn({ id: item.id, attempts: item.attempts, err: item.lastError }, "Usage outbox: send failed, will retry");
      }
      save();
    } catch (err) {
      logger.error({ id: item.id, err: err.message }, "Usage outbox: unexpected error");
    } finally {
      sending.delete(item.id);
    }
  }

  /** Queue a report and try to send it now. Never throws, never loses the report. */
  function enqueue(kind, payload, id) {
    const key = id || `${kind}:${payload?.callSid || now()}`;
    if (!items.has(key)) {
      items.set(key, { id: key, kind, payload, attempts: 0, nextAt: now(), createdAt: new Date(now()).toISOString() });
      try {
        save();
      } catch (err) {
        logger.error({ err: err.message }, "Usage outbox: could not write file; report kept in memory");
      }
    }
    return attempt(items.get(key));
  }

  /** Send every report whose retry time has come. */
  async function flushDue() {
    const due = [...items.values()].filter((i) => (i.nextAt || 0) <= now());
    for (const item of due) await attempt(item);
  }

  function start() {
    load();
    flushDue();
    timer = setInterval(flushDue, tickMs);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { enqueue, flushDue, start, stop, size: () => items.size, pending: () => [...items.values()] };
}

module.exports = createUsageOutbox;
