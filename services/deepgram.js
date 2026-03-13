const axios = require("axios");

function createDeepgramService({ apiKey, model, logger }) {
  async function transcribeAudio(buffer, mimeType = "audio/mpeg") {
    try {
      const response = await axios.post(
        `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true`,
        buffer,
        {
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": mimeType,
          },
          timeout: 30000,
        }
      );

      const transcript =
        response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";

      return transcript;
    } catch (error) {
      logger.error(
        {
          err: error.message,
          status: error.response?.status,
          data: error.response?.data,
        },
        "Deepgram transcription failed"
      );
      throw new Error("TRANSCRIPTION_FAILED");
    }
  }

  return {
    transcribeAudio,
  };
}

module.exports = createDeepgramService;
