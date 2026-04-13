const axios = require("axios");

function createPlatformApi(config, logger) {
  const baseURL = config.platform?.apiBaseUrl;
  const integrationSecret = config.platform?.integrationSecret;
  const usageSecret = config.platform?.usageSecret;
  const enabled = Boolean(baseURL && integrationSecret && usageSecret);

  const http = axios.create({
    baseURL: baseURL || "http://localhost:4000",
    timeout: 3000,
  });

  async function post(path, body, headers) {
    if (!enabled) return { ok: false, skipped: true };
    try {
      await http.post(path, body, { headers });
      return { ok: true };
    } catch (err) {
      logger.warn(
        { err: err.message, path },
        "Platform API sync failed (non-blocking)"
      );
      return { ok: false, error: err.message };
    }
  }

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
    return post(
      "/api/v1/usage/trial-report",
      payload,
      { "x-usage-secret": usageSecret }
    );
  }

  return {
    enabled,
    callerCheck,
    trialReport,
    notifyCallStart(payload) {
      return post(
        "/api/v1/integrations/voice/call-start",
        payload,
        { "x-integration-secret": integrationSecret }
      );
    },
    notifyCallEnd(payload) {
      return post(
        "/api/v1/integrations/voice/call-end",
        payload,
        { "x-integration-secret": integrationSecret }
      );
    },
    reportUsage(payload) {
      return post(
        "/api/v1/usage/report",
        payload,
        { "x-usage-secret": usageSecret }
      );
    },
  };
}

module.exports = createPlatformApi;
