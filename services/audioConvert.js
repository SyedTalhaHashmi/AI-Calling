/**
 * Convert between Twilio (μ-law 8kHz) and OpenAI Realtime (PCM 24kHz 16-bit LE).
 */
const alawmulaw = require("alawmulaw");

const TWILIO_RATE = 8000;
const OPENAI_RATE = 24000;
const UPSAMPLE = OPENAI_RATE / TWILIO_RATE; // 3

/**
 * Twilio μ-law 8kHz base64 → PCM 24kHz base64 for OpenAI.
 */
function twilioToOpenAI(base64Mulaw) {
  const mulawBuf = Buffer.from(base64Mulaw, "base64");
  const pcm16 = alawmulaw.mulaw.decode(new Uint8Array(mulawBuf));
  const pcm24k = upsample8to24(pcm16);
  const bytes = new Uint8Array(pcm24k.buffer, pcm24k.byteOffset, pcm24k.byteLength);
  return Buffer.from(bytes).toString("base64");
}

/**
 * OpenAI PCM 24kHz base64 → μ-law 8kHz base64 for Twilio.
 */
function openAIToTwilio(base64Pcm) {
  const pcmBuf = Buffer.from(base64Pcm, "base64");
  const len = pcmBuf.length / 2;
  const pcm24k = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    pcm24k[i] = pcmBuf.readInt16LE(i * 2);
  }
  const pcm8k = downsample24to8(pcm24k);
  const mulawBuf = alawmulaw.mulaw.encode(pcm8k);
  return Buffer.from(mulawBuf).toString("base64");
}

function upsample8to24(pcm16) {
  const len = pcm16.length * UPSAMPLE;
  const out = new Int16Array(len);
  for (let i = 0; i < pcm16.length; i++) {
    const v = pcm16[i];
    for (let j = 0; j < UPSAMPLE; j++) {
      out[i * UPSAMPLE + j] = v;
    }
  }
  return out;
}

function downsample24to8(pcm24k) {
  const len = Math.floor(pcm24k.length / UPSAMPLE);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = pcm24k[i * UPSAMPLE];
  }
  return out;
}

module.exports = {
  twilioToOpenAI,
  openAIToTwilio,
};
