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
  twilio: {
    accountSid: required("TWILIO_ACCOUNT_SID"),
    authToken: required("TWILIO_AUTH_TOKEN"),
    phoneNumber: required("TWILIO_PHONE_NUMBER"),
  },
  deepgram: {
    apiKey: required("DEEPGRAM_API_KEY"),
    model: process.env.DEEPGRAM_MODEL || "nova-2",
  },
  openai: {
    apiKey: required("OPENAI_API_KEY"),
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  elevenlabs: {
    apiKey: required("ELEVENLABS_API_KEY"),
    voiceId: process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
    modelId: process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5",
  },
  email: {
    from: required("EMAIL_FROM"),
    to: required("EMAIL_TO"),
    smtpHost: process.env.SMTP_HOST || "",
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER || "",
    smtpPass: process.env.SMTP_PASS || "",
    smtpSecure: process.env.SMTP_SECURE === "true",
  },
};

module.exports = config;
