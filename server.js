const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const config = require("./utils/config");
const logger = require("./utils/logger");
const { CallStore } = require("./utils/callStore");
const createCallRoutes = require("./routes/calls");
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
  const weatherService = createWeatherService(config.openweather.apiKey, logger);
  const openMeteoService = createOpenMeteoService(config.openMeteo.enabled, logger);
  const timeService = createTimeService();
  const worldTimeService = createWorldTimeService(
    config.rapidApi.key,
    config.rapidApi.worldTimeHost,
    logger
  );
  const placesService = createPlacesService(config.googlePlaces.apiKey, logger);
  const travelService = createTravelService(config.travelpayouts.token, logger);
  const newsService = createNewsService(config.newsApi.apiKey, logger);
  const fxService = createFxService(config.frankfurter.enabled, logger);
  const sportsService = createSportsService(config.apiFootball.apiKey, logger);
  const flightsService = createFlightsService(config.aviationstack.apiKey, logger);
  const stocksService = createStocksService(config.alphavantage.apiKey, logger);
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
    twilioClient: twilioVoiceClient,
  });

  wss.on("connection", (ws, req) => {
    handleMediaStream(ws, req);
  });

  return server;
}

if (require.main === module) {
  const server = buildServer();
  server.listen(config.port, () => {
    logger.info(
      { port: config.port, streaming: true },
      "AI phone assistant server is running"
    );
  });
}

module.exports = buildServer;
