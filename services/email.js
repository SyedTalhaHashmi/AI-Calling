const nodemailer = require("nodemailer");

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

  async function sendTranscript({ callSid, transcriptBody, startedAt }) {
    const dateLabel = startedAt ? new Date(startedAt).toISOString() : new Date().toISOString();
    const info = await transporter.sendMail({
      from: emailConfig.from,
      to: emailConfig.to,
      subject: "AI Call Transcript",
      text: `${transcriptBody}\n`,
    });

    logger.info(
      {
        callSid,
        messageId: info.messageId,
        date: dateLabel,
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
