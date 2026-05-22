import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("开始播种数据...");

  // 创建一个示例 OpenAI 兼容的 Provider（使用环境变量配置）
  const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const openaiApiKey = process.env.OPENAI_API_KEY || "";

  const openaiProvider = await prisma.provider.upsert({
    where: { id: "openai-compatible" },
    update: {},
    create: {
      id: "openai-compatible",
      name: "OpenAI 兼容 API",
      adapterType: "openai_compatible",
      baseUrl: openaiBaseUrl,
      authType: "bearer",
      enabled: true,
      configJson: JSON.stringify({
        apiKey: openaiApiKey,
        enableLiveCalls: false, // 默认关闭真实调用，安全模式
        imageGenerationPath: "/images/generations",
        imageEditPath: "/images/edits",
        timeoutMs: 120000
      })
    }
  });

  console.log("Provider 创建或更新成功:", openaiProvider);

  // 创建示例模型定义
  const imageModel = await prisma.modelDefinition.upsert({
    where: { id: "openai-dall-e" },
    update: {},
    create: {
      id: "openai-dall-e",
      providerId: "openai-compatible",
      displayName: "DALL-E 3",
      upstreamModelName: process.env.OPENAI_IMAGE_MODEL || "dall-e-3",
      taskTypesJson: JSON.stringify(["text_to_image", "image_edit"]),
      enabled: true,
      parameterSchemaJson: JSON.stringify({
        type: "object",
        properties: {
          size: {
            type: "string",
            enum: ["1024x1024", "1024x1536", "1536x1024"]
          },
          n: {
            type: "number",
            minimum: 1,
            maximum: 4
          },
          quality: {
            type: "string",
            enum: ["standard", "hd"]
          },
          style: {
            type: "string",
            enum: ["vivid", "natural"]
          }
        },
        required: []
      })
    }
  });

  console.log("Model 定义创建或更新成功:", imageModel);

  // ========== 创建 DeepSeek Provider ==========
  const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY || "";

  const deepseekProvider = await prisma.provider.upsert({
    where: { id: "deepseek-official" },
    update: {},
    create: {
      id: "deepseek-official",
      name: "DeepSeek 官方 API",
      adapterType: "openai_compatible",
      baseUrl: deepseekBaseUrl,
      authType: "bearer",
      enabled: true,
      configJson: JSON.stringify({
        apiKey: deepseekApiKey,
        enableLiveCalls: false, // 默认关闭真实调用，安全模式
        completionPath: "/chat/completions",
        timeoutMs: 120000
      })
    }
  });

  console.log("DeepSeek Provider 创建或更新成功:", deepseekProvider);

  // ========== 创建 DeepSeek-4 模型定义 ==========
  const deepseekModel = await prisma.modelDefinition.upsert({
    where: { id: "deepseek-4" },
    update: {},
    create: {
      id: "deepseek-4",
      providerId: "deepseek-official",
      displayName: "DeepSeek-4",
      upstreamModelName: process.env.DEEPSEEK_CHAT_MODEL || "deepseek-chat",
      taskTypesJson: JSON.stringify(["text_generation", "script_generation"]),
      enabled: true,
      parameterSchemaJson: JSON.stringify({
        type: "object",
        properties: {
          temperature: {
            type: "number",
            minimum: 0,
            maximum: 2
          },
          max_tokens: {
            type: "number",
            minimum: 1,
            maximum: 8192
          },
          top_p: {
            type: "number",
            minimum: 0,
            maximum: 1
          }
        },
        required: []
      })
    }
  });

  console.log("DeepSeek-4 Model 定义创建或更新成功:", deepseekModel);

  console.log("\n✅ 数据播种完成！已添加以下模型：");
  console.log("   - OpenAI DALL-E 3 (图片生成)");
  console.log("   - DeepSeek-4 (文本生成)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
