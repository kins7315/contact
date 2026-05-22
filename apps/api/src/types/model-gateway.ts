import { z } from "zod";

export const adapterTypeSchema = z.enum([
  "official_openai",
  "official_google",
  "official_anthropic",
  "official_xai",
  "official_seedance",
  "official_video_provider",
  "openai_compatible",
  "custom_http"
]);

export const modelTaskTypeSchema = z.enum([
  "text_generation",
  "script_generation",
  "text_to_image",
  "image_edit",
  "image_to_video",
  "text_to_video",
  "text_to_speech",
  "speech_to_text",
  "moderation",
  "embedding"
]);

export const modelProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  adapterType: adapterTypeSchema,
  baseUrl: z.string().url(),
  enabled: z.boolean(),
  defaultModel: z.string().optional(),
  defaultChannel: z.string().optional(),
  defaultBackend: z.string().optional(),
  supportsHealthCheck: z.boolean().default(false),
  supportsUsageSync: z.boolean().default(false)
});

export const modelDefinitionSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  displayName: z.string(),
  upstreamModelName: z.string(),
  taskTypes: z.array(modelTaskTypeSchema),
  enabled: z.boolean(),
  contextWindow: z.number().int().positive().optional(),
  parameterSchema: z.record(z.string(), z.unknown()).default({})
});

export const unifiedModelRequestSchema = z.object({
  providerId: z.string(),
  adapterType: adapterTypeSchema,
  modelId: z.string(),
  taskType: modelTaskTypeSchema,
  input: z.unknown(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  files: z.array(z.string().url()).default([]),
  skillContext: z.record(z.string(), z.unknown()).default({}),
  workflowContext: z.record(z.string(), z.unknown()).default({}),
  userContext: z.record(z.string(), z.unknown()).default({})
});

export const unifiedModelResponseSchema = z.object({
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  provider: z.string(),
  model: z.string(),
  taskId: z.string().optional(),
  outputText: z.string().optional(),
  outputJson: z.unknown().optional(),
  assetUrls: z.array(z.string().url()).default([]),
  usage: z.record(z.string(), z.unknown()).default({}),
  rawResponse: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string()
    })
    .optional()
});

export type AdapterType = z.infer<typeof adapterTypeSchema>;
export type ModelTaskType = z.infer<typeof modelTaskTypeSchema>;
export type ModelProvider = z.infer<typeof modelProviderSchema>;
export type ModelDefinition = z.infer<typeof modelDefinitionSchema>;
export type UnifiedModelRequest = z.infer<typeof unifiedModelRequestSchema>;
export type UnifiedModelResponse = z.infer<typeof unifiedModelResponseSchema>;
