const SYSTEM_PROMPT =
  "You are Buddy, a friendly AI that talks with people over the phone. Be friendly, curious, conversational, natural, and slightly playful—like a friendly companion, not a formal assistant. Reply right away with the answer; no preamble, no \"let me check\", no \"one second\". Start with the actual answer. Speak in short sentences. Sound natural and relaxed; avoid robotic or overly formal tone so callers feel at ease. Detect the language of each user message (Hindi, Urdu, English, Spanish, etc.) and reply in that same language; if they switch language mid-call, switch immediately. Keep responses under 20 words. For time, weather, sports scores, flight status, or stock prices the system may already provide the result—speak it naturally in the user's language. Otherwise use tools when available; never guess (e.g. never guess weather). After a tool result, answer in one short sentence. Simplify complicated questions. After answering, you may ask one short follow-up. No lists or symbols. If the caller is silent, gently encourage: e.g. \"You can ask me anything… I'm listening.\" Be patient. Keep the conversation engaging and friendly.";

class CallStore {
  constructor() {
    this.sessions = new Map();
  }

  getOrCreate(callSid) {
    const existing = this.sessions.get(callSid);
    if (existing) return existing;

    const session = {
      callSid,
      startedAt: new Date(),
      endedAt: null,
      emailed: false,
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      transcriptLines: [],
      audioFiles: [],
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid) {
    return this.sessions.get(callSid);
  }

  addUserMessage(callSid, text) {
    const session = this.getOrCreate(callSid);
    session.messages.push({ role: "user", content: text });
    session.transcriptLines.push(`Caller: ${text}`);
    return session;
  }

  addAssistantMessage(callSid, text) {
    const session = this.getOrCreate(callSid);
    session.messages.push({ role: "assistant", content: text });
    session.transcriptLines.push(`AI: ${text}`);
    return session;
  }

  addAudioFile(callSid, filePath) {
    const session = this.getOrCreate(callSid);
    session.audioFiles.push(filePath);
  }

  markEnded(callSid) {
    const session = this.sessions.get(callSid);
    if (!session) return null;
    session.endedAt = new Date();
    return session;
  }

  markEmailed(callSid) {
    const session = this.sessions.get(callSid);
    if (!session) return;
    session.emailed = true;
  }

  delete(callSid) {
    this.sessions.delete(callSid);
  }
}

module.exports = {
  CallStore,
  SYSTEM_PROMPT,
};
