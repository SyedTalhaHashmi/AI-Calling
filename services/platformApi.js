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
        send: (kind, payload) =>
          post(
            kind === "trial" ? "/api/v1/usage/trial-report" : "/api/v1/usage/report",
            payload,
            { "x-usage-secret": usageSecret },
            10000
          ),
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
    notifyCallEnd(payload) {
      return post(
        "/api/v1/integrations/voice/call-end",
        payload,
        { "x-integration-secret": integrationSecret },
        10000
      );
    },
    reportUsage(payload) {
      if (outbox) return outbox.enqueue("usage", payload, payload?.callSid ? `usage:${payload.callSid}` : undefined);
      return post("/api/v1/usage/report", payload, { "x-usage-secret": usageSecret }, 10000);
    },
    outbox,
  };
}

module.exports = createPlatformApi;
