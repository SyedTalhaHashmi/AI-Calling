const nodemailer = require("nodemailer");

/** Nodemailer accepts string or { name, address } */
function resolveFromHeader(emailConfig) {
  const addr = String(emailConfig.from || "").trim();
  const name = emailConfig.fromName;
  if (name) {
    return { name, address: addr };
  }
  return addr;
}

function createTransport(emailConfig) {
  if (emailConfig.smtpHost) {
    return nodemailer.createTransport({
      host: emailConfig.smtpHost,
      port: emailConfig.smtpPort,
      secure: emailConfig.smtpSecure,
      auth: emailConfig.smtpUser
        ? {
            user: emailConfig.smtpUser,
            pass: emailConfig.smtpPass,
          }
        : undefined,
    });
  }

  // Fallback for local dev where system sendmail is available.
  return nodemailer.createTransport({
    sendmail: true,
    newline: "unix",
  });
}

function createEmailService({ emailConfig, logger }) {
  const transporter = createTransport(emailConfig);

  async function sendTranscript({ callSid, transcriptBody, startedAt, to }) {
    const dateLabel = startedAt ? new Date(startedAt).toISOString() : new Date().toISOString();
    /** Prefer platform/DB line email (subscriber); else EMAIL_TO for trial/anonymous. */
    const destination =
      (to && String(to).trim()) || (emailConfig.to && String(emailConfig.to).trim()) || "";
    if (!destination) {
      const err = new Error(
        "No transcript recipient: for subscribers ensure PLATFORM_API_* and integration secrets are set so the API can return transcriptEmail from UserPhoneNumber; for trial calls set EMAIL_TO."
      );
      err.code = "NO_TRANSCRIPT_TO";
      throw err;
    }
    const info = await transporter.sendMail({
      from: resolveFromHeader(emailConfig),
      to: destination,
      subject: "AI Call Transcript",
      text: `${transcriptBody}\n`,
    });

    logger.info(
      {
        callSid,
        messageId: info.messageId,
        date: dateLabel,
        to: destination,
      },
      "Transcript email sent"
    );

    return info;
  }

  return {
    sendTranscript,
  };
}

module.exports = createEmailService;
