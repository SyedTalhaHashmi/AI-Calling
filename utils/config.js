const dotenv = require("dotenv");

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  /** Seconds to wait before returning TwiML so caller hears 1–2 rings (natural pickup). */
  ringDelaySeconds: Number(process.env.RING_DELAY_SECONDS || 5),
  twilio: {
    accountSid: required("TWILIO_ACCOUNT_SID"),
    authToken: required("TWILIO_AUTH_TOKEN"),
    phoneNumber: required("TWILIO_PHONE_NUMBER"),
  },
  openai: {
    apiKey: required("OPENAI_API_KEY"),
  },
  openweather: {
    apiKey: process.env.OPENWEATHER_API_KEY || "",
  },
  openMeteo: {
    enabled: process.env.OPEN_METEO_ENABLED !== "false",
  },
  googlePlaces: {
    apiKey: process.env.GOOGLE_PLACES_API_KEY || "",
  },
  travelpayouts: {
    token: process.env.TRAVELPAYOUTS_TOKEN || "",
  },
  newsApi: {
    apiKey: process.env.NEWS_API_KEY || "",
  },
  frankfurter: {
    enabled: process.env.FRANKFURTER_ENABLED !== "false",
  },
  rapidApi: {
    key: process.env.RAPIDAPI_KEY || "",
    worldTimeHost:
      process.env.WORLD_TIME_API_HOST || "world-time-api3.p.rapidapi.com",
  },
  apiFootball: {
    apiKey: process.env.API_FOOTBALL_KEY || "",
  },
  aviationstack: {
    apiKey: process.env.AVIATIONSTACK_API_KEY || "",
  },
  alphavantage: {
    apiKey: process.env.ALPHAVANTAGE_API_KEY || "",
  },
  email: {
    /** Verified mailbox used in SMTP MAIL FROM / From header (e.g. Hostinger). */
    from: required("EMAIL_FROM"),
    /** Display name for From, e.g. BuddyCallAI — optional (SMTP_FROM_NAME). */
    fromName: (process.env.SMTP_FROM_NAME || process.env.EMAIL_FROM_NAME || "").trim(),
    /**
     * Fallback when the platform does not return a line-specific transcript email
     * (trial/anonymous callers). Subscribers: recipient comes from DB via caller-check `transcriptEmail`.
     */
    to: (process.env.EMAIL_TO || "").trim(),
    smtpHost: process.env.SMTP_HOST || "",
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER || "",
    smtpPass: process.env.SMTP_PASS || "",
    smtpSecure: process.env.SMTP_SECURE === "true",
  },
  platform: {
    apiBaseUrl: process.env.PLATFORM_API_BASE_URL || "",
    integrationSecret: process.env.INTEGRATION_WEBHOOK_SECRET || "",
    usageSecret: process.env.USAGE_WEBHOOK_SECRET || "",
  },
  /** Landing page “Play Voice” demo — proxied via POST /api/public/landing-demo-tts */
  elevenlabs: {
    apiKey: (process.env.ELEVENLABS_API_KEY || "").trim(),
    defaultVoiceId: (process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM").trim(),
    defaultModelId: (process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5").trim(),
  },
  /** Deepgram Aura TTS — used when configured (preferred over ElevenLabs for “auto”). */
  deepgram: {
    apiKey: (process.env.DEEPGRAM_API_KEY || "").trim(),
    ttsModelEn: (process.env.DEEPGRAM_TTS_MODEL_EN || "aura-2-thalia-en").trim(),
    ttsModelEs: (process.env.DEEPGRAM_TTS_MODEL_ES || "aura-2-celeste-es").trim(),
  },
  /** Landing TTS: auto | deepgram | elevenlabs */
  landingTts: {
    provider: (process.env.LANDING_TTS_PROVIDER || "auto").trim().toLowerCase(),
  },
};

module.exports = config;
