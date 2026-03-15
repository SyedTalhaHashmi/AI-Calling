const SYSTEM_PROMPT =
  "You are a friendly phone assistant. Reply right away with the answer—no preamble, no \"let me check\", no \"one second\", no \"sure, I'll get that\". Start your reply with the actual answer. Always use the same language as the caller. Keep responses under 20 words. Sound natural. For weather, flights, sports, or live info, use tools—do not guess. Simplify complicated questions. After answering, you may ask one short follow-up. No lists or symbols. Speak conversationally.";

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
