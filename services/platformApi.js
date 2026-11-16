const path = require("path");
const axios = require("axios");
const createUsageOutbox = require("./usageOutbox");

function createPlatformApi(config, logger) {
  const baseURL = config.platform?.apiBaseUrl;
  const integrationSecret = config.platform?.integrationSecret;
  const usageSecret = config.platform?.usageSecret;
  const enabled = Boolean(baseURL && integrationSecret && usageSecret);

  const http = axios.create({
    baseURL: baseURL || "http://localhost:4000",
    timeout: 8000,
  });

  async function post(urlPath, body, headers, timeoutMs) {
    if (!enabled) return { ok: false, skipped: true };
    try {
      await http.post(urlPath, body, {
        headers,
        timeout: timeoutMs || 8000,
      });
      return { ok: true };
    } catch (err) {
      logger.warn(
        { err: err.message, path: urlPath, status: err.response?.status },
        "Platform API sync failed (non-blocking)"
      );
      return { ok: false, error: err.message, status: err.response?.status };
    }
  }

  // Call reports (minutes used, free minute) go through a durable outbox: written to
  // disk first, retried until the platform confirms, applied once there by call id.
  const outbox = enabled
    ? createUsageOutbox({
        filePath:
          config.platform?.usageOutboxPath ||
          path.join(process.cwd(), "data", "usage-outbox.json"),
        logger,
        send: (kind, payload) => {
          if (kind === "call-end") {
            return post("/api/v1/integrations/voice/call-end", payload, { "x-integration-secret": integrationSecret }, 15000);
          }
          if (kind === "checkin-result") {
            return post("/api/v1/integrations/voice/checkin-result", payload, { "x-integration-secret": integrationSecret }, 10000);
          }
          if (kind === "reminder-result") {
            return post("/api/v1/integrations/voice/reminder-result", payload, { "x-integration-secret": integrationSecret }, 10000);
          }
          if (kind === "tool-record" || kind === "tool-release") {
            return post("/api/v1/integrations/voice/tool-use", payload, { "x-integration-secret": integrationSecret }, 10000);
          }
          return post(
            kind === "trial" ? "/api/v1/usage/trial-report" : "/api/v1/usage/report",
            payload,
            { "x-usage-secret": usageSecret },
            10000
          );
        },
      })
    : null;
  if (outbox) outbox.start();

  /**
   * Synchronous gate before streaming audio.
   * @returns {Promise<{ skipped?: boolean, allowed: boolean, mode?: string, userId?: string, secondsRemaining?: number, maxSecondsThisCall?: number, message?: string }>}
   */
  async function callerCheck(payload) {
    if (!enabled) {
      return { skipped: true, allowed: true };
    }
    try {
      const { data } = await http.post(
        "/api/v1/integrations/voice/caller-check",
        payload,
        {
          headers: { "x-integration-secret": integrationSecret },
          timeout: 8000,
        }
      );
      return { skipped: false, ...data };
    } catch (err) {
      logger.warn({ err: err.message }, "Platform caller-check failed");
      return {
        skipped: false,
        allowed: false,
        // Not an answer about the account: the platform couldn't be asked
        unavailable: true,
        message:
          "We could not connect your call right now. Please try again later. Goodbye.",
      };
    }
  }

  async function trialReport(payload) {
    if (outbox) return outbox.enqueue("trial", payload, payload?.callSid ? `trial:${payload.callSid}` : undefined);
    return post("/api/v1/usage/trial-report", payload, { "x-usage-secret": usageSecret }, 10000);
  }

  return {
    enabled,
    callerCheck,
    trialReport,
    notifyCallStart(payload) {
      return post(
        "/api/v1/integrations/voice/call-start",
        payload,
        { "x-integration-secret": integrationSecret },
        8000
      );
    },
    /** End of call (length, transcript, language, AI cost): through the outbox, applied once by call id. */
    notifyCallEnd(payload) {
      if (outbox) return outbox.enqueue("call-end", payload, payload?.callSid ? `callend:${payload.callSid}` : undefined);
      return post(
        "/api/v1/integrations/voice/call-end",
        payload,
        { "x-integration-secret": integrationSecret },
        10000
      );
    },
    /** Live-tool permission (reserve). Answers { ok, data } or { ok: false } — the caller decides on fail-open. */
    async toolUse(payload) {
      if (!enabled) return { ok: false, skipped: true };
      try {
        const { data } = await http.post("/api/v1/integrations/voice/tool-use", payload, {
          headers: { "x-integration-secret": integrationSecret },
          timeout: 3000,
        });
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err.message, status: err.response?.status };
      }
    },
    /** How one reminder call try went: through the outbox, once per try. */
    reportReminderResult(payload) {
      if (!outbox) return;
      outbox.enqueue("reminder-result", payload, `reminder:${payload.reminderId}:${payload.attempt}`).catch(() => {});
    },
    /** How one check-in call try went: through the outbox, once per try. */
    reportCheckinResult(payload) {
      if (!outbox) return;
      outbox.enqueue("checkin-result", payload, `checkin:${payload.checkinId}:${payload.attempt}`).catch(() => {});
    },
    /** Family Premium on a call: the member's yes/no, sharing choice, or stopping the daily calls. */
    async family(action, payload) {
      if (!enabled) return { ok: false, skipped: true };
      const path = {
        consent: "/api/v1/integrations/voice/family-consent",
        sharing: "/api/v1/integrations/voice/family-sharing",
        withdraw: "/api/v1/integrations/voice/family-withdraw",
        reopen: "/api/v1/integrations/voice/family-reopen",
      }[action];
      try {
        const { data } = await http.post(path, payload, { headers: { "x-integration-secret": integrationSecret }, timeout: 5000 });
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err.message, status: err.response?.status };
      }
    },
    /** Reminder tools on a call (set, list, cancel) and the keypad consent: answers needed now. */
    async reminders(action, payload) {
      if (!enabled) return { ok: false, skipped: true };
      const path = {
        set: "/api/v1/integrations/voice/reminders",
        list: "/api/v1/integrations/voice/reminders/list",
        cancel: "/api/v1/integrations/voice/reminders/cancel",
        consent: "/api/v1/integrations/voice/reminder-consent",
      }[action];
      try {
        const { data } = await http.post(path, payload, { headers: { "x-integration-secret": integrationSecret }, timeout: 5000 });
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err.message, status: err.response?.status };
      }
    },
    /** A tool use counted after the fact, or a unit given back: through the outbox. */
    queueToolReport(kind, payload) {
      if (!outbox) return;
      outbox.enqueue(kind, payload, `${kind}:${payload.key}`).catch(() => {});
    },
    reportUsage(payload) {
      if (outbox) return outbox.enqueue("usage", payload, payload?.callSid ? `usage:${payload.callSid}` : undefined);
      return post("/api/v1/usage/report", payload, { "x-usage-secret": usageSecret }, 10000);
    },
    outbox,
  };
}

module.exports = createPlatformApi;
