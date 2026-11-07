const dotenv = require("dotenv");
const { parseRouterMode, parseToolDeadlineMs } = require("../handlers/realtimeTools");
const { parseWebSearchDailyLimit } = require("../services/webSearch");

dotenv.config();

/** Trimmed value, or undefined when unset or blank (so the handler's default applies). */
function env(name) {
  const v = (process.env[name] || "").trim();
  return v || undefined;
}

const oneOf = (value, allowed) => (allowed.includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : undefined);

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

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
  /** OpenAI Realtime session (calls). Every model name lives here so a retired model is one .env change. */
  realtime: {
    model: env("REALTIME_MODEL"),
    reasoningEffort: oneOf(env("REALTIME_REASONING_EFFORT"), ["minimal", "low", "medium", "high"]),
    voice: env("REALTIME_VOICE"),
    audioFormat: oneOf(env("REALTIME_AUDIO_FORMAT"), ["pcmu", "pcm24"]),
    transcribeModel: env("REALTIME_TRANSCRIBE_MODEL"),
    transcribeHints: env("REALTIME_TRANSCRIBE_HINTS") ? env("REALTIME_TRANSCRIBE_HINTS") !== "false" : undefined,
    noiseReduction: oneOf(env("REALTIME_NOISE_REDUCTION"), ["near_field", "far_field", "off"]),
    maxOutputTokens: positiveInt(env("REALTIME_MAX_OUTPUT_TOKENS")),
    truncationTokens: positiveInt(env("REALTIME_TRUNCATION_TOKENS")),
  },
  /** Seconds a redeploy waits for live calls to finish before the server stops. */
  shutdownGraceSeconds: positiveInt(env("SHUTDOWN_GRACE_SECONDS")) || 25,
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
    /** RapidAPI world time is opt-in; default answers come from built-in time-zone data. */
    worldTimeEnabled: process.env.WORLD_TIME_API_ENABLED === "true",
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
     * Fallback when caller-check has no line email (anonymous trial only).
     * Registered callers (subscriber or free trial) use UserPhoneNumber.emailForTranscripts.
     * Comma/semicolon-separated list allowed; every address receives the transcript.
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
  /**
   * Local mic → /media-stream tester (browser pretends to be Twilio).
   * Only served when ENABLE_MIC_TEST=true — keep off in production.
   */
  micTestEnabled: process.env.ENABLE_MIC_TEST === "true",
  /** Per-turn latency log lines ("turn_latency" / "call_latency"). Logging only; on unless "false". */
  latencyMetricsEnabled: process.env.LATENCY_METRICS !== "false",
  /** "regex" (default: existing fast paths) or "tools" (model picks existing-service tools). */
  routerMode: parseRouterMode(process.env.ROUTER_MODE),
  /** Tools mode only: per-tool time limit. */
  toolDeadlineMs: parseToolDeadlineMs(process.env.TOOL_DEADLINE_MS),
  /** Tools mode only: Exa web search, off unless WEB_SEARCH_ENABLED=true and a key is set. */
  webSearch: {
    enabled: process.env.WEB_SEARCH_ENABLED === "true",
    exaApiKey: (process.env.EXA_API_KEY || "").trim(),
    dailyLimit: parseWebSearchDailyLimit(process.env.WEB_SEARCH_DAILY_LIMIT),
  },
};

module.exports = config;
