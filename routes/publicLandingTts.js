/**
 * Landing page "Play Voice" — proxy ElevenLabs on the server (key stays in .env; browser avoids CORS).
 * Configure ELEVENLABS_* on the voice server process. Reverse-proxy /api/public/* here in production.
 */
const express = require("express");
const axios = require("axios");

const MAX_CHARS = 4000;

module.exports = function createPublicLandingTtsRoutes({ config, logger }) {
  const router = express.Router();

  function cors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  }

  router.options("/api/public/landing-demo-tts", (_req, res) => {
    cors(res);
    res.status(204).end();
  });

  router.post("/api/public/landing-demo-tts", async (req, res) => {
    cors(res);

    const key = config?.elevenlabs?.apiKey || "";
    if (!key) {
      return res.status(503).json({ error: "Demo voice not configured" });
    }

    const raw = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const text = raw.slice(0, MAX_CHARS);
    if (!text) {
      return res.status(400).json({ error: "text required" });
    }

    const voiceId = config.elevenlabs.defaultVoiceId;
    const modelId = config.elevenlabs.defaultModelId;

    try {
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        { text, model_id: modelId },
        {
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          responseType: "arraybuffer",
          timeout: 45000,
          validateStatus: () => true,
        }
      );

      if (response.status < 200 || response.status >= 300) {
        logger.warn(
          { status: response.status },
          "landing-demo-tts: ElevenLabs error"
        );
        return res.status(502).json({ error: "Voice generation failed" });
      }

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.send(Buffer.from(response.data));
    } catch (err) {
      logger.error({ err: err.message }, "landing-demo-tts failed");
      return res.status(502).json({ error: "Voice generation failed" });
    }
  });

  return router;
};
