import { Controller, Get } from "@nestjs/common";
import OpenAI from "openai";

@Controller("config")
export class ConfigController {
  @Get("model")
  model() {
    return {
      model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2"
    };
  }

  @Get("status")
  status() {
    return {
      model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
      baseUrl: process.env.OPENAI_BASE_URL ?? "",
      hasApiKey: Boolean(process.env.OPENAI_API_KEY)
    };
  }

  @Get("connection")
  async connection() {
    try {
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL
      });
      const models = await client.models.list();

      return {
        ok: true,
        model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
        hasTargetModel: models.data.some((model) => model.id === (process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2"))
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "连接失败",
        cause: this.getCauseMessage(error)
      };
    }
  }

  private getCauseMessage(error: unknown) {
    if (!(error instanceof Error)) {
      return "";
    }

    const cause = (error as Error & { cause?: unknown }).cause;

    if (cause instanceof Error) {
      return cause.message;
    }

    if (typeof cause === "object" && cause && "message" in cause) {
      return String(cause.message);
    }

    return "";
  }
}
