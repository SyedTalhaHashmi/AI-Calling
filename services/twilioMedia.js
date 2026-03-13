const axios = require("axios");

function createTwilioMediaService({ accountSid, authToken, logger }) {
  async function downloadRecording(recordingUrl) {
    if (!recordingUrl) {
      throw new Error("Missing recording URL");
    }

    const url = `${recordingUrl}.mp3`;
    try {
      const response = await axios.get(url, {
        auth: {
          username: accountSid,
          password: authToken,
        },
        responseType: "arraybuffer",
        timeout: 30000,
      });

      return Buffer.from(response.data);
    } catch (error) {
      logger.error(
        {
          err: error.message,
          status: error.response?.status,
        },
        "Failed to download Twilio recording"
      );
      throw new Error("RECORDING_DOWNLOAD_FAILED");
    }
  }

  return {
    downloadRecording,
  };
}

module.exports = createTwilioMediaService;
