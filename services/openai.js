const OpenAI = require("openai");

function createOpenAIService({ apiKey, model, logger }) {
  const client = new OpenAI({ apiKey });

  async function generateReply(messages) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.6,
        max_tokens: 120,
      });

      const reply = completion.choices?.[0]?.message?.content?.trim();
      if (!reply) {
        throw new Error("Empty AI response");
      }

      return reply;
    } catch (error) {
      logger.error({ err: error.message }, "OpenAI response generation failed");
      throw new Error("OPENAI_FAILED");
    }
  }

  return {
    generateReply,
  };
}

module.exports = createOpenAIService;
