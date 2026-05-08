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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function transcriptToHtml(transcriptBody) {
  return escapeHtml(transcriptBody).replace(/\n/g, "<br/>");
}

function renderBrandedTranscriptEmail({ dateLabel, callSid, transcriptBody }) {
  const safeDate = escapeHtml(dateLabel);
  const safeCallSid = escapeHtml(callSid || "Unknown");
  const transcriptHtml = transcriptToHtml(transcriptBody);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>AI Call Transcript</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#11172A;border:1px solid rgba(79,195,247,0.2);border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;border-bottom:1px solid rgba(79,195,247,0.16);background:#11172A;">
                <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#4FC3F7;font-weight:700;">Call Summary</div>
                <div style="margin-top:6px;font-size:22px;line-height:1.3;color:#ffffff;font-weight:700;">AI Call Transcript</div>
                <p style="margin:10px 0 0;color:#9fb0cc;font-size:12px;line-height:1.6;">
                  <strong style="color:#dbe7f8;">Date:</strong> ${safeDate}<br/>
                  <strong style="color:#dbe7f8;">Call SID:</strong> ${safeCallSid}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <div style="font-size:14px;line-height:1.7;color:#dbe7f8;background:rgba(255,255,255,0.02);border:1px solid rgba(79,195,247,0.15);border-radius:10px;padding:14px 16px;">
                  ${transcriptHtml}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid rgba(79,195,247,0.12);background:#11172A;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#9fb0cc;">
                  BuddyCallAI &middot; Talk to AI. Just Call.<br/>
                  Need help? Contact <a href="mailto:info@buddycallai.com" style="color:#7dd3ff;text-decoration:none;">info@buddycallai.com</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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
      html: renderBrandedTranscriptEmail({
        dateLabel,
        callSid,
        transcriptBody,
      }),
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
