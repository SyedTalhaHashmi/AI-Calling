const http = require("http");
const path = require("path");
const express = require("express");
const WebSocket = require("ws");
const config = require("./utils/config");
const logger = require("./utils/logger");
const { CallStore } = require("./utils/callStore");
const createCallRoutes = require("./routes/calls");
const createPublicLandingTtsRoutes = require("./routes/publicLandingTts");
const createEmailService = require("./services/email");
const createWeatherService = require("./services/weather");
const createOpenMeteoService = require("./services/openMeteo");
const createTimeService = require("./services/time");
const createWorldTimeService = require("./services/worldTime");
const createPlacesService = require("./services/places");
const createTravelService = require("./services/travel");
const createNewsService = require("./services/news");
const createFxService = require("./services/fx");
const createSportsService = require("./services/sports");
const createFlightsService = require("./services/flights");
const createStocksService = require("./services/stocks");
const createWebSearchService = require("./services/webSearch");
const createPlatformApi = require("./services/platformApi");
const createMediaStreamHandler = require("./handlers/mediaStream");
const twilio = require("twilio");

function buildServer() {
  const app = express();
  const callStore = new CallStore();
  const twilioVoiceClient = twilio(
    config.twilio.accountSid,
    config.twilio.authToken
  );
  const services = {
    email: createEmailService({
      emailConfig: config.email,
      logger,
    }),
    platformApi: createPlatformApi(config, logger),
  };

  app.set("trust proxy", true);
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.status(200).json({ ok: true });
  });

  // Local-only mic tester (browser → same /media-stream as Twilio). Off unless ENABLE_MIC_TEST=true.
  if (config.micTestEnabled) {
    app.get("/dev/mic-test", (req, res) => {
      res.sendFile(path.join(__dirname, "dev", "mic-test.html"));
    });
    logger.info("Mic test page enabled at GET /dev/mic-test");
  }

  app.use(
    createPublicLandingTtsRoutes({
      config,
      logger,
    })
  );

  app.use(
    "/",
    createCallRoutes({
      logger,
      callStore,
      services,
      config,
    })
  );

  app.use((error, req, res, next) => {
    logger.error({ err: error.message }, "Unhandled server error");
    res.status(500).json({ error: "Internal server error" });
  });

  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, path: "/media-stream" });
  /** callSids with a live media stream (graceful shutdown). */
  const activeCalls = new Set();
  const weatherService = createWeatherService(config.openweather.apiKey, logger);
  const openMeteoService = createOpenMeteoService(config.openMeteo.enabled, logger);
  const timeService = createTimeService();
  const worldTimeService = createWorldTimeService(
    config.rapidApi.key,
    config.rapidApi.worldTimeHost,
    logger,
    { enabled: config.rapidApi.worldTimeEnabled }
  );
  const placesService = createPlacesService(config.googlePlaces.apiKey, logger);
  const travelService = createTravelService(config.travelpayouts.token, logger);
  const newsService = createNewsService(config.newsApi.apiKey, logger);
  const fxService = createFxService(config.frankfurter.enabled, logger);
  const sportsService = createSportsService(config.apiFootball.apiKey, logger);
  const flightsService = createFlightsService(config.aviationstack.apiKey, logger);
  const stocksService = createStocksService(config.alphavantage.apiKey, logger);
  const webSearchService = createWebSearchService({
    exaApiKey: config.webSearch.exaApiKey,
    tavilyApiKey: config.webSearch.tavilyApiKey,
    enabled: config.webSearch.enabled,
    dailyLimit: config.webSearch.dailyLimit,
    tavilyDailyLimit: config.webSearch.tavilyDailyLimit,
    logger,
  });
  const handleMediaStream = createMediaStreamHandler({
    callStore,
    logger,
    openaiApiKey: config.openai.apiKey,
    weatherService,
    openMeteoService,
    timeService,
    worldTimeService,
    placesService,
    travelService,
    newsService,
    fxService,
    sportsService,
    flightsService,
    stocksService,
    webSearchService,
    twilioClient: twilioVoiceClient,
    latencyMetricsEnabled: config.latencyMetricsEnabled,
    routerMode: config.routerMode,
    toolDeadlineMs: config.toolDeadlineMs,
    realtime: config.realtime,
    activeCalls,
  });

  wss.on("connection", (ws, req) => {
    handleMediaStream(ws, req);
  });

  server.activeCalls = activeCalls;
  return server;
}

/**
 * Redeploys: let live calls finish (up to SHUTDOWN_GRACE_SECONDS), then exit. HTTP stays open
 * meanwhile so each call's /call-status request (transcript email, usage sync) still arrives.
 * The host's own stop timeout must be at least this long for calls to finish.
 */
function shutdownGracefully(server, signal) {
  const pending = server.activeCalls?.size || 0;
  logger.info({ signal, activeCalls: pending, graceSeconds: config.shutdownGraceSeconds }, "Shutting down");
  const deadline = Date.now() + config.shutdownGraceSeconds * 1000;
  let idleSince = pending ? 0 : Date.now();
  const timer = setInterval(() => {
    const left = server.activeCalls?.size || 0;
    if (left) idleSince = 0;
    else if (!idleSince) idleSince = Date.now();
    // Idle for 3 s: the last call's status request has had time to arrive
    const done = !left && Date.now() - idleSince >= 3000;
    if (done || Date.now() >= deadline) {
      clearInterval(timer);
      logger.info({ activeCalls: left }, left ? "Shutdown: grace period over" : "Shutdown: all calls finished");
      process.exit(0);
    }
  }, 500);
}

if (require.main === module) {
  const server = buildServer();
  server.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        streaming: true,
        routerMode: config.routerMode,
        realtimeModel: config.realtime.model || "gpt-realtime",
        transcribeModel: config.realtime.transcribeModel || "gpt-transcribe",
      },
      "AI phone assistant server is running"
    );
  });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => shutdownGracefully(server, signal));
  }
}

module.exports = buildServer;
