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
};

module.exports = config;
