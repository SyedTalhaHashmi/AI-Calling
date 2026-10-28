/**
 * Scripted latency baseline: plays pre-rendered caller WAVs into the local /media-stream
 * exactly like Twilio would (μ-law 8 kHz, 20 ms frames, continuous silence between turns).
 * Local callSids never reach Twilio/platform, so no billing, SMS, or transcript email.
 *
 * Usage:
 *   pwsh dev/latencyTts.ps1 -OutDir <wavDir>
 *   node server.js > server.log            (separate terminal; LATENCY_METRICS on)
 *   node dev/latencyRun.js --audio <wavDir> [--url ws://localhost:3000/media-stream] [--per-call 8] [--out results.json]
 *   node dev/latencyReport.js server.log
 *
 * Uses the real OpenAI Realtime session and the configured data APIs (normal per-request usage).
 */
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const alawmulaw = require("alawmulaw");

const FRAME_SAMPLES = 160; // 20 ms @ 8 kHz
const FRAME_MS = 20;
const MULAW_SILENCE = 0xff;
const REPLY_TIMEOUT_MS = 15000;
const NO_REPLY_EXPECTED_WAIT_MS = 6000;
const AFTER_PLAYBACK_GAP_MS = 1000;
/** Reply is over after this much outbound silence (tools mode pauses between acknowledgement and answer). */
const DEFAULT_QUIET_MS = 3500;

function parseArgs(argv) {
  const args = {
    url: "ws://localhost:3000/media-stream",
    perCall: 8,
    out: null,
    audio: null,
    quietMs: DEFAULT_QUIET_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i];
    else if (a === "--quiet-ms") args.quietMs = Number(argv[++i]);
    else if (a === "--per-call") args.perCall = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--audio") args.audio = argv[++i];
    else if (a === "--prompts") args.prompts = argv[++i];
  }
  args.prompts =
    args.prompts || path.join(__dirname, "..", "test", "fixtures", "latencyPrompts.json");
  if (!args.audio) throw new Error("--audio <dir of WAVs from dev/latencyTts.ps1> is required");
  return args;
}

/** 16-bit mono 8 kHz PCM WAV → μ-law bytes. */
function readWavAsMulaw(file) {
  const buf = fs.readFileSync(file);
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + size);
    if (id === "fmt ") {
      fmt = {
        channels: body.readUInt16LE(2),
        rate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
    } else if (id === "data") {
      data = body;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file}: not a PCM WAV`);
  if (fmt.channels !== 1 || fmt.rate !== 8000 || fmt.bits !== 16) {
    throw new Error(`${file}: expected 8 kHz 16-bit mono, got ${JSON.stringify(fmt)}`);
  }
  const pcm = new Int16Array(data.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = data.readInt16LE(i * 2);
  return Buffer.from(alawmulaw.mulaw.encode(pcm));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** One fake Twilio call: continuous 20 ms frames, speech queued on demand. */
function openCall(url, label) {
  const callSid = `CAlatency${label}${Date.now().toString(36)}`;
  const streamSid = `MZlatency${Date.now().toString(36)}`;
  const ws = new WebSocket(url);
  const silence = Buffer.alloc(FRAME_SAMPLES, MULAW_SILENCE);
  const state = {
    callSid,
    queue: [],
    onQueueDrained: null,
    lastSpeechFrameAt: null,
    firstOutboundAfter: null,
    outboundBytes: 0,
    firstOutboundAt: null,
    lastOutboundAt: null,
    /** Only count agent audio once the current prompt has finished (ignore late audio from earlier turns). */
    listening: true,
  };
  let timer = null;
  let seq = 0;
  let nextAt = 0;

  function sendFrame(payload) {
    seq += 1;
    ws.send(
      JSON.stringify({
        event: "media",
        streamSid,
        sequenceNumber: String(seq),
        media: { track: "inbound", chunk: String(seq), timestamp: String(seq * FRAME_MS), payload: payload.toString("base64") },
      })
    );
  }

  function tick() {
    const now = Date.now();
    while (nextAt <= now) {
      const frame = state.queue.shift();
      if (frame) {
        sendFrame(frame);
        if (!state.queue.length) {
          state.lastSpeechFrameAt = Date.now();
          state.listening = true;
          const cb = state.onQueueDrained;
          state.onQueueDrained = null;
          if (cb) cb();
        }
      } else {
        sendFrame(silence);
      }
      nextAt += FRAME_MS;
    }
  }

  const ready = new Promise((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
      ws.send(
        JSON.stringify({
          event: "start",
          sequenceNumber: "0",
          start: {
            streamSid,
            callSid,
            tracks: ["inbound"],
            mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
          },
          streamSid,
        })
      );
      nextAt = Date.now();
      timer = setInterval(tick, 5);
      resolve();
    });
    ws.on("error", reject);
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.event === "media" && msg.media?.payload && state.listening) {
      const now = Date.now();
      if (state.firstOutboundAt == null) state.firstOutboundAt = now;
      state.lastOutboundAt = now;
      state.outboundBytes += Buffer.from(msg.media.payload, "base64").length;
    }
  });

  return {
    state,
    ready,
    /** Queue speech; resolves when the last speech frame has been sent. */
    speak(mulaw) {
      state.listening = false;
      return new Promise((resolve) => {
        for (let i = 0; i < mulaw.length; i += FRAME_SAMPLES) {
          const frame = Buffer.alloc(FRAME_SAMPLES, MULAW_SILENCE);
          mulaw.copy(frame, 0, i, Math.min(i + FRAME_SAMPLES, mulaw.length));
          state.queue.push(frame);
        }
        state.onQueueDrained = resolve;
      });
    },
    resetOutbound() {
      state.outboundBytes = 0;
      state.firstOutboundAt = null;
      state.lastOutboundAt = null;
    },
    close() {
      clearInterval(timer);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "stop", streamSid, stop: { callSid } }));
        ws.close();
      }
    },
  };
}

/** Wait for first agent audio, then for its real-time playback to finish. */
async function waitForReply(call, timeoutMs, quietMs) {
  const start = Date.now();
  while (call.state.firstOutboundAt == null) {
    if (Date.now() - start > timeoutMs) return { gotAudio: false };
    await sleep(10);
  }
  // Server receives audio faster than real time; caller hears it at 8000 bytes/s.
  for (;;) {
    const playbackEnd = call.state.firstOutboundAt + (call.state.outboundBytes / 8000) * 1000;
    const quietFor = Date.now() - call.state.lastOutboundAt;
    if (quietFor > quietMs && Date.now() >= playbackEnd) break;
    await sleep(50);
  }
  return {
    gotAudio: true,
    firstAudioAt: call.state.firstOutboundAt,
    replyAudioMs: Math.round((call.state.outboundBytes / 8000) * 1000),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(fs.readFileSync(args.prompts, "utf8"));
  const prompts = fixture.prompts.filter(
    (p) => p.scripted !== false && fs.existsSync(path.join(args.audio, `${p.id}.wav`))
  );
  if (!prompts.length) throw new Error("No prompts with matching WAVs found");

  const results = [];
  for (let c = 0; c * args.perCall < prompts.length; c++) {
    const batch = prompts.slice(c * args.perCall, (c + 1) * args.perCall);
    const call = openCall(args.url, `c${c + 1}`);
    await call.ready;
    console.error(`call ${c + 1}: ${call.state.callSid} (${batch.length} prompts)`);

    const greeting = await waitForReply(call, REPLY_TIMEOUT_MS, args.quietMs);
    await sleep(AFTER_PLAYBACK_GAP_MS);

    for (const [i, p] of batch.entries()) {
      const mulaw = readWavAsMulaw(path.join(args.audio, `${p.id}.wav`));
      call.resetOutbound();
      await call.speak(mulaw);
      const speechEnd = call.state.lastSpeechFrameAt;
      const expectReply = p.category !== "hold";
      const reply = await waitForReply(
        call,
        expectReply ? REPLY_TIMEOUT_MS : NO_REPLY_EXPECTED_WAIT_MS,
        args.quietMs
      );
      const row = {
        callSid: call.state.callSid,
        turn: i + 1,
        id: p.id,
        category: p.category,
        speechMs: Math.round((mulaw.length / 8000) * 1000),
        gotAudio: reply.gotAudio,
        clientSpeechEndToFirstAudioMs: reply.gotAudio ? reply.firstAudioAt - speechEnd : null,
        replyAudioMs: reply.replyAudioMs ?? null,
        greetingGotAudio: i === 0 ? greeting.gotAudio : undefined,
      };
      results.push(row);
      console.error(
        `  ${p.id.padEnd(16)} ${row.gotAudio ? `${row.clientSpeechEndToFirstAudioMs} ms` : "no audio"}`
      );
      await sleep(AFTER_PLAYBACK_GAP_MS);
    }
    call.close();
    await sleep(1500);
  }

  const out = JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2);
  if (args.out) fs.writeFileSync(args.out, out);
  else console.log(out);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
