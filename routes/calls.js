/**
 * Call routes - streaming architecture.
 * /incoming-call returns Connect/Stream TwiML (no recording).
 * /call-status sends transcript email when call ends.
 */
const express = require("express");
const twilio = require("twilio");
const { formatTranscript } = require("../utils/transcript");

const GENERIC_FALLBACK =
  "Sorry, the assistant had a problem. Please try again later. Goodbye.";

function getStreamUrl(req, configuredBaseUrl) {
  const base = configuredBaseUrl || `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host")}`;
  const wsBase = base.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
  return `${wsBase}/media-stream`;
}

function createCallRoutes({ logger, callStore, services, config }) {
  const router = express.Router();

  router.get("/incoming-call", (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(
      { voice: "alice" },
      "Streaming AI assistant. Use POST for real calls."
    );
    res.type("text/xml").send(twiml.toString());
  });

  router.post("/incoming-call", async (req, res) => {
    const callSid = req.body.CallSid;
    const twiml = new twilio.twiml.VoiceResponse();

    if (!callSid) {
      logger.error({ payload: req.body }, "Incoming call webhook missing CallSid");
      twiml.say({ voice: "alice" }, GENERIC_FALLBACK);
      return res.type("text/xml").send(twiml.toString());
    }

    try {
      const streamUrl = getStreamUrl(req, config.publicBaseUrl);
      const ringDelay = Math.max(0, Number(config.ringDelaySeconds) || 0);
      if (ringDelay > 0) {
        logger.info({ callSid, ringDelaySeconds: ringDelay }, "Ringing before connect");
        await new Promise((r) => setTimeout(r, ringDelay * 1000));
      }
      const session = callStore.getOrCreate(callSid);
      session.callerNumber = req.body.From || null;
      session.calledNumber = req.body.To || null;
      session.billingMode = "legacy";
      session.platformUserId = null;
      session.maxBillableSeconds = null;

      const check = await services.platformApi?.callerCheck?.({
        callerNumber: session.callerNumber,
        calledNumber: session.calledNumber,
      });

      if (check && !check.skipped) {
        if (!check.allowed) {
          twiml.say(
            { voice: "alice" },
            check.message ||
              "Please subscribe to Buddy Call A I, then try again. Goodbye."
          );
          twiml.hangup();
          logger.info({ callSid, reason: "caller-check-denied" }, "Call blocked");
          return res.type("text/xml").send(twiml.toString());
        }
        session.billingMode = check.mode || "legacy";
        session.platformUserId = check.userId || null;
        if (check.mode === "subscriber" && check.secondsRemaining > 0) {
          session.maxBillableSeconds = check.secondsRemaining;
        } else if (check.mode === "trial" && check.maxSecondsThisCall > 0) {
          session.maxBillableSeconds = check.maxSecondsThisCall;
        }
      }

      logger.info(
        {
          callSid,
          from: req.body.From,
          to: req.body.To,
          streamUrl,
          billingMode: session.billingMode,
          maxBillableSeconds: session.maxBillableSeconds,
        },
        "Call started (streaming)"
      );
      services.platformApi
        ?.notifyCallStart({
          callSid,
          callerNumber: req.body.From || null,
          calledNumber: req.body.To || null,
          startedAt: new Date().toISOString(),
        })
        .catch(() => {});

      twiml.connect().stream({ url: streamUrl });
      return res.type("text/xml").send(twiml.toString());
    } catch (err) {
      logger.error({ callSid, err: err.message }, "Incoming call handler error");
      twiml.say({ voice: "alice" }, GENERIC_FALLBACK);
      return res.type("text/xml").send(twiml.toString());
    }
  });

  router.post("/call-status", async (req, res) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;

    if (!callSid) {
      logger.warn({ payload: req.body }, "Call status webhook missing CallSid");
      return res.status(200).send("ok");
    }

    logger.info({ callSid, callStatus }, "Call status update");

    const terminalStates = new Set([
      "completed",
      "canceled",
      "busy",
      "failed",
      "no-answer",
    ]);
    if (!terminalStates.has(callStatus)) {
      return res.status(200).send("ok");
    }

    const session = callStore.markEnded(callSid);
    if (!session || session.emailed) {
      return res.status(200).send("ok");
    }

    let transcriptSent = false;
    try {
      const transcriptBody = formatTranscript(session);
      await services.email.sendTranscript({
        callSid,
        transcriptBody,
        startedAt: session.startedAt,
      });
      callStore.markEmailed(callSid);
      transcriptSent = true;
    } catch (error) {
      logger.error(
        { callSid, err: error.message },
        "Failed sending transcript email"
      );
    }

    const durationSeconds = Math.max(0, Number(req.body.CallDuration || 0));
    const callerNumber = req.body.From || session.callerNumber || null;
    const calledNumber = req.body.To || session.calledNumber || null;
    services.platformApi
      ?.notifyCallEnd({
        callSid,
        status: callStatus,
        endedAt: new Date().toISOString(),
        durationSeconds,
        transcriptSent,
        callerNumber,
        calledNumber,
      })
      .catch(() => {});
    if (durationSeconds > 0 && services.platformApi?.enabled) {
      const mode = session?.billingMode;
      if (mode === "subscriber" && session?.platformUserId) {
        services.platformApi
          .reportUsage({
            userId: session.platformUserId,
            secondsConsumed: durationSeconds,
          })
          .catch(() => {});
      } else if (mode === "trial") {
        services.platformApi
          .trialReport({
            callerNumber,
            secondsConsumed: durationSeconds,
          })
          .catch(() => {});
      } else {
        services.platformApi
          .reportUsage({
            callerNumber,
            secondsConsumed: durationSeconds,
          })
          .catch(() => {});
      }
    } else if (durationSeconds > 0) {
      services.platformApi
        ?.reportUsage({
          callerNumber,
          secondsConsumed: durationSeconds,
        })
        .catch(() => {});
    }

    callStore.delete(callSid);
    logger.info({ callSid }, "Call ended and session cleaned up");
    return res.status(200).send("ok");
  });

  return router;
}

module.exports = createCallRoutes;
