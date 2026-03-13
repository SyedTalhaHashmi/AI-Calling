function formatTranscript(session) {
  const started = session.startedAt ? session.startedAt.toISOString() : "Unknown";
  const ended = session.endedAt ? session.endedAt.toISOString() : "Unknown";
  const conversation = session.transcriptLines.length
    ? session.transcriptLines.join("\n")
    : "No conversation captured.";

  return [
    "AI Call Transcript",
    "",
    `Date: ${started}`,
    `Call SID: ${session.callSid}`,
    `Ended: ${ended}`,
    "",
    "Conversation",
    "------------",
    conversation,
  ].join("\n");
}

module.exports = {
  formatTranscript,
};
