const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const config = require("./utils/config");
const logger = require("./utils/logger");
const { CallStore } = require("./utils/callStore");
const createCallRoutes = require("./routes/calls");
const createEmailService = require("./services/email");
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
  const handleMediaStream = createMediaStreamHandler({
    callStore,
    logger,
    openaiApiKey: config.openai.apiKey,
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
