const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const config = require("./utils/config");
const logger = require("./utils/logger");
const { CallStore } = require("./utils/callStore");
const createCallRoutes = require("./routes/calls");
const createEmailService = require("./services/email");
const createWeatherService = require("./services/weather");
const createTimeService = require("./services/time");
const createSportsService = require("./services/sports");
const createFlightsService = require("./services/flights");
const createStocksService = require("./services/stocks");
const createMediaStreamHandler = require("./handlers/mediaStream");

function buildServer() {
  const app = express();
  const callStore = new CallStore();
  const services = {
    email: createEmailService({
      emailConfig: config.email,
      logger,
    }),
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
  const timeService = createTimeService();
  const sportsService = createSportsService(config.apiFootball.apiKey, logger);
  const flightsService = createFlightsService(config.aviationstack.apiKey, logger);
  const stocksService = createStocksService(config.alphavantage.apiKey, logger);
  const handleMediaStream = createMediaStreamHandler({
    callStore,
    logger,
    openaiApiKey: config.openai.apiKey,
    weatherService,
    timeService,
    sportsService,
    flightsService,
    stocksService,
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
