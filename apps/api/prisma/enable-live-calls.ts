import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log("🚀 正在启用模型的真实调用...\n");

  // 获取环境变量中的配置
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY || "";
  const deepseekModel = process.env.DEEPSEEK_CHAT_MODEL || "deepseek-chat";
  const openaiApiKey = process.env.OPENAI_API_KEY || "";

  if (!deepseekApiKey) {
    console.error("❌ 错误：未找到 DEEPSEEK_API_KEY 环境变量");
    console.error("   请在 .env 文件中填入你的 DeepSeek API Key");
    process.exit(1);
  }

  // ========== 启用 DeepSeek 真实调用 ==========
  console.log("📝 配置 DeepSeek Provider...");
  const deepseekProvider = await prisma.provider.update({
    where: { id: "deepseek-official" },
    data: {
      configJson: JSON.stringify({
        apiKey: deepseekApiKey,
        enableLiveCalls: true, // ✅ 开启真实调用
        completionPath: "/chat/completions",
        timeoutMs: 120000
      })
    }
  });
  console.log("   ✅ DeepSeek Provider 已更新");
  console.log(`   - API Key: ${deepseekApiKey.substring(0, 10)}...`);
  console.log(`   - enableLiveCalls: true`);
  console.log(`   - 模型: ${deepseekModel}`);

  // 更新 DeepSeek-4 模型的 upstreamModelName
  const deepseekModelDef = await prisma.modelDefinition.update({
    where: { id: "deepseek-4" },
    data: {
      displayName: "DeepSeek V4 Flash",
      upstreamModelName: deepseekModel
    }
  });
  console.log(`   ✅ 模型定义已更新: ${deepseekModelDef.displayName} (${deepseekModelDef.upstreamModelName})`);

  // ========== 可选：同时启用 OpenAI/DALL-E 的真实调用 ==========
  if (openaiApiKey) {
    console.log("\n📝 配置 OpenAI Provider...");
    await prisma.provider.update({
      where: { id: "openai-compatible" },
      data: {
        configJson: JSON.stringify({
          apiKey: openaiApiKey,
          enableLiveCalls: true, // ✅ 也开启 DALL-E 真实调用
          imageGenerationPath: "/images/generations",
          imageEditPath: "/images/edits",
          timeoutMs: 120000
        })
      }
    });
    console.log("   ✅ OpenAI Provider 已启用真实调用");
  }

  console.log("\n✅ 完成！所有模型已切换到真实调用模式。");
  console.log("\n⚠️  提示：");
  console.log("   - 现在调用模型会产生实际费用");
  console.log("   - 建议先测试小规模调用");
  console.log("   - 如需关闭，可将 configJson 中的 enableLiveCalls 改为 false");
}

main()
  .catch((e) => {
    console.error("❌ 失败:", e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
