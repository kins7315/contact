import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { HistoryService } from "../history/history.service";
import { ModelGatewayService } from "../model-gateway/model-gateway.service";

type GenerateInput = {
  userId: number;
  modelId?: string;
  sourcePath?: string;
  prompt: string;
  size: string;
  count: number;
};

const supportedSizes = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    private readonly modelGateway: ModelGatewayService,
    private readonly historyService: HistoryService
  ) {}

  async generate(input: GenerateInput) {
    if (!input.prompt) {
      throw new BadRequestException("请输入图片修改提示词");
    }

    if (!supportedSizes.has(input.size)) {
      throw new BadRequestException("图片尺寸参数不支持");
    }

    const count = Number.isFinite(input.count) ? Math.min(Math.max(input.count, 1), 4) : 1;

    mkdirSync("uploads/results", { recursive: true });

    try {
      const taskType = input.sourcePath ? "image_edit" : "text_to_image";

      // 获取可用的模型列表
      const models = await this.modelGateway.listModels();
      const imageModels = models.filter(
        (m) =>
          m.enabled &&
          m.taskTypes.includes(taskType)
      );

      if (imageModels.length === 0) {
        throw new NotFoundException("没有可用的图片生成模型");
      }

      const selectedModel = input.modelId
        ? imageModels.find((model) => model.id === input.modelId)
        : imageModels[0];

      if (!selectedModel) {
        throw new BadRequestException("当前选择的模型不能用于图片生成");
      }

      const provider = await this.modelGateway.listProviders().then((ps) =>
        ps.find((p) => p.id === selectedModel.providerId)
      );

      if (!provider) {
        throw new InternalServerErrorException("模型所属的提供商不存在");
      }

      // 构建模型调用参数
      const sourceUrl = input.sourcePath ? `/uploads/sources/${basename(input.sourcePath)}` : "";
      const files = sourceUrl ? [sourceUrl] : [];

      let result;
      try {
        result = await this.modelGateway.invokeModel({
          modelId: selectedModel.id,
          taskType,
          input: { prompt: input.prompt },
          parameters: {
            size: input.size === "auto" ? "1024x1024" : input.size,
            n: count
          },
          files
        });
      } catch (gatewayError) {
        this.logger.error("Model Gateway 调用失败", this.formatError(gatewayError));
        throw new InternalServerErrorException(
          gatewayError instanceof Error ? gatewayError.message : "图片生成服务暂时不可用"
        );
      }

      if (result.response.status === "failed") {
        throw new InternalServerErrorException(
          result.response.error?.message || "图片生成失败"
        );
      }

      // 处理返回的资产 URL
      const results = await Promise.all(
        (result.response.assetUrls.length > 0
          ? result.response.assetUrls.slice(0, count)
          : []
        ).map(async (assetUrl) => {
          // 这里可以选择是否下载并保存图片，或者直接使用返回的 URL
          // 为了简单起见，我们直接保存资产 URL
          let resultUrl = assetUrl;

          // 如果返回的是 base64 数据（取决于模型响应格式），我们可以保存到本地
          // 但这里我们假设返回的是直接可用的 URL
          if (!resultUrl) {
            throw new InternalServerErrorException("图像接口未返回图片数据");
          }

          return { url: resultUrl };
        })
      );

      if (results.length > 0) {
        const history = await this.historyService.createImageHistory({
          userId: input.userId,
          modelId: selectedModel.id,
          modelName: selectedModel.displayName,
          taskType,
          sourceUrl,
          prompt: input.prompt,
          resultUrls: results.map((item) => item.url)
        });

        return {
          historyId: history.id,
          results
        };
      }

      // 如果没有返回资产 URL，检查是否有输出文本包含 URL 或者其他格式
      if (results.length === 0) {
        // 尝试从原始响应中提取 URL（这取决于具体模型的响应格式）
        const rawResponse = result.response.rawResponse as any;
        if (rawResponse && Array.isArray(rawResponse.data)) {
          const additionalResults = (
            await Promise.all(
            rawResponse.data.slice(0, count).map(async (item: any) => {
              let resultUrl = "";
              if (item.url) {
                resultUrl = item.url;
              } else if (item.b64_json) {
                const filename = `${uuidv4()}.png`;
                const resultPath = join("uploads/results", filename);
                writeFileSync(resultPath, Buffer.from(item.b64_json, "base64"));
                resultUrl = `/uploads/results/${filename}`;
              }

              if (!resultUrl) {
                return null;
              }

              return { url: resultUrl };
            })
            )
          ).filter((item): item is { url: string } => item !== null);

          if (additionalResults.length > 0) {
            const history = await this.historyService.createImageHistory({
              userId: input.userId,
              modelId: selectedModel.id,
              modelName: selectedModel.displayName,
              taskType,
              sourceUrl,
              prompt: input.prompt,
              resultUrls: additionalResults.map((item) => item.url)
            });

            return {
              historyId: history.id,
              results: additionalResults
            };
          }
        }

        throw new InternalServerErrorException("图像接口未返回图片数据");
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      this.logger.error("Image generation failed", this.formatError(error));
      throw new InternalServerErrorException(this.getErrorMessage(error));
    }
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) {
      const cause = this.getCauseMessage(error);
      return cause ? `${error.message}: ${cause}` : error.message;
    }

    if (typeof error === "object" && error && "message" in error) {
      return String(error.message);
    }

    return "图片生成失败";
  }

  private getCauseMessage(error: Error) {
    const cause = (error as Error & { cause?: unknown }).cause;

    if (cause instanceof Error) {
      return cause.message;
    }

    if (typeof cause === "object" && cause && "message" in cause) {
      return String(cause.message);
    }

    return "";
  }

  private formatError(error: unknown) {
    if (typeof error !== "object" || !error) {
      return String(error);
    }

    const detail = error as {
      message?: unknown;
      status?: unknown;
      code?: unknown;
      type?: unknown;
      request_id?: unknown;
      error?: unknown;
      cause?: unknown;
      stack?: unknown;
    };

    return JSON.stringify(
      {
        message: detail.message,
        status: detail.status,
        code: detail.code,
        type: detail.type,
        request_id: detail.request_id,
        error: detail.error,
        cause: detail.cause,
        stack: detail.stack
      },
      null,
      2
    );
  }
}
