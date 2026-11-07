/**
 * Per-call OpenAI Realtime usage and an estimated cost, from the `usage` on every response.done.
 * Logging only — never affects the call. Prices are USD per 1M tokens (OpenAI pricing page,
 * 2026-11); a model not listed here logs tokens without a cost.
 */

const PRICES = {
  "gpt-realtime": { textIn: 4, textOut: 16, audioIn: 32, audioOut: 64, cachedText: 0.4, cachedAudio: 0.4 },
  "gpt-realtime-2": { textIn: 4, textOut: 24, audioIn: 32, audioOut: 64, cachedText: 0.4, cachedAudio: 0.4 },
  "gpt-realtime-2.1": { textIn: 4, textOut: 24, audioIn: 32, audioOut: 64, cachedText: 0.4, cachedAudio: 0.4 },
  "gpt-realtime-2.1-mini": { textIn: 0.6, textOut: 2.4, audioIn: 10, audioOut: 20, cachedText: 0.06, cachedAudio: 0.3 },
  "gpt-realtime-mini": { textIn: 0.6, textOut: 2.4, audioIn: 10, audioOut: 20, cachedText: 0.06, cachedAudio: 0.3 },
};

/** Caller speech-to-text, USD per minute of audio. */
const TRANSCRIBE_PER_MINUTE = {
  "gpt-transcribe": 0.0045,
  "whisper-1": 0.006,
  "gpt-4o-transcribe": 0.006,
  "gpt-4o-mini-transcribe": 0.003,
  "gpt-live-transcribe": 0.017,
};

function emptyUsage() {
  return {
    responses: 0,
    textIn: 0,
    audioIn: 0,
    cachedText: 0,
    cachedAudio: 0,
    textOut: 0,
    audioOut: 0,
    speechSeconds: 0,
  };
}

/** Adds one response.done `usage` object to the running totals (missing fields count as 0). */
function addResponseUsage(totals, usage) {
  if (!usage) return totals;
  const inDet = usage.input_token_details || {};
  const cached = inDet.cached_tokens_details || {};
  const outDet = usage.output_token_details || {};
  const cachedText = Number(cached.text_tokens) || 0;
  const cachedAudio = Number(cached.audio_tokens) || 0;
  totals.responses += 1;
  // Cached tokens are part of the input counts; split them out so each is priced once
  totals.textIn += Math.max(0, (Number(inDet.text_tokens) || 0) - cachedText);
  totals.audioIn += Math.max(0, (Number(inDet.audio_tokens) || 0) - cachedAudio);
  totals.cachedText += cachedText;
  totals.cachedAudio += cachedAudio;
  totals.textOut += Number(outDet.text_tokens) || 0;
  totals.audioOut += Number(outDet.audio_tokens) || 0;
  return totals;
}

/**
 * { usd, usdPerMinute, cachedShare } for a call, or usd null when the model has no price.
 * callSeconds: call length; speechSeconds in totals: caller speech sent to transcription.
 */
function estimateCost(totals, { model, transcribeModel, callSeconds }) {
  const p = PRICES[model];
  const perMinute = TRANSCRIBE_PER_MINUTE[transcribeModel] ?? null;
  const inputAll = totals.textIn + totals.audioIn + totals.cachedText + totals.cachedAudio;
  const cachedShare = inputAll ? (totals.cachedText + totals.cachedAudio) / inputAll : 0;
  if (!p) return { usd: null, usdPerMinute: null, cachedShare };
  const tokensUsd =
    (totals.textIn * p.textIn +
      totals.audioIn * p.audioIn +
      totals.cachedText * p.cachedText +
      totals.cachedAudio * p.cachedAudio +
      totals.textOut * p.textOut +
      totals.audioOut * p.audioOut) /
    1e6;
  const sttUsd = perMinute != null ? (totals.speechSeconds / 60) * perMinute : 0;
  const usd = tokensUsd + sttUsd;
  const minutes = Math.max(callSeconds || 0, 1) / 60;
  return { usd: round(usd, 5), usdPerMinute: round(usd / minutes, 5), cachedShare: round(cachedShare, 3) };
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

module.exports = { PRICES, TRANSCRIBE_PER_MINUTE, emptyUsage, addResponseUsage, estimateCost };
