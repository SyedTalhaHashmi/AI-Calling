const express = require("express");
const path = require("path");
const config = require("./utils/config");
const logger = require("./utils/logger");
const { CallStore } = require("./utils/callStore");
const createCallRoutes = require("./routes/calls");
const createDeepgramService = require("./services/deepgram");
const createOpenAIService = require("./services/openai");
const createElevenLabsService = require("./services/elevenlabs");
const createEmailService = require("./services/email");
const createTwilioMediaService = require("./services/twilioMedia");

function buildServer() {
  const app = express();
  const callStore = new CallStore();

  const services = {
    deepgram: createDeepgramService({
      apiKey: config.deepgram.apiKey,
      model: config.deepgram.model,
      logger,
    }),
    openai: createOpenAIService({
      apiKey: config.openai.apiKey,
      model: config.openai.model,
      logger,
    }),
    elevenlabs: createElevenLabsService({
      apiKey: config.elevenlabs.apiKey,
      voiceId: config.elevenlabs.voiceId,
      modelId: config.elevenlabs.modelId,
      logger,
    }),
    email: createEmailService({
      emailConfig: config.email,
      logger,
    }),
    twilioMedia: createTwilioMediaService({
      accountSid: config.twilio.accountSid,
      authToken: config.twilio.authToken,
      logger,
    }),
  };

  app.set("trust proxy", true);
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use("/audio", express.static(path.join(process.cwd(), "server", "audio")));

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

  return app;
}

if (require.main === module) {
  const app = buildServer();
  app.listen(config.port, () => {
    logger.info({ port: config.port }, "AI phone assistant server is running");
  });
}

module.exports = buildServer;
