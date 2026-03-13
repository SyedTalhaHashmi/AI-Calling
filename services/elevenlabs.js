const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const AUDIO_DIR = path.join(process.cwd(), "server", "audio");

async function ensureAudioDir() {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
}

function createElevenLabsService({ apiKey, voiceId, modelId, logger }) {
  async function synthesizeSpeech(text, callSid) {
    await ensureAudioDir();

    const safeCallSid = (callSid || "unknown").replace(/[^a-zA-Z0-9-_]/g, "");
    const fileName = `${safeCallSid}-${Date.now()}-${crypto.randomUUID()}.mp3`;
    const filePath = path.join(AUDIO_DIR, fileName);

    try {
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text,
          model_id: modelId,
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
          timeout: 30000,
        }
      );

      await fs.writeFile(filePath, Buffer.from(response.data));
      return { fileName, filePath };
    } catch (error) {
      logger.error(
        {
          err: error.message,
          status: error.response?.status,
          data: error.response?.data?.toString?.(),
        },
        "ElevenLabs speech synthesis failed"
      );
      throw new Error("TTS_FAILED");
    }
  }

  return {
    synthesizeSpeech,
    audioDir: AUDIO_DIR,
  };
}

module.exports = createElevenLabsService;
