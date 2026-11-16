/**
 * Reminder calls (outbound). The platform's worker asks us to place a due reminder;
 * we check the account like an inbound call, dial with answering-machine detection,
 * read the reminder to a voicemail or connect Buddy to a person, and report each
 * try's outcome back through the outbox (from /call-status in routes/calls.js).
 */
const crypto = require("crypto");
const express = require("express");
const twilio = require("twilio");

const MACHINE = /^(machine|fax)/;

function streamUrl(base) {
  return `${base.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://")}/media-stream`;
}

function sameSecret(got, want) {
  const a = Buffer.from(String(got || ""));
  const b = Buffer.from(String(want || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function createOutboundRoutes({ logger, callStore, config, twilioClient, platformApi }) {
  const router = express.Router();
  const secret = config.platform?.integrationSecret || "";
  /** "reminderId:attempt" → callSid (or the pending dial): a repeated request never dials twice. */
  const placed = new Map();

  router.post("/internal/outbound/reminder", async (req, res) => {
    if (!secret || !sameSecret(req.get("x-integration-secret"), secret)) return res.status(401).json({ error: "Unauthorized" });
    const { reminderId, attempt, to, userId, message } = req.body || {};
    if (!reminderId || !to || !userId || !message) return res.status(400).json({ error: "reminderId, to, userId and message are required" });
    if (!config.publicBaseUrl) return res.status(503).json({ error: "PUBLIC_BASE_URL not set", notDialed: true });

    const tryKey = `${reminderId}:${Number(attempt) || 1}`;
    const earlier = placed.get(tryKey);
    if (earlier) {
      const callSid = await earlier;
      if (callSid) return res.json({ ok: true, callSid, repeat: true });
    }

    // Same account check as an inbound call from that number
    const check = await platformApi.callerCheck({ callerNumber: to });
    if (check?.unavailable) {
      // The platform didn't answer: not a decision about the account, so try again later
      return res.status(503).json({ error: "Account check unavailable", notDialed: true });
    }
    if (!check?.allowed || check.mode === "trial" || check.mode === "test" || check.userId !== userId) {
      logger.info({ reminderId, mode: check?.mode }, "Reminder call not placed: account can't take calls now");
      return res.json({ ok: false, skipped: "no_access" });
    }

    let call;
    let settle;
    placed.set(tryKey, new Promise((r) => (settle = r)));
    try {
      call = await twilioClient.calls.create({
        to,
        from: config.twilio.outboundCallerId || config.twilio.phoneNumber,
        url: `${config.publicBaseUrl}/outbound-answer`,
        method: "POST",
        statusCallback: `${config.publicBaseUrl}/call-status`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["completed"],
        // Waits for the beep on a voicemail, so the whole reminder is recorded
        machineDetection: "DetectMessageEnd",
        timeout: 30,
      });
    } catch (err) {
      placed.delete(tryKey);
      settle(null);
      logger.error({ reminderId, err: err.message }, "Reminder call could not be placed");
      // Twilio refused it: nothing is ringing, so the platform may try again
      return res.status(502).json({ error: err.message, notDialed: true });
    }
    settle(call.sid);
    setTimeout(() => placed.delete(tryKey), 2 * 60 * 60 * 1000).unref?.();

    const cap = Math.max(30, Number(config.reminderCallMaxSeconds) || 300);
    const left = check.mode === "subscriber" && check.secondsRemaining > 0 ? check.secondsRemaining : null;
    const platformCap = check.maxSecondsThisCall > 0 ? check.maxSecondsThisCall : null;
    const session = callStore.getOrCreate(call.sid);
    Object.assign(session, {
      callerNumber: to,
      calledNumber: config.twilio.outboundCallerId || config.twilio.phoneNumber,
      billingMode: check.mode,
      platformUserId: check.userId,
      toolAccess: check.tools || undefined,
      timezone: check.timezone,
      reminderConsent: check.reminderConsent,
      maxBillableSeconds: Math.min(...[cap, left, platformCap].filter((n) => n != null)),
      outbound: { kind: "reminder", reminderId, attempt: Number(attempt) || 1, message: String(message).slice(0, 200) },
    });
    if (check.transcriptEmail) session.transcriptEmailTo = String(check.transcriptEmail).trim();
    logger.info({ callSid: call.sid, reminderId, attempt }, "Reminder call placed");
    return res.json({ ok: true, callSid: call.sid });
  });

  /** How a placed call ended, for the platform's check on tries that never reported. */
  router.get("/internal/outbound/status", async (req, res) => {
    if (!secret || !sameSecret(req.get("x-integration-secret"), secret)) return res.status(401).json({ error: "Unauthorized" });
    const callSid = String(req.query.callSid || "");
    if (!/^CA[0-9a-f]{32}$/i.test(callSid)) return res.status(400).json({ error: "callSid required" });
    try {
      const call = await twilioClient.calls(callSid).fetch();
      return res.json({ status: call.status });
    } catch (err) {
      logger.warn({ callSid, err: err.message }, "Call status lookup failed");
      return res.status(502).json({ error: err.message });
    }
  });

  /** Twilio: the call was answered (by a person or a machine). */
  router.post("/outbound-answer", (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const callSid = req.body.CallSid;
    const session = callSid ? callStore.get(callSid) : null;
    if (!session?.outbound) {
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }
    const answeredBy = String(req.body.AnsweredBy || "unknown");
    if (MACHINE.test(answeredBy)) {
      session.outbound.outcome = "voicemail";
      twiml.say({ voice: "alice" }, `Hi, this is Buddy from Buddy Call A I with your reminder: ${session.outbound.message}. Goodbye.`);
      twiml.hangup();
      logger.info({ callSid, answeredBy }, "Reminder left on voicemail");
      return res.type("text/xml").send(twiml.toString());
    }
    session.outbound.outcome = "answered";
    platformApi
      ?.notifyCallStart?.({ callSid, callerNumber: session.callerNumber, calledNumber: session.calledNumber, startedAt: new Date().toISOString() })
      ?.catch?.(() => {});
    twiml.connect().stream({ url: streamUrl(config.publicBaseUrl) });
    logger.info({ callSid, answeredBy }, "Reminder call answered");
    return res.type("text/xml").send(twiml.toString());
  });

  return router;
}

/** Outcome of one try from Twilio's final status. */
function reminderOutcome(session, callStatus) {
  if (session?.outbound?.outcome) return session.outbound.outcome;
  if (callStatus === "no-answer" || callStatus === "busy" || callStatus === "canceled") return callStatus;
  return "failed";
}

module.exports = createOutboundRoutes;
module.exports.reminderOutcome = reminderOutcome;
