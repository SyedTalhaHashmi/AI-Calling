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
      callStore.getOrCreate(callSid);
      logger.info(
        { callSid, from: req.body.From, to: req.body.To, streamUrl },
        "Call started (streaming)"
      );

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

    try {
      const transcriptBody = formatTranscript(session);
      await services.email.sendTranscript({
        callSid,
        transcriptBody,
        startedAt: session.startedAt,
      });
      callStore.markEmailed(callSid);
    } catch (error) {
      logger.error(
        { callSid, err: error.message },
        "Failed sending transcript email"
      );
    }

    callStore.delete(callSid);
    logger.info({ callSid }, "Call ended and session cleaned up");
    return res.status(200).send("ok");
  });

  return router;
}

module.exports = createCallRoutes;
