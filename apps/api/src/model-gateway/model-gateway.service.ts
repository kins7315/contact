import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import type {
  AdapterType,
  ModelProvider,
  ModelTaskType,
  UnifiedModelRequest,
  UnifiedModelResponse
} from "../types";
import { PrismaService } from "../prisma/prisma.service";

function parseJson<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringFromConfig(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberFromConfig(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanFromConfig(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const officialAdapterTypes: AdapterType[] = ["openai_compatible", "official_seedance"];

type GatewayInvokeInput = {
  modelId: string;
  taskType: string;
  input: unknown;
  parameters?: Record<string, unknown>;
  files?: string[];
  skillContext?: Record<string, unknown>;
  workflowContext?: Record<string, unknown>;
  userContext?: Record<string, unknown>;
};

type AdapterPayload = {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  multipartFiles?: Array<{
    fieldName: string;
    path: string;
  }>;
  timeoutMs: number;
};

type LoadedModelDefinition = {
  id: string;
  providerId: string;
  displayName: string;
  upstreamModelName: string;
  taskTypesJson: string;
  contextWindow: number | null;
  parameterSchemaJson: string;
  enabled: boolean;
  provider: {
    adapterType: string;
    baseUrl: string;
    authType: string;
    defaultChannel: string | null;
    defaultBackend: string | null;
    configJson: string;
    enabled: boolean;
  };
};

@Injectable()
export class ModelGatewayService {
  constructor(private readonly prisma: PrismaService) {}

  listAdapterTypes() {
    return officialAdapterTypes;
  }

  async listProviders(): Promise<ModelProvider[]> {
    const providers = await this.prisma.provider.findMany({
      orderBy: { createdAt: "asc" }
    });

    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      adapterType: provider.adapterType as ModelProvider["adapterType"],
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
      defaultModel: provider.defaultModel ?? undefined,
      defaultChannel: provider.defaultChannel ?? undefined,
      defaultBackend: provider.defaultBackend ?? undefined,
      supportsHealthCheck: provider.supportsHealthCheck,
      supportsUsageSync: provider.supportsUsageSync
    }));
  }

  async listModels() {
    const models = await this.prisma.modelDefinition.findMany({
      include: { provider: true },
      orderBy: { createdAt: "asc" }
    });

    return models.map((model) => ({
      id: model.id,
      providerId: model.providerId,
      providerName: model.provider.name,
      displayName: model.displayName,
      upstreamModelName: model.upstreamModelName,
      taskTypes: parseJson<string[]>(model.taskTypesJson, []),
      contextWindow: model.contextWindow,
      parameterSchema: parseJson<Record<string, unknown>>(model.parameterSchemaJson, {}),
      enabled: model.enabled
    }));
  }

  async createInvocationPreview(request: UnifiedModelRequest) {
    const result = await this.invokeModel({
      modelId: request.modelId,
      taskType: request.taskType,
      input: request.input,
      parameters: request.parameters,
      files: request.files,
      skillContext: request.skillContext,
      workflowContext: request.workflowContext,
      userContext: request.userContext
    });

    return {
      status: result.response.status,
      provider: result.response.provider,
      model: result.response.model,
      taskType: request.taskType,
      normalizedRequest: request,
      adapterRequest: result.adapterRequest,
      response: result.response
    };
  }

  async invokeModel(input: GatewayInvokeInput) {
    const model = await this.prisma.modelDefinition.findUnique({
      where: { id: input.modelId },
      include: { provider: true }
    });

    if (!model || !model.enabled) {
      throw new NotFoundException("模型不存在或未启用");
    }

    if (!model.provider.enabled) {
      throw new BadRequestException("模型所属 Provider 未启用");
    }

    const invocationPlan = await this.buildInvocationPlan(input, model as unknown as LoadedModelDefinition);
    const { request, adapterRequest, providerConfig, taskType, parameters } = invocationPlan;
    const liveCallsEnabled = booleanFromConfig(providerConfig.enableLiveCalls, false);
    const response = liveCallsEnabled
      ? await this.executeWithRetryAndFallback({
          input,
          primary: {
            model: model as unknown as LoadedModelDefinition,
            request,
            adapterRequest,
            providerConfig,
            taskType,
            parameters
          }
        })
      : buildDryRunResponse({
          taskType,
          modelName: model.displayName,
          modelId: model.id,
          providerId: model.providerId,
          adapterType: model.provider.adapterType as AdapterType,
          upstreamModelName: model.upstreamModelName,
          adapterRequest,
          contextWindow: model.contextWindow
        });

    return {
      request,
      adapterRequest: redactAdapterPayload(adapterRequest),
      response,
      model: {
        id: model.id,
        providerId: model.providerId,
        displayName: model.displayName,
        upstreamModelName: model.upstreamModelName
      }
    };
  }

  private async buildInvocationPlan(input: GatewayInvokeInput, model: LoadedModelDefinition) {
    if (!model.provider.enabled) {
      throw new BadRequestException("模型所属 Provider 未启用");
    }

    const taskTypes = parseJson<string[]>(model.taskTypesJson, []);
    const taskType = normalizeTaskType(input.taskType, taskTypes);
    const parameterSchema = parseJson<Record<string, unknown>>(model.parameterSchemaJson, {});
    const parameters = validateParameters(input.parameters ?? {}, parameterSchema);
    const providerConfig = parseJson<Record<string, unknown>>(model.provider.configJson, {});
    const request: UnifiedModelRequest = {
      providerId: model.providerId,
      adapterType: model.provider.adapterType as AdapterType,
      modelId: model.id,
      taskType,
      input: input.input,
      parameters,
      files: input.files ?? [],
      skillContext: input.skillContext ?? {},
      workflowContext: input.workflowContext ?? {},
      userContext: input.userContext ?? {}
    };
    const adapterRequest = buildAdapterPayload({
      request,
      upstreamModelName: model.upstreamModelName,
      provider: {
        adapterType: model.provider.adapterType as AdapterType,
        baseUrl: model.provider.baseUrl,
        authType: model.provider.authType,
        defaultChannel: model.provider.defaultChannel,
        defaultBackend: model.provider.defaultBackend,
        config: providerConfig
      }
    });

    return {
      request,
      adapterRequest,
      providerConfig,
      taskType,
      parameters
    };
  }

  private async executeWithRetryAndFallback({
    input,
    primary
  }: {
    input: GatewayInvokeInput;
    primary: {
      model: LoadedModelDefinition;
      request: UnifiedModelRequest;
      adapterRequest: AdapterPayload;
      providerConfig: Record<string, unknown>;
      taskType: ModelTaskType;
      parameters: Record<string, unknown>;
    };
  }) {
    const fallbackModelIds = parseStringArray(primary.providerConfig.fallbackModelIds).filter((id) => id !== primary.model.id);
    const candidates = [primary, ...(await this.loadFallbackPlans(input, fallbackModelIds))];
    const attemptRecords: Array<Record<string, unknown>> = [];
    let lastResponse: UnifiedModelResponse | null = null;

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex]!;
      const retryAttempts = Math.max(0, Math.floor(numberFromConfig(candidate.providerConfig.retryAttempts, 1)));
      const retryDelayMs = Math.max(0, Math.floor(numberFromConfig(candidate.providerConfig.retryDelayMs, 350)));

      for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
        const response = await executeAdapterRequest({
          adapterRequest: candidate.adapterRequest,
          adapterType: candidate.model.provider.adapterType as AdapterType,
          providerId: candidate.model.providerId,
          modelId: candidate.model.id,
          contextWindow: candidate.model.contextWindow
        });

        attemptRecords.push({
          modelId: candidate.model.id,
          providerId: candidate.model.providerId,
          attempt: attempt + 1,
          fallback: candidateIndex > 0,
          status: response.status,
          errorCode: response.error?.code,
          elapsedMs: response.usage.elapsedMs
        });

        if (response.status !== "failed") {
          return attachGatewayAttempts(response, attemptRecords);
        }

        lastResponse = response;

        if (!isRetryableGatewayError(response) || attempt === retryAttempts) {
          break;
        }

        await sleep(retryDelayMs * (attempt + 1));
      }
    }

    return attachGatewayAttempts(lastResponse ?? {
      status: "failed",
      provider: primary.model.providerId,
      model: primary.model.id,
      assetUrls: [],
      usage: {},
      rawResponse: {},
      error: {
        code: "GATEWAY_NO_RESPONSE",
        message: "模型网关没有获得可用响应"
      }
    }, attemptRecords);
  }

  private async loadFallbackPlans(input: GatewayInvokeInput, fallbackModelIds: string[]) {
    const plans: Array<{
      model: LoadedModelDefinition;
      request: UnifiedModelRequest;
      adapterRequest: AdapterPayload;
      providerConfig: Record<string, unknown>;
      taskType: ModelTaskType;
      parameters: Record<string, unknown>;
    }> = [];

    for (const modelId of fallbackModelIds) {
      const fallbackModel = await this.prisma.modelDefinition.findUnique({
        where: { id: modelId },
        include: { provider: true }
      });

      if (!fallbackModel?.enabled || !fallbackModel.provider.enabled) {
        continue;
      }

      try {
        const plan = await this.buildInvocationPlan(input, fallbackModel as unknown as LoadedModelDefinition);
        plans.push({
          model: fallbackModel as unknown as LoadedModelDefinition,
          ...plan
        });
      } catch {
        continue;
      }
    }

    return plans;
  }
}

async function executeAdapterRequest({
  adapterRequest,
  adapterType,
  providerId,
  modelId,
  contextWindow
}: {
  adapterRequest: AdapterPayload;
  adapterType: AdapterType;
  providerId: string;
  modelId: string;
  contextWindow: number | null;
}): Promise<UnifiedModelResponse> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), adapterRequest.timeoutMs);

  try {
    const { body, headers } = await buildFetchBody(adapterRequest);
    const response = await fetch(adapterRequest.url, {
      method: adapterRequest.method,
      headers,
      body,
      signal: controller.signal
    });
    const rawResponse = await parseProviderResponse(response);
    const normalized = normalizeProviderResponse({
      rawResponse,
      adapterType,
      providerId,
      modelId,
      contextWindow,
      statusCode: response.status,
      elapsedMs: Date.now() - startedAt
    });

    if (!response.ok) {
      return {
        ...normalized,
        status: "failed",
        error: {
          code: `HTTP_${response.status}`,
          message: extractErrorMessage(rawResponse) || response.statusText || "Provider request failed"
        }
      };
    }

    return normalized;
  } catch (error) {
    const message = formatFetchError(error);

    return {
      status: "failed",
      provider: providerId,
      model: modelId,
      assetUrls: [],
      usage: {
        dryRun: false,
        externalCall: true,
        contextWindow,
        elapsedMs: Date.now() - startedAt
      },
      rawResponse: {
        message
      },
      error: {
        code: message.toLowerCase().includes("abort") ? "TIMEOUT" : "PROVIDER_REQUEST_ERROR",
        message
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function parseProviderResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function normalizeProviderResponse({
  rawResponse,
  adapterType,
  providerId,
  modelId,
  contextWindow,
  statusCode,
  elapsedMs
}: {
  rawResponse: unknown;
  adapterType: AdapterType;
  providerId: string;
  modelId: string;
  contextWindow: number | null;
  statusCode: number;
  elapsedMs: number;
}): UnifiedModelResponse {
  const raw = isRecord(rawResponse) ? rawResponse : {};
  const outputText = extractOutputText(rawResponse, adapterType);
  const taskId = stringFromConfig(raw.id) || stringFromConfig(raw.task_id) || stringFromConfig(raw.taskId);
  const assetUrls = extractAssetUrls(rawResponse);
  const providerStatus = String(raw.status ?? raw.state ?? "").toLowerCase();

  return {
    status: normalizeProviderStatus(providerStatus),
    provider: providerId,
    model: modelId,
    taskId: taskId || undefined,
    outputText,
    outputJson: rawResponse,
    assetUrls,
    usage: {
      dryRun: false,
      externalCall: true,
      httpStatus: statusCode,
      elapsedMs,
      adapterType,
      contextWindow,
      providerUsage: isRecord(raw.usage) ? raw.usage : undefined
    },
    rawResponse
  };
}

function buildDryRunResponse({
  taskType,
  modelName,
  modelId,
  providerId,
  adapterType,
  upstreamModelName,
  adapterRequest,
  contextWindow
}: {
  taskType: ModelTaskType;
  modelName: string;
  modelId: string;
  providerId: string;
  adapterType: AdapterType;
  upstreamModelName: string;
  adapterRequest: AdapterPayload;
  contextWindow: number | null;
}): UnifiedModelResponse {
  return {
    status: "succeeded",
    provider: providerId,
    model: modelId,
    taskId: `dry-run-${Date.now()}`,
    outputText: buildDryRunOutput(taskType, modelName),
    outputJson: {
      mode: "cloud_api_adapter_dry_run",
      adapterType,
      upstreamModelName,
      liveCallGate: "provider.config.enableLiveCalls !== true",
      requestShape: {
        url: adapterRequest.url,
        method: adapterRequest.method,
        bodyKeys: Object.keys(adapterRequest.body),
        multipartFileFields: adapterRequest.multipartFiles?.map((file) => file.fieldName) ?? []
      }
    },
    assetUrls: [],
    usage: {
      dryRun: true,
      externalCall: false,
      contextWindow
    },
    rawResponse: {
      message: "开发安全模式：已完成统一云端 API 请求构造和参数校验，未向外部厂商发起真实调用。"
    }
  };
}

function normalizeTaskType(taskType: string, allowedTaskTypes: string[]): ModelTaskType {
  const normalized = mapNodeTypeToTaskType(taskType);

  if (allowedTaskTypes.length > 0 && !allowedTaskTypes.includes(normalized)) {
    throw new BadRequestException(`模型不支持当前任务类型：${normalized}`);
  }

  return normalized as ModelTaskType;
}

function mapNodeTypeToTaskType(taskType: string) {
  if (["text_generation", "script_generation", "text_to_image", "image_edit", "image_to_video", "text_to_video", "text_to_speech", "speech_to_text", "moderation", "embedding"].includes(taskType)) {
    return taskType;
  }

  if (taskType.includes("video")) {
    return taskType.includes("image") ? "image_to_video" : "text_to_video";
  }

  if (taskType.includes("image") || taskType.includes("render") || taskType.includes("palette")) {
    return "text_to_image";
  }

  if (taskType.includes("review") || taskType.includes("sensitive") || taskType.includes("compliance")) {
    return "moderation";
  }

  return "script_generation";
}

function validateParameters(parameters: Record<string, unknown>, schema: Record<string, unknown>) {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
  const nextParameters = { ...parameters };

  for (const key of required) {
    if (nextParameters[key] === undefined || nextParameters[key] === "") {
      throw new BadRequestException(`缺少模型必填参数：${key}`);
    }
  }

  for (const [key, definition] of Object.entries(properties)) {
    if (!isRecord(definition)) {
      continue;
    }

    const value = nextParameters[key];

    if (value === undefined) {
      if (definition.default !== undefined) {
        nextParameters[key] = definition.default;
      }
      continue;
    }

    if (definition.type === "number" && typeof value !== "number") {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) {
        throw new BadRequestException(`参数 ${key} 必须是数字`);
      }
      nextParameters[key] = numberValue;
    }

    const checkedValue = nextParameters[key];

    if (Array.isArray(definition.enum) && !definition.enum.includes(checkedValue)) {
      throw new BadRequestException(`参数 ${key} 不在模型允许范围内`);
    }
  }

  return nextParameters;
}

function buildAdapterPayload({
  request,
  upstreamModelName,
  provider
}: {
  request: UnifiedModelRequest;
  upstreamModelName: string;
  provider: {
    adapterType: AdapterType;
    baseUrl: string;
    authType: string;
    defaultChannel?: string | null;
    defaultBackend?: string | null;
    config: Record<string, unknown>;
  };
}): AdapterPayload {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const timeoutMs = numberFromConfig(provider.config.timeoutMs, 120000);
  const headers = buildHeaders(provider.authType, provider.config);

  if (provider.adapterType === "official_seedance") {
    return buildSeedancePayload({
      baseUrl,
      headers,
      timeoutMs,
      request,
      upstreamModelName,
      provider
    });
  }

  if (
    ["official_openai", "openai_compatible"].includes(provider.adapterType) &&
    (request.taskType === "text_to_image" || request.taskType === "image_edit")
  ) {
    return buildOpenAICompatibleImagePayload({
      baseUrl,
      headers,
      timeoutMs,
      request,
      upstreamModelName,
      provider
    });
  }

  if (
    ["official_openai", "openai_compatible"].includes(provider.adapterType) &&
    (request.taskType === "text_to_video" || request.taskType === "image_to_video")
  ) {
    return buildOpenAICompatibleVideoPayload({
      baseUrl,
      headers,
      timeoutMs,
      request,
      upstreamModelName,
      provider
    });
  }

  if (["official_openai", "openai_compatible"].includes(provider.adapterType)) {
    const completionPath = stringFromConfig(provider.config.completionPath) || "/chat/completions";

    return {
      method: "POST",
      url: `${baseUrl}${completionPath.startsWith("/") ? completionPath : `/${completionPath}`}`,
      headers,
      timeoutMs,
      body: {
        model: upstreamModelName,
        messages: normalizeMessages(request.input, request.skillContext, request.workflowContext),
        ...request.parameters,
        stream: false,
        channel: provider.defaultChannel ?? undefined,
        backend: provider.defaultBackend ?? undefined
      }
    };
  }

  if (provider.adapterType === "official_google") {
    return {
      method: "POST",
      url: `${baseUrl}/models/${encodeURIComponent(upstreamModelName)}:generateContent`,
      headers,
      timeoutMs,
      body: {
        contents: [{ role: "user", parts: [{ text: stringifyPromptInput(request.input, request.skillContext, request.workflowContext) }] }],
        generationConfig: request.parameters
      }
    };
  }

  if (provider.adapterType === "official_video_provider") {
    return {
      method: "POST",
      url: `${baseUrl}/tasks`,
      headers,
      timeoutMs,
      body: {
        model: upstreamModelName,
        task_type: request.taskType,
        prompt: stringifyPromptInput(request.input, request.skillContext, request.workflowContext),
        files: request.files,
        parameters: request.parameters
      }
    };
  }

  return {
    method: "POST",
    url: `${baseUrl}/invoke`,
    headers,
    timeoutMs,
    body: {
      model: upstreamModelName,
      taskType: request.taskType,
      input: request.input,
      parameters: request.parameters,
      files: request.files,
      skillContext: request.skillContext,
      workflowContext: request.workflowContext,
      userContext: request.userContext
    }
  };
}

function buildOpenAICompatibleVideoPayload({
  baseUrl,
  headers,
  timeoutMs,
  request,
  upstreamModelName,
  provider
}: {
  baseUrl: string;
  headers: Record<string, string>;
  timeoutMs: number;
  request: UnifiedModelRequest;
  upstreamModelName: string;
  provider: {
    config: Record<string, unknown>;
  };
}): AdapterPayload {
  const videoPath = stringFromConfig(provider.config.videoGenerationPath) || "/v1/video/generations";
  const prompt = extractPromptText(request.input, request.skillContext, request.workflowContext);
  const metadata: Record<string, unknown> = {
    resolution: request.parameters.resolution,
    ratio: request.parameters.aspectRatio ?? request.parameters.aspect_ratio ?? request.parameters.ratio,
    camera_fixed: request.parameters.cameraFixed ?? request.parameters.camera_fixed,
    watermark: request.parameters.watermark,
    generate_audio: request.parameters.generateAudio ?? request.parameters.generate_audio,
    seed: request.parameters.seed
  };
  const cleanedMetadata = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== ""));
  const body: Record<string, unknown> = {
    model: upstreamModelName,
    prompt,
    duration: request.parameters.duration
  };

  if (Object.keys(cleanedMetadata).length > 0) {
    body.metadata = cleanedMetadata;
  }

  if (request.files.length > 0) {
    body.image = request.files[0];
    body.images = request.files;
  }

  return {
    method: "POST",
    url: `${baseUrl}${videoPath.startsWith("/") ? videoPath : `/${videoPath}`}`,
    headers,
    timeoutMs,
    body
  };
}

function buildOpenAICompatibleImagePayload({
  baseUrl,
  headers,
  timeoutMs,
  request,
  upstreamModelName,
  provider
}: {
  baseUrl: string;
  headers: Record<string, string>;
  timeoutMs: number;
  request: UnifiedModelRequest;
  upstreamModelName: string;
  provider: {
    config: Record<string, unknown>;
  };
}): AdapterPayload {
  const imagePath =
    request.taskType === "image_edit"
      ? stringFromConfig(provider.config.imageEditPath) || "/images/edits"
      : stringFromConfig(provider.config.imageGenerationPath) || "/images/generations";
  const prompt = extractPromptText(request.input, request.skillContext, request.workflowContext);
  const supportedParameterKeys = new Set([
    "background",
    "moderation",
    "n",
    "output_compression",
    "output_format",
    "quality",
    "response_format",
    "size",
    "style",
    "user"
  ]);
  const imageParameters = Object.fromEntries(
    Object.entries(request.parameters)
      .filter(([key, value]) => supportedParameterKeys.has(key) && value !== undefined && value !== "")
      .filter(([key, value]) => !(key === "size" && value === "auto"))
  );

  const body: Record<string, unknown> = {
    model: upstreamModelName,
    prompt,
    ...imageParameters
  };

  if (request.files.length > 0) {
    return {
      method: "POST",
      url: `${baseUrl}${imagePath.startsWith("/") ? imagePath : `/${imagePath}`}`,
      headers,
      timeoutMs,
      body,
      multipartFiles: request.files.map((file) => ({
        fieldName: "image",
        path: file
      }))
    };
  }

  return {
    method: "POST",
    url: `${baseUrl}${imagePath.startsWith("/") ? imagePath : `/${imagePath}`}`,
    headers,
    timeoutMs,
    body
  };
}

function buildSeedancePayload({
  baseUrl,
  headers,
  timeoutMs,
  request,
  upstreamModelName,
  provider
}: {
  baseUrl: string;
  headers: Record<string, string>;
  timeoutMs: number;
  request: UnifiedModelRequest;
  upstreamModelName: string;
  provider: {
    config: Record<string, unknown>;
  };
}): AdapterPayload {
  const prompt = extractPromptText(request.input, request.skillContext, request.workflowContext);

  if (request.taskType === "text_to_image" || request.taskType === "image_edit") {
    const imagePath = stringFromConfig(provider.config.imageGenerationPath) || "/images/generations";

    if (!stringFromConfig(provider.config.imageGenerationPath)) {
      throw new BadRequestException("当前模型渠道未配置图片生成接口，不能处理图片任务");
    }

    return {
      method: "POST",
      url: `${baseUrl}${imagePath.startsWith("/") ? imagePath : `/${imagePath}`}`,
      headers,
      timeoutMs,
      body: {
        model: upstreamModelName,
        prompt,
        ...request.parameters
      }
    };
  }

  if (request.taskType === "text_to_video" || request.taskType === "image_to_video") {
    const videoPath = stringFromConfig(provider.config.videoGenerationPath) || "/contents/generations/tasks";

    if (!stringFromConfig(provider.config.videoGenerationPath)) {
      throw new BadRequestException("当前模型渠道未配置视频生成接口，不能处理视频任务");
    }

    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];

    for (const file of request.files) {
      content.push({ type: "image_url", image_url: { url: file } });
    }

    return {
      method: "POST",
      url: `${baseUrl}${videoPath.startsWith("/") ? videoPath : `/${videoPath}`}`,
      headers,
      timeoutMs,
      body: {
        model: upstreamModelName,
        content,
        parameters: {
          duration: request.parameters.duration,
          aspect_ratio: request.parameters.aspectRatio ?? request.parameters.aspect_ratio,
          resolution: request.parameters.resolution,
          seed: request.parameters.seed,
          mode: request.parameters.mode,
          camera_fixed: request.parameters.cameraFixed ?? request.parameters.camera_fixed,
          watermark: request.parameters.watermark
        }
      }
    };
  }

  return {
    method: "POST",
    url: `${baseUrl}/chat/completions`,
    headers,
    timeoutMs,
    body: {
      model: upstreamModelName,
      messages: normalizeMessages(request.input, request.skillContext, request.workflowContext),
      ...request.parameters,
      stream: false
    }
  };
}

function buildHeaders(authType: string, config: Record<string, unknown>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = stringFromConfig(config.apiKey) || stringFromConfig(config.token);

  if (authType === "bearer" && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (authType === "api_key" && apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  if (authType === "custom_header" && isRecord(config.headers)) {
    for (const [key, value] of Object.entries(config.headers)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
  }

  return headers;
}

async function buildFetchBody(adapterRequest: AdapterPayload): Promise<{
  body: BodyInit;
  headers: Record<string, string>;
}> {
  if (!adapterRequest.multipartFiles?.length) {
    return {
      body: JSON.stringify(adapterRequest.body),
      headers: adapterRequest.headers
    };
  }

  const formData = new FormData();

  for (const [key, value] of Object.entries(adapterRequest.body)) {
    if (value === undefined || value === null) {
      continue;
    }

    formData.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  for (const file of adapterRequest.multipartFiles) {
    const blob = await openAsBlob(file.path);
    formData.append(file.fieldName, blob, basename(file.path));
  }

  const headers = Object.fromEntries(
    Object.entries(adapterRequest.headers).filter(([key]) => key.toLowerCase() !== "content-type")
  );

  return {
    body: formData,
    headers
  };
}

function extractOutputText(rawResponse: unknown, adapterType: AdapterType) {
  if (typeof rawResponse === "string") {
    return rawResponse;
  }

  if (!isRecord(rawResponse)) {
    return undefined;
  }

  if (["official_openai", "openai_compatible", "official_xai"].includes(adapterType)) {
    const firstChoice = Array.isArray(rawResponse.choices) && isRecord(rawResponse.choices[0]) ? rawResponse.choices[0] : undefined;
    const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : undefined;
    const messageContent = message?.content;

    if (typeof messageContent === "string") {
      return messageContent;
    }

    if (Array.isArray(messageContent)) {
      return messageContent
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n");
    }

    if (typeof firstChoice?.text === "string") {
      return firstChoice.text;
    }
  }

  if (adapterType === "official_google") {
    const firstCandidate = Array.isArray(rawResponse.candidates) && isRecord(rawResponse.candidates[0]) ? rawResponse.candidates[0] : undefined;
    const content = firstCandidate && isRecord(firstCandidate.content) ? firstCandidate.content : undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const text = parts
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");

    return text || undefined;
  }

  if (typeof rawResponse.output_text === "string") {
    return rawResponse.output_text;
  }

  if (typeof rawResponse.output === "string") {
    return rawResponse.output;
  }

  if (typeof rawResponse.text === "string") {
    return rawResponse.text;
  }

  return undefined;
}

function extractAssetUrls(rawResponse: unknown) {
  const urls = new Set<string>();
  collectUrls(rawResponse, urls);
  return Array.from(urls);
}

function collectUrls(value: unknown, urls: Set<string>) {
  if (typeof value === "string") {
    if (isLikelyAssetUrl(value)) {
      urls.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrls(item, urls);
    }
    return;
  }

  if (isRecord(value)) {
    for (const [key, nextValue] of Object.entries(value)) {
      if (["url", "file_url", "video_url", "image_url", "asset_url", "output_url"].includes(key) && typeof nextValue === "string" && isLikelyAssetUrl(nextValue)) {
        urls.add(nextValue);
        continue;
      }

      collectUrls(nextValue, urls);
    }
  }
}

function isLikelyAssetUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function normalizeProviderStatus(status: string): UnifiedModelResponse["status"] {
  if (["queued", "pending", "created"].includes(status)) {
    return "queued";
  }

  if (["running", "processing", "in_progress"].includes(status)) {
    return "running";
  }

  if (["failed", "error", "cancelled", "canceled"].includes(status)) {
    return "failed";
  }

  return "succeeded";
}

function extractErrorMessage(rawResponse: unknown) {
  if (!isRecord(rawResponse)) {
    return undefined;
  }

  if (typeof rawResponse.error === "string") {
    return rawResponse.error;
  }

  if (isRecord(rawResponse.error) && typeof rawResponse.error.message === "string") {
    return rawResponse.error.message;
  }

  if (typeof rawResponse.message === "string") {
    return rawResponse.message;
  }

  return undefined;
}

function formatFetchError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Provider request failed";
  }

  const details: string[] = [error.message];
  let cause = (error as Error & { cause?: unknown }).cause;

  while (cause instanceof Error) {
    const causeWithCode = cause as Error & { code?: unknown };
    const code = typeof causeWithCode.code === "string" ? causeWithCode.code : "";
    details.push(code ? `${cause.message} (${code})` : cause.message);
    cause = (cause as Error & { cause?: unknown }).cause;
  }

  return Array.from(new Set(details.filter(Boolean))).join(": ");
}

function normalizeMessages(input: unknown, skillContext: Record<string, unknown>, workflowContext: Record<string, unknown>) {
  if (Array.isArray(input)) {
    return input;
  }

  return [
    {
      role: "system",
      content: stringifyPromptInput({ skillContext, workflowContext }, {}, {})
    },
    {
      role: "user",
      content: stringifyPromptInput(input, skillContext, workflowContext)
    }
  ];
}

function stringifyPromptInput(input: unknown, skillContext: Record<string, unknown>, workflowContext: Record<string, unknown>) {
  if (typeof input === "string") {
    return input;
  }

  return JSON.stringify({ input, skillContext, workflowContext });
}

function extractPromptText(input: unknown, skillContext: Record<string, unknown>, workflowContext: Record<string, unknown>) {
  if (isRecord(input) && typeof input.prompt === "string" && input.prompt.trim()) {
    return input.prompt.trim();
  }

  return stringifyPromptInput(input, skillContext, workflowContext);
}

function buildDryRunOutput(taskType: ModelTaskType, modelName: string) {
  if (taskType === "script_generation" || taskType === "text_generation") {
    return [
      `已通过 ${modelName} 构造剧本生成请求。以下为开发安全模式下的可拆分分镜样稿：`,
      "分镜 1：景别：中近景。画面：主角在夜色中的城市天台停下脚步，霓虹反光落在脸侧。动作：主角低头看见关键线索，情绪从犹豫转为坚定。台词/旁白：这一刻，我知道不能再逃。镜头运动：缓慢推近。声音/音乐：低频鼓点渐强。图片生成提示词：cinematic night rooftop, neon reflection, determined protagonist, medium close-up, dramatic lighting.",
      "分镜 2：景别：全景转跟拍。画面：主角穿过狭长走廊，墙面投影闪现过往记忆。动作：主角奔跑，手中线索被风掀起。台词/旁白：真相一直在我身边。镜头运动：稳定器跟拍，轻微晃动增强紧张感。声音/音乐：脚步声与心跳叠加。图片生成提示词：long corridor, memory projections on walls, running protagonist, suspenseful cinematic frame.",
      "分镜 3：景别：特写。画面：主角把线索放到桌面，画面定格在被圈出的名字上。动作：指尖压住纸张，呼吸停顿。台词/旁白：答案，就是这个名字。镜头运动：快速切入特写后轻微拉焦。声音/音乐：音乐骤停，只剩纸张摩擦声。图片生成提示词：close-up evidence paper, circled name, tense fingers, shallow depth of field, high contrast."
    ].join("\n\n");
  }

  if (taskType === "text_to_image" || taskType === "image_edit") {
    return [
      `已通过 ${modelName} 构造图片生成请求。开发安全模式未向外部图片模型发起真实调用。`,
      "图片提示词已合并节点提示词、上游文本和参考图片；开启模型渠道真实调用后，该节点会写入生成图片 URL 并展示预览。"
    ].join("\n");
  }

  return `已通过 ${modelName} 的 ${taskType} 适配器完成统一云端 API 请求构造。`;
}

function redactAdapterPayload(payload: AdapterPayload) {
  return {
    ...payload,
    headers: Object.fromEntries(
      Object.entries(payload.headers).map(([key, value]) =>
        key.toLowerCase().includes("authorization") || key.toLowerCase().includes("key")
          ? [key, value ? "******" : value]
          : [key, value]
      )
    )
  };
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function isRetryableGatewayError(response: UnifiedModelResponse) {
  const status = Number(response.usage.httpStatus ?? 0);
  const code = response.error?.code ?? "";

  return code === "TIMEOUT" || code === "PROVIDER_REQUEST_ERROR" || status === 0 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function attachGatewayAttempts(response: UnifiedModelResponse, attempts: Array<Record<string, unknown>>): UnifiedModelResponse {
  return {
    ...response,
    usage: {
      ...response.usage,
      gatewayAttempts: attempts,
      gatewayAttemptCount: attempts.length,
      fallbackUsed: attempts.some((attempt) => attempt.fallback === true)
    }
  };
}
