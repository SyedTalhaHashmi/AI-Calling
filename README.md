# AI Phone Assistant (Streaming)

Low-latency AI phone assistant using **streaming** for natural conversations (~500–800 ms response time):

- Caller dials a Twilio number
- Twilio opens a **WebSocket** media stream to your server
- Audio streams live: Twilio (μ-law 8kHz) ↔ Node.js ↔ **OpenAI Realtime API**
- No recordings, no Deepgram, no ElevenLabs — Realtime API handles STT + AI + TTS
- When the call ends, a full transcript is emailed

## System Architecture

```
Caller
  → Twilio Phone Number
  → Webhook POST /incoming-call (TwiML with Connect/Stream)
  → Twilio WebSocket to wss://YOUR_URL/media-stream
  → Node.js bridge
  → OpenAI Realtime API (gpt-realtime)
  → Audio streamed back to caller
  → Call ends → Transcript emailed
```

## Project Structure

```text
.
|-- handlers/
|   `-- mediaStream.js       # Twilio ↔ OpenAI bridge
|-- routes/
|   `-- calls.js
|-- services/
|   |-- audioConvert.js      # μ-law 8k ↔ PCM 24k
|   |-- email.js
|-- utils/
|   |-- callStore.js
|   |-- config.js
|   |-- logger.js
|   |-- transcript.js
|-- .env.example
|-- package.json
|-- README.md
`-- server.js
```

## Call Flow (Streaming)

1. Twilio sends `POST /incoming-call`
2. Server returns TwiML: `<Connect><Stream url="wss://.../media-stream"/></Connect>`
3. Twilio opens WebSocket to `/media-stream`
4. Server connects to OpenAI Realtime API
5. Caller speaks → Twilio sends μ-law 8kHz → Server converts to PCM 24kHz → OpenAI
6. OpenAI Realtime responds with audio → Server converts to μ-law 8kHz → Twilio plays
7. Conversation continues with ~500–800 ms latency
8. Call ends → Twilio sends `POST /call-status` → Transcript emailed

## Requirements

- Node.js 18+ (20+ recommended)
- Twilio account + phone number
- OpenAI API key (for Realtime API)
- Email transport (SMTP or sendmail)

## Environment Variables

Copy `.env.example` to `.env`:

```bash
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
OPENAI_API_KEY=
EMAIL_FROM=
EMAIL_TO=
PUBLIC_BASE_URL=             # e.g. https://calling.bizaffix.com (required for Stream URL)
PORT=3000
```

Optional:

```bash
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
LOG_LEVEL=info
```

## Setup Instructions

1. Install dependencies

```bash
npm install
```

2. Configure environment variables

- Create `.env` from `.env.example`
- Fill all required values

3. Start the server

```bash
npm start
```

Health check:

```bash
GET http://localhost:3000/health
```

## Twilio Configuration

In your Twilio phone number config:

1. **A Call Comes In (Voice webhook)**
   - Method: `POST`
   - URL: `https://<your-public-url>/incoming-call`

2. **Status Callback**
   - Method: `POST`
   - URL: `https://<your-public-url>/call-status`
   - Events: include `completed` (and optionally other terminal states)

Without status callback, transcript email on call end will not trigger reliably.

## Run Locally with a tunnel

Your server must be reachable via HTTPS so Twilio can send webhooks. Two options:

### Option A: Cloudflare Tunnel (recommended for free tier – no interstitial)

Cloudflare Quick Tunnels do **not** show a "Visit Site" warning page, so Twilio receives your TwiML correctly.

1. **Install cloudflared** (one-time):
   - Windows: download [cloudflared for Windows](https://github.com/cloudflare/cloudflared/releases) (e.g. `cloudflared-windows-amd64.exe`), rename to `cloudflared.exe`, and put it in your PATH or project folder.
   - Or with winget: `winget install Cloudflare.cloudflared`
2. **Start your server**: `npm start` (port 3000).
3. **In a second terminal**, run:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
4. Copy the **HTTPS URL** shown (e.g. `https://random-words.trycloudflare.com`).
5. In Twilio Voice Configuration set:
   - **A call comes in:** `https://YOUR-CLOUDFLARE-URL/incoming-call` (POST)
   - **Call status changes:** `https://YOUR-CLOUDFLARE-URL/call-status` (POST)
6. In `.env` set `PUBLIC_BASE_URL=https://YOUR-CLOUDFLARE-URL` and restart the server. **Required:** Twilio needs this to build the WebSocket Stream URL (`wss://.../media-stream`).

### Option B: ngrok

```bash
ngrok http 3000
```

Set Twilio webhook URLs to the ngrok HTTPS URL:

- `https://<ngrok-id>.ngrok-free.app/incoming-call`
- `https://<ngrok-id>.ngrok-free.app/call-status`

**Free ngrok warning:** On the free plan, ngrok shows an interstitial page ("You are about to visit...") for some requests. When **Twilio** requests your URL, it may receive that HTML instead of your app's TwiML, so you hear the trial message and never see "Call started". Fix: use **Cloudflare Tunnel** (Option A) or upgrade to a **paid ngrok** plan.

## Deployment & custom domain

You can host the app on a cloud provider and attach your own domain so Twilio always has a stable HTTPS URL (no tunnels, no interstitial pages).

### Option 1: Railway (recommended)

[Railway](https://railway.app) offers a simple Node.js deploy with a free tier and custom domains.

1. **Push your code** to GitHub (ensure `.env` is not committed; use `.gitignore`).
2. Go to [railway.app](https://railway.app) → **Start a New Project** → **Deploy from GitHub** and select your repo.
3. **Set environment variables** in Railway’s dashboard: add every variable from your `.env` (e.g. `TWILIO_ACCOUNT_SID`, `OPENAI_API_KEY`, etc.). Do **not** commit `.env`.
4. **Set the public URL:** In the service → **Settings** → **Networking** → **Generate Domain**. Railway gives you a URL like `https://your-app.up.railway.app`.
5. **Custom domain (optional):** In the same **Networking** section, click **Custom Domain** and add your domain (e.g. `voice.yourdomain.com`). Point your DNS to the value Railway shows (CNAME or A record). Railway provisions HTTPS automatically.
6. **Set `PUBLIC_BASE_URL`** in Railway’s env vars to your live URL:
   - With Railway domain: `PUBLIC_BASE_URL=https://your-app.up.railway.app`
   - With custom domain: `PUBLIC_BASE_URL=https://voice.yourdomain.com`
7. In **Twilio** → your number → **Voice Configuration**, set:
   - **A call comes in:** `https://YOUR-LIVE-URL/incoming-call` (POST)
   - **Call status changes:** `https://YOUR-LIVE-URL/call-status` (POST)

Railway runs `npm start` by default and uses the `PORT` they provide (set automatically).

### Option 2: Render

[Render](https://render.com) provides free-tier web services and custom domains.

1. Push code to GitHub.
2. **New** → **Web Service** → connect the repo.
3. **Build command:** `npm install`
4. **Start command:** `npm start`
5. Add all env vars from `.env` in **Environment**.
6. Deploy; Render assigns a URL like `https://your-app.onrender.com`.
7. **Custom domain:** **Settings** → **Custom Domain** → add your domain and configure DNS as shown.
8. Set `PUBLIC_BASE_URL` to your Render URL (or custom domain) and update Twilio webhooks as above.

### Option 3: Fly.io

[Fly.io](https://fly.io) runs your app in a lightweight VM with a global edge; free tier available.

1. Install [flyctl](https://fly.io/docs/hands-on/install-flyctl/) and run `fly auth login`.
2. In the project folder: `fly launch` (choose a region, do not add a Postgres/Redis for this MVP).
3. Set secrets: `fly secrets set TWILIO_ACCOUNT_SID=xxx OPENAI_API_KEY=xxx ...` (all vars from `.env`). Set `PUBLIC_BASE_URL=https://your-app.fly.dev` (or your custom domain).
4. Deploy: `fly deploy`.
5. **Custom domain:** `fly certs add voice.yourdomain.com` and point DNS to the instructed A/AAAA records.
6. Update Twilio webhooks to `https://your-app.fly.dev/incoming-call` and `.../call-status` (or your custom domain).

### Option 4: Cloudflare (domain + proxy or tunnel)

Cloudflare doesn’t run your Node app for you, but you can use it for your **domain**, **HTTPS**, and **traffic in front of** wherever the app runs.

**A) Cloudflare in front of Railway/Render (easiest)**

1. Deploy the app on **Railway** or **Render** and get their URL (e.g. `https://your-app.up.railway.app`).
2. Add your **domain** to [Cloudflare](https://dash.cloudflare.com) (DNS only or proxied).
3. In **Cloudflare DNS**, add a CNAME:
   - **Name:** `voice` (or `api`, or `@` for root)
   - **Target:** `your-app.up.railway.app` (or your Render URL)
   - **Proxy status:** Proxied (orange cloud) for DDoS protection and HTTPS, or DNS only if you prefer.
4. Set `PUBLIC_BASE_URL=https://voice.yourdomain.com` in Railway/Render env vars.
5. In Twilio, set Voice webhooks to `https://voice.yourdomain.com/incoming-call` and `https://voice.yourdomain.com/call-status`.

Your app still runs on Railway/Render; Cloudflare is the public face and handles DNS/HTTPS.

**B) Cloudflare Tunnel with your own domain (self‑hosted app)**

Use this if you run the Node app yourself (e.g. on a VPS or home server) and want a stable URL and HTTPS via Cloudflare.

1. **Run the app** on a server (e.g. Ubuntu VPS): `npm start` and set all env vars, including `PUBLIC_BASE_URL=https://voice.yourdomain.com`.
2. **Install cloudflared** on the same machine: [install guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/download-and-install/).
3. In [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → **Networks** → **Tunnels** → **Create a tunnel** → choose **Cloudflared** and name it (e.g. `voice-app`). Copy the tunnel token.
4. On the server, run the tunnel (e.g. as a service):
   ```bash
   cloudflared service install <TUNNEL_TOKEN>
   ```
   Or run once: `cloudflared tunnel run --token <TUNNEL_TOKEN>`.
5. In the tunnel’s **Public Hostname** settings, add:
   - **Subdomain:** `voice` (or whatever you want)
   - **Domain:** your domain (e.g. `yourdomain.com`)
   - **Service:** `http://localhost:3000`
6. Point your domain’s DNS to Cloudflare (nameservers or CNAME as shown in the dashboard). Cloudflare will terminate HTTPS and send traffic through the tunnel to your app.
7. Set Twilio webhooks to `https://voice.yourdomain.com/incoming-call` and `.../call-status`.

**Local dev reminder:** For quick local testing we recommended **Cloudflare Quick Tunnel** (`cloudflared tunnel --url http://localhost:3000`) so Twilio gets TwiML without the ngrok interstitial. That’s separate from hosting; for production you use one of the options above (A or B).

### After deploying

- **Health check:** Open `https://YOUR-LIVE-URL/health` — should return `{"ok":true}`.
- **Twilio:** Ensure both Voice URLs use `https://` and include `/incoming-call` and `/call-status`. No tunnel needed; your domain is always reachable.
- **Email:** Use real SMTP settings in production (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, etc.) so transcripts deliver reliably.

## Testing Guide

### Step 1: Start your server

```bash
npm start
```

Leave this running. You should see: `AI phone assistant server is running`.

### Step 2: Expose your server with ngrok

In a **second terminal**:

```bash
ngrok http 3000
```

Copy the **HTTPS** URL ngrok shows (e.g. `https://a1b2c3d4.ngrok-free.app`). You will use this as `YOUR_NGROK_URL` below.

### Step 3: Configure your Twilio number (Voice only)

1. Go to [Twilio Console → Phone Numbers → Manage → Active Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming).
2. Click your number: **+1 833 958 6327**.
3. Scroll to **Voice Configuration**.
4. Under **A call comes in**:
   - Choose **Webhook**.
   - **URL:** `https://YOUR_NGROK_URL/incoming-call`
   - Method: **HTTP POST**.
5. Under **Call status changes**:
   - **URL:** `https://YOUR_NGROK_URL/call-status`
   - Method: **HTTP POST**.
6. Click **Save configuration**.

You only need **Voice**; SMS/MMS/WhatsApp can stay as-is or unset.

### Step 4: Set PUBLIC_BASE_URL (so Twilio can play audio)

In your `.env` add (replace with your real ngrok URL):

```env
PUBLIC_BASE_URL=https://YOUR_NGROK_URL
```

Restart the server (`Ctrl+C`, then `npm start`) so it picks up the new value.

### Step 5: Call and test

1. From **any phone** (e.g. your Ufone number), dial **+1 833 958 6327** (or 833-958-6327 in the US).
2. You should hear: *"Hello, you are speaking with an AI assistant. Ask me anything."*
3. After the tone (or short pause), **speak clearly**, e.g. *"What is Bitcoin?"* or *"Tell me a short joke."*
4. Wait for the AI to respond with voice.
5. You can ask a few more questions, then hang up.
6. Check the terminal for logs: `Call started`, `Transcription result`, `AI response generated`, `Call ended`.
7. Check the inbox for **EMAIL_TO** for the email with subject **AI Call Transcript**.

### Trial account: “Call blocked” or no ring

On a **Trial** account, Twilio only forwards **incoming** calls to your app if the **caller's** number is **verified**. If it isn't, Twilio plays a message like "You have a trial account…" and **never** sends a request to your `/incoming-call` URL (so you won't see "Call started" in logs).

**Fix: verify the number you call FROM**

1. Open [Twilio Console → Phone Numbers → Verified Caller IDs](https://console.twilio.com/us1/develop/phone-numbers/manage/verified).
2. Click **Add a new Caller ID**.
3. Enter the phone number you use to call your Twilio number (e.g. your Ufone in E.164 like `+92XXXXXXXXXX`, or the "From" number in Call Logs, e.g. `+16614226105`).
4. Complete verification (SMS or call with the code).
5. Call your Twilio number again. You should see **"Call started"** in the server log and hear your AI greeting.

To remove this restriction entirely, upgrade to a [paid Twilio account](https://www.twilio.com/pricing).

### Quick check: is the webhook reachable?

- Browser: open `https://YOUR_NGROK_URL/health` — you should see `{"ok":true}`.
- Open `https://YOUR_NGROK_URL/incoming-call` in your browser — you should see XML (TwiML) and, if Twilio’s “Try it” runs it, hear “This is your AI assistant. Webhook is working.”
- When you **call** the number, the **server terminal** must show a log line like `Call started`. If you see nothing when you call, Twilio is not hitting your app.

### “You can call for development” / wrong message when calling

That message is **Twilio’s default**, not our app. It usually means Twilio is **not** getting valid TwiML from your server. Check:

1. **Voice URL in Twilio**  
   In [Phone Numbers → your number → Configure](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming), under **Voice** → **A call comes in**, the URL must be:
   - `https://YOUR_NGROK_URL/incoming-call`  
   and **must not** be `https://demo.twilio.com/...` or anything else. Method: **HTTP POST**.

2. **Same URL as ngrok**  
   The host must match exactly what ngrok shows (e.g. `https://20c1-205-164-151-108.ngrok-free.app`). If you restarted ngrok, the URL changes — update Twilio again.

3. **Server logs when you call**  
   When you dial the number, the terminal where `npm start` is running should immediately log something like:  
   `"Call started"` with `callSid` and `from`.  
   - If you **see** that log: our app is answering; any wrong message is likely from a later step (e.g. playback).  
   - If you **don’t** see it: Twilio is not reaching our app (wrong URL or server/ngrok down).

4. **No 500 from our app**  
   If our app crashes (e.g. missing env), Twilio may fall back to the default message. The app now returns TwiML even on errors; restart the server and try again.

## Logging

Structured logs include:

- Call start
- Transcription result
- AI response generation
- Audio generation
- Call status updates
- Email success/failure
- Session cleanup

## Error Handling Strategy

The app returns polite fallbacks on failures:

- Transcription/silence:  
  `"Sorry, I didn't catch that. Could you repeat?"`
- OpenAI/ElevenLabs/general failure:  
  `"Sorry, I'm having trouble answering right now."`

This keeps the call usable even when external APIs are unstable.

## Troubleshooting

### No audio response

- Verify `PUBLIC_BASE_URL` is reachable from Twilio
- Check Twilio can access `/audio/<file>.mp3`
- Check ElevenLabs API key and quota
- Inspect server logs for `TTS_FAILED`

### Transcription not working

- Confirm Deepgram API key is valid
- Ensure Twilio recording URL is accessible with Twilio auth
- Check logs for download or Deepgram failures
- Speak clearly and avoid long pauses

### API timeout or delayed responses

- Check network connectivity to all providers
- Confirm keys are valid and not rate-limited
- Retry call with shorter user prompts
- Lower model complexity (if changing models)

### Email not delivered

- Verify `EMAIL_FROM` and `EMAIL_TO`
- Configure SMTP variables for reliable delivery
- If using sendmail fallback, verify local sendmail is installed
- Check logs for transcript email errors

## Future Improvements (Not Implemented in MVP)

The current architecture is intentionally simple and can evolve into:

- Real-time streaming conversation (WebSocket media streaming)
- Lower latency pipelines and partial response streaming
- Multi-language STT/TTS and language detection
- Voice switching and per-caller personalization
- Horizontal scaling with shared session store + queue workers

These are intentionally deferred for this prototype.
