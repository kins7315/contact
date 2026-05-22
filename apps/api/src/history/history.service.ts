import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ModelGatewayService } from "../model-gateway/model-gateway.service";
import { PrismaService } from "../prisma/prisma.service";

type CreateImageHistoryInput = {
  userId: number;
  modelId: string;
  modelName: string;
  taskType: string;
  prompt: string;
  sourceUrl: string;
  resultUrls: string[];
};

type CreateTextHistoryInput = {
  userId: number;
  modelId: string;
  prompt: string;
  parameters?: Record<string, unknown>;
};

@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelGateway: ModelGatewayService
  ) {}

  async list(userId: number) {
    const items = await this.prisma.generationHistory.findMany({
      where: { userId },
      include: { images: true },
      orderBy: { createdAt: "desc" },
      take: 60
    });

    return items.map((item) => ({
      id: item.id,
      modelId: item.modelId,
      modelName: item.modelName,
      taskType: item.taskType,
      prompt: item.prompt,
      sourceUrl: item.sourceUrl,
      textResult: item.textResult,
      imageCount: item.images.length,
      resultUrls: item.images.map((image) => image.resultUrl),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }));
  }

  async detail(userId: number, id: number) {
    const item = await this.prisma.generationHistory.findUnique({
      where: { id },
      include: {
        images: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!item) {
      throw new NotFoundException("历史记录不存在");
    }

    if (item.userId !== userId) {
      throw new ForbiddenException("不能查看其他用户的历史记录");
    }

    return {
      id: item.id,
      modelId: item.modelId,
      modelName: item.modelName,
      taskType: item.taskType,
      prompt: item.prompt,
      sourceUrl: item.sourceUrl,
      textResult: item.textResult,
      resultUrls: item.images.map((image) => image.resultUrl),
      images: item.images.map((image) => ({
        id: image.id,
        sourceUrl: image.sourceUrl,
        resultUrl: image.resultUrl,
        createdAt: image.createdAt.toISOString()
      })),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  async generateText(input: CreateTextHistoryInput) {
    const prompt = input.prompt.trim();

    if (!prompt) {
      throw new BadRequestException("请输入文本提示词");
    }

    const result = await this.modelGateway.invokeModel({
      modelId: input.modelId,
      taskType: "text_generation",
      input: { prompt },
      parameters: input.parameters ?? {}
    });
    const outputText = result.response.outputText ?? "";

    const history = await this.prisma.generationHistory.create({
      data: {
        userId: input.userId,
        modelId: result.model.id,
        modelName: result.model.displayName,
        taskType: "text_generation",
        prompt,
        textResult: outputText
      }
    });

    return {
      status: result.response.status,
      provider: result.response.provider,
      model: result.response.model,
      taskType: "text_generation",
      normalizedRequest: result.request,
      adapterRequest: result.adapterRequest,
      response: result.response,
      historyId: history.id
    };
  }

  async createImageHistory(input: CreateImageHistoryInput) {
    return this.prisma.generationHistory.create({
      data: {
        userId: input.userId,
        modelId: input.modelId,
        modelName: input.modelName,
        taskType: input.taskType,
        prompt: input.prompt,
        sourceUrl: input.sourceUrl,
        images: {
          create: input.resultUrls.map((resultUrl) => ({
            userId: input.userId,
            sourceUrl: input.sourceUrl,
            prompt: input.prompt,
            resultUrl
          }))
        }
      },
      include: { images: true }
    });
  }
}
