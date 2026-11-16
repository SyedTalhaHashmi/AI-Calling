/**
 * Call routes - streaming architecture.
 * /incoming-call returns Connect/Stream TwiML (no recording).
 * /call-status sends transcript email when call ends.
 */
const express = require("express");
const twilio = require("twilio");
const { formatTranscript, hasCallerSpeech } = require("../utils/transcript");
const { estimateCost, emptyUsage } = require("../utils/realtimeCost");
const { reminderOutcome } = require("./outbound");

const GENERIC_FALLBACK =
  "Sorry, the assistant had a problem. Please try again later. Goodbye.";

function getStreamUrl(req, configuredBaseUrl) {
  const base = configuredBaseUrl || `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host")}`;
  const wsBase = base.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
  return `${wsBase}/media-stream`;
}

/** The first lines that fit in 200 KB (the platform keeps no more; bigger reports are refused). */
function capTranscript(lines) {
  const out = [];
  let size = 2;
  for (const line of lines || []) {
    size += Buffer.byteLength(JSON.stringify(String(line)), "utf8") + 1;
    if (size > 200 * 1024) break;
    out.push(String(line));
  }
  return out;
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
      // Hung up while it was still ringing: Twilio already sent the final status, so don't start the call
      if (callStore.takeEndedEarly(callSid)) {
        logger.info({ callSid }, "Caller hung up before connect");
        twiml.hangup();
        return res.type("text/xml").send(twiml.toString());
      }
      const session = callStore.getOrCreate(callSid);
      session.callerNumber = req.body.From || null;
      session.calledNumber = req.body.To || null;
      session.billingMode = "legacy";
      session.platformUserId = null;
      session.maxBillableSeconds = null;
      session.toolAccess = undefined;

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
        // Which live tools this call may use (plan and monthly limits); absent = all on
        session.toolAccess = check.tools || undefined;
        if (check.transcriptEmail && String(check.transcriptEmail).trim()) {
          session.transcriptEmailTo = String(check.transcriptEmail).trim();
        }
        if (check.mode === "subscriber" && check.secondsRemaining > 0) {
          session.maxBillableSeconds = check.secondsRemaining;
        } else if (check.maxSecondsThisCall > 0) {
          // Trial calls, and Pay As You Go calls (a length cap set by the platform)
          session.maxBillableSeconds = check.maxSecondsThisCall;
        }
        // overage / subscriber_platinum without a cap: the call continues past included minutes
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
    if (!session) callStore.markEndedEarly(callSid);
    if (!session || session.emailed) {
      return res.status(200).send("ok");
    }

    // A reminder call: the platform learns how this try went (retry, done or email)
    if (session.outbound?.kind === "reminder") {
      services.platformApi?.reportReminderResult?.({
        reminderId: session.outbound.reminderId,
        attempt: session.outbound.attempt,
        outcome: reminderOutcome(session, callStatus),
        callSid,
      });
    }

    let transcriptSent = false;
    // Blocked callers and hang-ups before speaking left "No conversation captured." emails
    if (!hasCallerSpeech(session)) {
      logger.info({ callSid, callStatus }, "Transcript not sent: caller never spoke");
    } else {
      try {
        const transcriptBody = formatTranscript(session);
        await services.email.sendTranscript({
          callSid,
          transcriptBody,
          startedAt: session.startedAt,
          to: session.transcriptEmailTo || undefined,
        });
        callStore.markEmailed(callSid);
        transcriptSent = true;
      } catch (error) {
        logger.error(
          { callSid, err: error.message },
          "Failed sending transcript email"
        );
      }
    }

    const durationSeconds = Math.max(0, Number(req.body.CallDuration || 0));
    // On a reminder call Twilio's From is our number: the member is the number we called
    const callerNumber = (session.outbound ? session.callerNumber : req.body.From || session.callerNumber) || null;
    const calledNumber = (session.outbound ? session.calledNumber : req.body.To || session.calledNumber) || null;
    // Length, transcript, language and AI cost: kept in the outbox until the platform confirms
    let costUsd = null;
    if (session.usage?.responses && session.costModels) {
      costUsd = estimateCost({ ...emptyUsage(), ...session.usage }, { ...session.costModels, callSeconds: durationSeconds }).usd;
    }
    services.platformApi
      ?.notifyCallEnd({
        callSid,
        userId: session.platformUserId || null,
        status: callStatus,
        endedAt: new Date().toISOString(),
        durationSeconds,
        transcriptSent,
        callerNumber,
        calledNumber,
        transcript: hasCallerSpeech(session) ? capTranscript(session.transcriptLines) : [],
        language: session.replyLanguage || null,
        costUsd: costUsd != null && Number.isFinite(costUsd) ? Math.round(costUsd * 10000) / 10000 : null,
      })
      ?.catch?.(() => {});
    if (durationSeconds > 0 && services.platformApi?.enabled) {
      const mode = session?.billingMode;
      const userId = session?.platformUserId || null;
      // Only sync usage when we have a real platform identity or a trial number.
      // Avoid /usage/report 404s for blocked/legacy calls with no user.
      if (mode === "trial" && callerNumber) {
        services.platformApi
          .trialReport({
            callSid,
            callerNumber,
            secondsConsumed: durationSeconds,
          })
          .catch(() => {});
      } else if (
        (mode === "subscriber" ||
          mode === "subscriber_platinum" ||
          mode === "overage") &&
        userId
      ) {
        services.platformApi
          .reportUsage({
            callSid,
            userId,
            callerNumber,
            secondsConsumed: durationSeconds,
            billingMode: mode,
          })
          .catch(() => {});
      } else if (userId) {
        services.platformApi
          .reportUsage({
            callSid,
            userId,
            callerNumber,
            secondsConsumed: durationSeconds,
            billingMode: mode || "legacy",
          })
          .catch(() => {});
      } else {
        logger.info(
          { callSid, mode, durationSeconds },
          "Skip platform usage sync (no platform user / non-trial)"
        );
      }
    }

    callStore.delete(callSid);
    logger.info({ callSid }, "Call ended and session cleaned up");
    return res.status(200).send("ok");
  });

  return router;
}

module.exports = createCallRoutes;
