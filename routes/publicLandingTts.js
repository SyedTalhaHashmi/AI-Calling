const express = require("express");
const axios = require("axios");

const MAX_TEXT_LEN = 900;

/** Browser calls this from the marketing site; allow only listed Origins. */
function parseLandingTtsAllowedOrigins() {
  const fromEnv = (process.env.LANDING_TTS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  return [
    "https://buddycallai.com",
    "https://www.buddycallai.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
}

function landingDemoTtsCors(req, res, next) {
  const allowed = parseLandingTtsAllowedOrigins();
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
}

function resolveLandingTtsProvider(config) {
  const p = (config.landingTts?.provider || "auto").trim().toLowerCase();
  const hasDeepgram = Boolean(config.deepgram?.apiKey);
  const hasEleven = Boolean(config.elevenlabs?.apiKey);

  if (p === "deepgram") return hasDeepgram ? "deepgram" : null;
  if (p === "elevenlabs") return hasEleven ? "elevenlabs" : null;
  if (p === "auto" || p === "") {
    if (hasDeepgram) return "deepgram";
    if (hasEleven) return "elevenlabs";
    return null;
  }
  return null;
}

function createPublicLandingTtsRoutes({ config, logger }) {
  const router = express.Router();

  router.use(landingDemoTtsCors);

  router.post("/api/public/landing-demo-tts", async (req, res) => {
    const text = String(req.body?.text ?? "").trim();
    if (!text || text.length > MAX_TEXT_LEN) {
      return res.status(400).json({ error: `Text must be 1–${MAX_TEXT_LEN} characters.` });
    }

    const lang = req.body?.lang === "es" ? "es" : "en";
    const provider = resolveLandingTtsProvider(config);

    if (!provider) {
      return res.status(503).json({
        error: "Voice demo unavailable",
        details: "Set DEEPGRAM_API_KEY and/or ELEVENLABS_API_KEY on this server (see .env.example).",
      });
    }

    try {
      if (provider === "deepgram") {
        const model = lang === "es" ? config.deepgram.ttsModelEs : config.deepgram.ttsModelEn;
        const response = await axios.post(
          `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}`,
          { text },
          {
            headers: {
              Authorization: `Token ${config.deepgram.apiKey}`,
              "Content-Type": "application/json",
            },
            responseType: "arraybuffer",
            timeout: 45000,
            validateStatus: () => true,
          }
        );

        if (response.status >= 400) {
          const snippet = Buffer.isBuffer(response.data)
            ? response.data.toString("utf8").slice(0, 200)
            : String(response.data || "");
          logger.warn(
            { status: response.status, snippet },
            "Deepgram landing TTS failed"
          );
          return res.status(502).json({ error: "TTS provider error" });
        }

        const ct = response.headers["content-type"] || "audio/wav";
        res.setHeader("Content-Type", ct);
        res.setHeader("Cache-Control", "no-store");
        return res.send(Buffer.from(response.data));
      }

      const { apiKey, defaultVoiceId, defaultModelId } = config.elevenlabs;
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${defaultVoiceId}`,
        {
          text,
          model_id: defaultModelId,
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
            use_speaker_boost: true,
          },
        },
        {
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          responseType: "arraybuffer",
          timeout: 45000,
          validateStatus: () => true,
        }
      );

      if (response.status >= 400) {
        logger.warn({ status: response.status }, "ElevenLabs landing TTS failed");
        return res.status(502).json({ error: "TTS provider error" });
      }

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      return res.send(Buffer.from(response.data));
    } catch (err) {
      logger.error({ err: err.message }, "Landing demo TTS route error");
      return res.status(500).json({ error: "TTS failed" });
    }
  });

  return router;
}

module.exports = createPublicLandingTtsRoutes;
