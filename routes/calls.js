const express = require("express");
const fs = require("fs/promises");
const twilio = require("twilio");
const { formatTranscript } = require("../utils/transcript");

const GREETING = "Hello, you are speaking with an AI assistant. Ask me anything.";
const TRANSCRIPTION_FALLBACK = "Sorry, I didn't catch that. Could you repeat?";
const GENERIC_FALLBACK = "Sorry, I'm having trouble answering right now.";

function getBaseUrl(req, configuredBaseUrl) {
  if (configuredBaseUrl) return configuredBaseUrl;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

function appendListenStep(twiml) {
  twiml.record({
    action: "/process-recording",
    method: "POST",
    timeout: 3,
    maxLength: 30,
    playBeep: false,
    trim: "trim-silence",
  });
}

async function buildAudioOrSay(twiml, text, callSid, services, baseUrl, callStore) {
  try {
    const speechFile = await services.elevenlabs.synthesizeSpeech(text, callSid);
    callStore.addAudioFile(callSid, speechFile.filePath);
    twiml.play(`${baseUrl}/audio/${speechFile.fileName}`);
    return true;
  } catch (error) {
    twiml.say({ voice: "alice" }, text);
    return false;
  }
}

function createCallRoutes({ logger, callStore, services, config }) {
  const router = express.Router();

  // GET so you can open in browser and confirm this URL returns TwiML (not "for development")
  router.get("/incoming-call", (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: "alice" }, "This is your AI assistant. Webhook is working. Use POST for real calls.");
    res.type("text/xml").send(twiml.toString());
  });

  router.post("/incoming-call", async (req, res) => {
    const callSid = req.body.CallSid;
    const twiml = new twilio.twiml.VoiceResponse();

    const sendTwiML = (xml) => {
      res.type("text/xml").send(xml);
    };

    if (!callSid) {
      logger.error({ payload: req.body }, "Incoming call webhook missing CallSid");
      twiml.say({ voice: "alice" }, GENERIC_FALLBACK);
      return sendTwiML(twiml.toString());
    }

    try {
      const baseUrl = getBaseUrl(req, config.publicBaseUrl);
      callStore.getOrCreate(callSid);
      callStore.addAssistantMessage(callSid, GREETING);
      logger.info({ callSid, from: req.body.From, to: req.body.To }, "Call started");

      await buildAudioOrSay(twiml, GREETING, callSid, services, baseUrl, callStore);
      appendListenStep(twiml);
      return sendTwiML(twiml.toString());
    } catch (err) {
      logger.error({ callSid, err: err.message }, "Incoming call handler error");
      const fallback = new twilio.twiml.VoiceResponse();
      fallback.say({ voice: "alice" }, "Sorry, the assistant had a problem. Please try again later. Goodbye.");
      return sendTwiML(fallback.toString());
    }
  });

  router.post("/process-recording", async (req, res) => {
    const callSid = req.body.CallSid;
    const recordingUrl = req.body.RecordingUrl;
    const twiml = new twilio.twiml.VoiceResponse();
    const baseUrl = getBaseUrl(req, config.publicBaseUrl);

    if (!callSid) {
      logger.error({ payload: req.body }, "Recording webhook missing CallSid");
      twiml.say({ voice: "alice" }, GENERIC_FALLBACK);
      return res.type("text/xml").send(twiml.toString());
    }

    callStore.getOrCreate(callSid);

    if (!recordingUrl) {
      logger.warn({ callSid }, "No recording URL received");
      await buildAudioOrSay(twiml, TRANSCRIPTION_FALLBACK, callSid, services, baseUrl, callStore);
      appendListenStep(twiml);
      return res.type("text/xml").send(twiml.toString());
    }

    try {
      const audioBuffer = await services.twilioMedia.downloadRecording(recordingUrl);
      const transcript = await services.deepgram.transcribeAudio(audioBuffer, "audio/mpeg");
      logger.info({ callSid, transcript }, "Transcription result");

      if (!transcript) {
        await buildAudioOrSay(twiml, TRANSCRIPTION_FALLBACK, callSid, services, baseUrl, callStore);
        appendListenStep(twiml);
        return res.type("text/xml").send(twiml.toString());
      }

      callStore.addUserMessage(callSid, transcript);

      let assistantReply = "";
      try {
        const session = callStore.get(callSid);
        assistantReply = await services.openai.generateReply(session.messages);
      } catch (error) {
        assistantReply = GENERIC_FALLBACK;
      }

      callStore.addAssistantMessage(callSid, assistantReply);
      logger.info({ callSid, reply: assistantReply }, "AI response generated");

      await buildAudioOrSay(twiml, assistantReply, callSid, services, baseUrl, callStore);
      logger.info({ callSid }, "Audio response generated");
      appendListenStep(twiml);
      return res.type("text/xml").send(twiml.toString());
    } catch (error) {
      logger.error({ callSid, err: error.message }, "Conversation loop step failed");
      await buildAudioOrSay(twiml, GENERIC_FALLBACK, callSid, services, baseUrl, callStore);
      appendListenStep(twiml);
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

    const terminalStates = new Set(["completed", "canceled", "busy", "failed", "no-answer"]);
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
      logger.error({ callSid, err: error.message }, "Failed sending transcript email");
    } finally {
      for (const audioFilePath of session.audioFiles) {
        try {
          await fs.unlink(audioFilePath);
        } catch (error) {
          logger.warn({ callSid, audioFilePath }, "Unable to delete generated audio file");
        }
      }
      callStore.delete(callSid);
      logger.info({ callSid }, "Call ended and session cleaned up");
    }

    return res.status(200).send("ok");
  });

  return router;
}

module.exports = createCallRoutes;
