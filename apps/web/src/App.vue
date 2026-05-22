<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  generateImage,
  generateText,
  getAvailableModels,
  getCurrentUser,
  getHistory,
  getHistoryDetail,
  getModelConfig,
  login,
  logout,
  register,
  type HistoryDetail,
  type HistoryItem,
  type ModelInfo,
  type User
} from "./api/client";

const user = ref<User | null>(null);
const authMode = ref<"login" | "register">("login");
const username = ref("");
const password = ref("");
const confirmPassword = ref("");
const authLoading = ref(false);
const authError = ref("");

const imageFile = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const promptInput = ref<HTMLTextAreaElement | null>(null);
const imagePreview = ref("");
const prompt = ref("");
const size = ref("1024x1024");
const count = ref(1);
const generating = ref(false);
const generationError = ref("");
const resultUrls = ref<string[]>([]);
const textResult = ref("");
const copySuccess = ref(false);
const historyItems = ref<HistoryItem[]>([]);
const selectedHistory = ref<HistoryDetail | null>(null);
const historyLoading = ref(false);
const historyError = ref("");

let copyTimer: number | null = null;

const availableModels = ref<ModelInfo[]>([]);
const selectedModelId = ref("");
const selectedModel = ref<ModelInfo | null>(null);

const authTitle = computed(() => (authMode.value === "login" ? "登录" : "注册"));
const authSubmitText = computed(() => (authMode.value === "login" ? "登录" : "创建账号"));

const isTextModel = computed(() => {
  if (!selectedModel.value) return false;
  return selectedModel.value.taskTypes.includes("text_generation") &&
    !selectedModel.value.taskTypes.includes("text_to_image");
});

const isImageModel = computed(() => {
  if (!selectedModel.value) return true;
  return selectedModel.value.taskTypes.includes("text_to_image") ||
    selectedModel.value.taskTypes.includes("image_edit");
});

const workspaceEyebrow = computed(() => (isTextModel.value ? "Text Workspace" : "Image Workspace"));
const workspaceTitle = computed(() => (
  isTextModel.value ? "写下你的意图，快速得到清晰文本结果" : "从一张图开始，把想法延展成更完整的视觉结果"
));
const workspaceDescription = computed(() => (
  isTextModel.value
    ? "选择文本模型后输入提示词，用统一工作台完成起草、润色和复制。"
    : "上传参考图或直接输入创意描述，在一个界面里完成编辑、生成和下载。"
));
const promptPlaceholder = computed(() => (
  isTextModel.value
    ? "输入文本提示词，例如：为一款新发布的 AI 产品写一段简洁专业的介绍文案"
    : "描述你想生成或编辑的画面，例如：保留主体构图，改成自然光极简工作室风格"
));
const generationStatusText = computed(() => (
  isTextModel.value ? "正在生成文本，请稍候..." : "正在生成图片，请稍候..."
));
const hasResults = computed(() => Boolean(textResult.value) || resultUrls.value.length > 0);
const historyTitle = computed(() => {
  if (historyLoading.value) return "加载历史中";
  if (historyItems.value.length === 0) return "暂无历史记录";
  return `${historyItems.value.length} 条历史记录`;
});
const resultSummary = computed(() => {
  if (generating.value) {
    return isTextModel.value ? "正在生成文本结果" : "正在生成图片结果";
  }

  if (isTextModel.value) {
    return textResult.value ? "已生成 1 段文本结果" : "等待生成文本";
  }
  return resultUrls.value.length ? `已生成 ${resultUrls.value.length} 张图片` : "等待生成图片";
});
const modelTaskSummary = computed(() => {
  if (!selectedModel.value) return "模型能力加载中";
  return selectedModel.value.taskTypes.map(formatTaskType).join(" · ");
});
const selectedHistoryTitle = computed(() => {
  if (!selectedHistory.value) return "当前创作";
  return formatHistoryTitle(selectedHistory.value);
});
const suggestionPrompts = computed(() => {
  if (isTextModel.value) {
    return [
      "写一段专业但不生硬的产品欢迎语，适合 AI 工作台首页。",
      "把一段普通介绍改写成更清晰、更有层次的产品说明。",
      "生成一个适合用户首次上手的 3 步操作引导。"
    ];
  }

  if (imagePreview.value) {
    return [
      "保留主体和构图，整体改成柔和自然光与高级浅色背景。",
      "提升材质细节和边缘质感，让画面更像专业商业拍摄。",
      "在不改变主体的前提下，增加更克制的色彩层次和空间感。"
    ];
  }

  return [
    "生成一张极简工作台场景海报，柔和光线，白灰配色，带高级产品质感。",
    "设计一张专业 AI 产品封面图，重点突出屏幕内容和干净背景。",
    "生成一张现代感插画风视觉，适合产品介绍页头图。"
  ];
});

onMounted(async () => {
  try {
    const response = await getCurrentUser();
    user.value = response.user;
  } catch {
    user.value = null;
  }

  await loadModels();
  await loadHistoryItems();

  try {
    const response = await getModelConfig();
    const model = availableModels.value.find((item) =>
      item.upstreamModelName === response.model || item.id === response.model
    );

    if (model) {
      selectModel(model.id);
      return;
    }

    if (availableModels.value.length > 0) {
      const imageModel = availableModels.value.find((item) =>
        item.taskTypes.includes("text_to_image")
      ) || availableModels.value[0];
      selectModel(imageModel.id);
    }
  } catch {
    if (availableModels.value.length > 0) {
      selectModel(availableModels.value[0].id);
    }
  }
});

onBeforeUnmount(() => {
  if (copyTimer !== null) {
    window.clearTimeout(copyTimer);
  }

  if (imagePreview.value) {
    URL.revokeObjectURL(imagePreview.value);
  }
});

async function loadModels() {
  try {
    const models = await getAvailableModels();
    availableModels.value = models.filter((model) => model.enabled);
  } catch (error) {
    console.error("加载模型列表失败:", error);
  }
}

async function loadHistoryItems() {
  historyLoading.value = true;
  historyError.value = "";

  try {
    historyItems.value = await getHistory();
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : "历史记录加载失败";
  } finally {
    historyLoading.value = false;
  }
}

function selectModel(modelId: string) {
  selectedModelId.value = modelId;
  selectedModel.value = availableModels.value.find((model) => model.id === modelId) || null;

  selectedHistory.value = null;
  resultUrls.value = [];
  textResult.value = "";
  generationError.value = "";
  copySuccess.value = false;

  if (isTextModel.value) {
    clearImage();
  }
}

async function openHistory(item: HistoryItem) {
  historyError.value = "";

  try {
    const detail = await getHistoryDetail(item.id);
    selectedHistory.value = detail;
    prompt.value = detail.prompt;
    textResult.value = detail.textResult;
    resultUrls.value = detail.resultUrls;
    generationError.value = "";
    copySuccess.value = false;

    const model = availableModels.value.find((availableModel) => availableModel.id === detail.modelId);
    if (model) {
      selectedModelId.value = model.id;
      selectedModel.value = model;
    }

    clearImagePreview();
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : "历史记录打开失败";
  }
}

function startNewGeneration() {
  selectedHistory.value = null;
  prompt.value = "";
  textResult.value = "";
  resultUrls.value = [];
  generationError.value = "";
  copySuccess.value = false;
  clearImage();
  promptInput.value?.focus();
}

function formatHistoryTitle(item: HistoryItem | HistoryDetail) {
  const text = item.prompt.trim().replace(/\s+/g, " ");
  return text.length > 28 ? `${text.slice(0, 28)}...` : text || "未命名记录";
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatHistoryType(taskType: string) {
  return taskType === "text_generation" ? "文本" : "图片";
}

function formatTaskType(taskType: string) {
  const labelMap: Record<string, string> = {
    text_generation: "文本生成",
    text_to_image: "文生图",
    image_edit: "图像编辑",
    image_variation: "图像变体"
  };

  return labelMap[taskType] ?? taskType;
}

function applySuggestion(suggestion: string) {
  prompt.value = prompt.value.trim() ? `${prompt.value.trim()}\n${suggestion}` : suggestion;
  promptInput.value?.focus();
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showCopySuccess();
  } catch (error) {
    console.error("复制失败:", error);

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    showCopySuccess();
  }
}

function showCopySuccess() {
  copySuccess.value = true;

  if (copyTimer !== null) {
    window.clearTimeout(copyTimer);
  }

  copyTimer = window.setTimeout(() => {
    copySuccess.value = false;
  }, 1800);
}

async function submitAuth() {
  authError.value = "";

  if (authMode.value === "register" && password.value !== confirmPassword.value) {
    authError.value = "两次输入的密码不一致";
    return;
  }

  authLoading.value = true;
  try {
    const response = authMode.value === "login"
      ? await login(username.value, password.value)
      : await register(username.value, password.value);

    user.value = response.user;
    await loadHistoryItems();
    username.value = "";
    password.value = "";
    confirmPassword.value = "";
  } catch (error) {
    authError.value = error instanceof Error ? error.message : "操作失败";
  } finally {
    authLoading.value = false;
  }
}

async function handleLogout() {
  await logout();
  user.value = null;
  prompt.value = "";
  textResult.value = "";
  generationError.value = "";
  resultUrls.value = [];
  historyItems.value = [];
  selectedHistory.value = null;
  copySuccess.value = false;
  clearImage();
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  imageFile.value = file;
  resultUrls.value = [];

  if (imagePreview.value) {
    URL.revokeObjectURL(imagePreview.value);
  }

  imagePreview.value = file ? URL.createObjectURL(file) : "";
}

function clearImage() {
  imageFile.value = null;
  resultUrls.value = [];
  clearImagePreview();
}

function clearImagePreview() {
  imageFile.value = null;
  if (imagePreview.value) {
    URL.revokeObjectURL(imagePreview.value);
  }

  imagePreview.value = "";

  if (fileInput.value) {
    fileInput.value.value = "";
  }
}

async function submitGeneration() {
  generationError.value = "";
  resultUrls.value = [];
  textResult.value = "";
  copySuccess.value = false;
  selectedHistory.value = null;

  if (!prompt.value.trim()) {
    generationError.value = isTextModel.value ? "请输入文本提示词" : "请输入图片修改提示词";
    return;
  }

  if (!selectedModel.value) {
    generationError.value = "请先选择一个模型";
    return;
  }

  generating.value = true;
  try {
    if (isTextModel.value) {
      const response = await generateText({
        modelId: selectedModelId.value,
        prompt: prompt.value,
        parameters: {}
      });

      const output = response.response?.outputText;
      if (output) {
        textResult.value = output;
      } else if (response.status === "failed") {
        const responseWithError = response.response as { error?: { message?: string } } | undefined;
        generationError.value = `文本生成失败：${responseWithError?.error?.message || "未知错误"}`;
      } else {
        textResult.value = "（模型未返回输出内容）";
      }
      await loadHistoryItems();
      if (response.historyId) {
        const history = historyItems.value.find((item) => item.id === response.historyId);
        if (history) {
          await openHistory(history);
        }
      }
    } else {
      const response = await generateImage({
        modelId: selectedModelId.value,
        image: imageFile.value,
        prompt: prompt.value,
        size: size.value,
        count: count.value
      });
      resultUrls.value = response.results.map((item) => item.url);
      await loadHistoryItems();
      if (response.historyId) {
        const history = historyItems.value.find((item) => item.id === response.historyId);
        if (history) {
          await openHistory(history);
        }
      }
    }
  } catch (error) {
    generationError.value = error instanceof Error
      ? error.message
      : (isTextModel.value ? "文本生成失败" : "图片生成失败");
  } finally {
    generating.value = false;
  }
}
</script>

<template>
  <main class="shell">
    <section v-if="!user" class="auth-panel">
      <div class="brand">
        <div class="brand-copy">
          <p class="eyebrow">Creative AI Workspace</p>
          <h1>极简图生图</h1>
          <p class="brand-lead">
            把登录、模型选择、图像生成和文本起草整合进一个更清晰的工作台，让创作流程保持专注、直接、专业。
          </p>
        </div>

        <div class="brand-grid">
          <article class="info-card">
            <span class="info-kicker">01</span>
            <h2>统一工作流</h2>
            <p>同一界面支持图片编辑与文本生成，减少来回切换的负担。</p>
          </article>
          <article class="info-card">
            <span class="info-kicker">02</span>
            <h2>更稳的节奏</h2>
            <p>从模型选择到结果查看，每个关键状态都更清楚、更有反馈。</p>
          </article>
          <article class="info-card">
            <span class="info-kicker">03</span>
            <h2>轻量但专业</h2>
            <p>用更克制的阴影、边框和间距，让界面质感更接近成熟 AI 产品。</p>
          </article>
        </div>
      </div>

      <form class="auth-card" @submit.prevent="submitAuth">
        <div class="card-header">
          <div>
            <p class="card-kicker">Account</p>
            <h2>{{ authTitle }}</h2>
          </div>
          <span class="status-dot" aria-hidden="true"></span>
        </div>

        <div class="tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            :class="{ active: authMode === 'login' }"
            @click="authMode = 'login'"
          >
            登录
          </button>
          <button
            type="button"
            :class="{ active: authMode === 'register' }"
            @click="authMode = 'register'"
          >
            注册
          </button>
        </div>

        <label>
          用户名
          <input v-model="username" autocomplete="username" placeholder="输入用户名" />
          <span class="field-hint">3-32 个字符，仅支持字母、数字、下划线和短横线</span>
        </label>

        <label>
          密码
          <input
            v-model="password"
            autocomplete="current-password"
            type="password"
            placeholder="输入密码"
          />
          <span class="field-hint">密码长度需为 8-72 个字符</span>
        </label>

        <label v-if="authMode === 'register'">
          确认密码
          <input
            v-model="confirmPassword"
            autocomplete="new-password"
            type="password"
            placeholder="再次输入密码"
          />
          <span class="field-hint">请再次输入相同密码，避免注册后无法登录</span>
        </label>

        <p v-if="authError" class="error">{{ authError }}</p>

        <button class="primary" type="submit" :disabled="authLoading">
          {{ authLoading ? "处理中..." : authSubmitText }}
        </button>
      </form>
    </section>

    <section v-else class="workspace">
      <header class="topbar">
        <div class="topbar-main">
          <p class="eyebrow">{{ workspaceEyebrow }}</p>
          <h1>{{ workspaceTitle }}</h1>
          <p class="topbar-description">{{ workspaceDescription }}</p>
        </div>

        <div class="session-card">
          <div class="session-user">
            <div class="avatar">{{ user.username.slice(0, 1).toUpperCase() }}</div>
            <div>
              <p class="card-kicker">当前账号</p>
              <strong>{{ user.username }}</strong>
            </div>
          </div>
          <button type="button" class="ghost" @click="handleLogout">退出</button>
        </div>
      </header>

      <section class="workspace-grid">
        <aside class="context-panel">
          <article class="panel-card panel-card-strong">
            <div class="card-header">
              <div>
                <p class="card-kicker">Model</p>
                <h2>当前模型</h2>
              </div>
              <span class="pill">{{ availableModels.length }} 可用</span>
            </div>

            <label class="model-selector" for="model-select">
              <span class="model-label">选择模型</span>
              <select
                id="model-select"
                v-model="selectedModelId"
                class="model-dropdown"
                @change="selectModel(selectedModelId)"
              >
                <option v-for="model in availableModels" :key="model.id" :value="model.id">
                  {{ model.displayName }} ({{ model.providerName }})
                  {{ model.taskTypes.includes('text_generation') && !model.taskTypes.includes('text_to_image') ? ' [文本]' : '' }}
                </option>
              </select>
            </label>

            <p class="model-info">{{ modelTaskSummary }}</p>
          </article>

          <article class="panel-card history-panel">
            <div class="card-header">
              <div>
                <p class="card-kicker">History</p>
                <h2>历史记录</h2>
              </div>
              <button type="button" class="ghost compact-button" @click="startNewGeneration">
                新建
              </button>
            </div>

            <p class="model-info">{{ historyTitle }}</p>
            <p v-if="historyError" class="error">{{ historyError }}</p>

            <div v-if="historyItems.length" class="history-list">
              <button
                v-for="item in historyItems"
                :key="item.id"
                type="button"
                class="history-item"
                :class="{ active: selectedHistory?.id === item.id }"
                @click="openHistory(item)"
              >
                <span class="history-type">{{ formatHistoryType(item.taskType) }}</span>
                <span class="history-main">
                  <strong>{{ formatHistoryTitle(item) }}</strong>
                  <small>{{ item.modelName }} · {{ formatHistoryTime(item.createdAt) }}</small>
                </span>
              </button>
            </div>
          </article>

          <section v-if="hasResults" class="result-panel result-panel-side">
            <div class="result-header">
              <div>
                <p class="card-kicker">Results</p>
                <h3>{{ selectedHistoryTitle }}</h3>
              </div>
              <button
                v-if="isTextModel && textResult"
                type="button"
                class="copy-button"
                @click="copyToClipboard(textResult)"
              >
                {{ copySuccess ? "已复制" : "复制文本" }}
              </button>
            </div>

            <div v-if="isTextModel && textResult" class="text-result-inline">
              <div class="text-content">{{ textResult }}</div>
            </div>

            <div v-else-if="resultUrls.length" class="result-gallery">
              <figure v-for="url in resultUrls" :key="url" class="result-card">
                <img :src="url" alt="生成结果" />
                <a class="download" :href="url" download>下载图片</a>
              </figure>
            </div>
          </section>

          <section v-else-if="generating" class="empty-state result-panel-side result-panel-loading">
            <div class="empty-illustration">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <h3>{{ isTextModel ? "文本生成中" : "图片生成中" }}</h3>
            <p>
              {{ isTextModel ? "结果生成后会自动出现在这里，方便继续复制或查看。" : "图片生成后会自动出现在这里，方便继续预览和下载。" }}
            </p>
          </section>

          <section v-else class="empty-state result-panel-side">
            <div class="empty-illustration">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <h3>结果区已准备好</h3>
            <p>
              {{ isTextModel ? "输入提示词后即可生成文本，结果会保留在这里便于复制。" : "上传参考图或直接输入描述，生成后的图片会在这里集中展示。" }}
            </p>
          </section>
        </aside>

        <section class="chat-stage">
            <div class="stage-heading">
              <div>
                <p class="card-kicker">Compose</p>
              <h2>{{ selectedHistory ? "查看历史对话" : "开始一次新的生成" }}</h2>
            </div>
            <p>{{ resultSummary }}</p>
          </div>

          <form class="composer" @submit.prevent="submitGeneration">
            <div v-if="isImageModel && imagePreview" class="composer-preview">
              <img :src="imagePreview" alt="原图预览" />
              <button type="button" class="remove-image" aria-label="移除图片" @click="clearImage">
                ×
              </button>
            </div>

            <textarea
              ref="promptInput"
              v-model="prompt"
              class="composer-input"
              rows="5"
              :placeholder="promptPlaceholder"
            />

            <p v-if="generationError" class="error">{{ generationError }}</p>

            <div class="composer-toolbar">
              <div class="tool-cluster">
                <label v-if="isImageModel" class="upload-action" title="上传图片">
                  <input
                    ref="fileInput"
                    accept="image/png,image/jpeg,image/webp"
                    type="file"
                    @change="onFileChange"
                  />
                  <span class="plus">+</span>
                  <span>上传图片</span>
                </label>

                <label v-if="isImageModel" class="tool-select">
                  <span>尺寸</span>
                  <select v-model="size" aria-label="图片尺寸">
                    <option value="1024x1024">1024 x 1024</option>
                    <option value="1024x1536">1024 x 1536</option>
                    <option value="1536x1024">1536 x 1024</option>
                    <option value="auto">自动</option>
                  </select>
                </label>

                <label v-if="isImageModel" class="tool-count">
                  <span>数量</span>
                  <input v-model.number="count" aria-label="生成数量" max="4" min="1" type="number" />
                </label>

                <span v-if="isTextModel" class="text-mode-hint">文本生成模式</span>
              </div>

              <button
                class="send-button"
                type="submit"
                :disabled="generating"
                :aria-label="isTextModel ? '生成文本' : '生成图片'"
              >
                {{ generating ? "…" : "↑" }}
              </button>
            </div>
          </form>

          <div class="suggestion-row">
            <button
              v-for="suggestion in suggestionPrompts"
              :key="suggestion"
              type="button"
              class="suggestion-chip"
              @click="applySuggestion(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>

          <div v-if="generating" class="generation-status">
            <span class="status-pulse" aria-hidden="true"></span>
            {{ generationStatusText }}
          </div>
        </section>
      </section>
    </section>
  </main>
</template>
