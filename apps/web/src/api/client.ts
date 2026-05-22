export type User = {
  id: number;
  username: string;
};

export type AuthResponse = {
  user: User;
};

export type GenerateResponse = {
  historyId?: number;
  results: Array<{
    url: string;
  }>;
};

export type ModelConfigResponse = {
  model: string;
};

export type ModelInfo = {
  id: string;
  providerId: string;
  providerName: string;
  displayName: string;
  upstreamModelName: string;
  taskTypes: string[];
  enabled: boolean;
};

export type TextGenerationResponse = {
  status: string;
  historyId?: number;
  response: {
    outputText?: string;
    status: string;
    model: string;
    usage?: Record<string, unknown>;
  };
};

export type HistoryItem = {
  id: number;
  modelId: string;
  modelName: string;
  taskType: string;
  prompt: string;
  sourceUrl: string;
  textResult: string;
  imageCount: number;
  resultUrls: string[];
  createdAt: string;
  updatedAt: string;
};

export type HistoryDetail = HistoryItem & {
  images: Array<{
    id: number;
    sourceUrl: string;
    resultUrl: string;
    createdAt: string;
  }>;
};

const apiBase = "/api";

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "请求失败" }));
    throw new Error(body.message ?? "请求失败");
  }

  return response.json() as Promise<T>;
}

export function getCurrentUser() {
  return request<AuthResponse>("/auth/me");
}

export function login(username: string, password: string) {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export function register(username: string, password: string) {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export function logout() {
  return request<{ ok: boolean }>("/auth/logout", {
    method: "POST"
  });
}

export function getModelConfig() {
  return request<ModelConfigResponse>("/config/model");
}

export function getAvailableModels() {
  return request<ModelInfo[]>("/model-gateway/models");
}

export function getHistory() {
  return request<HistoryItem[]>("/history");
}

export function getHistoryDetail(id: number) {
  return request<HistoryDetail>(`/history/${id}`);
}

export async function generateText(input: {
  modelId: string;
  prompt: string;
  parameters?: Record<string, unknown>;
}) {
  return request<TextGenerationResponse>("/history/text", {
    method: "POST",
    body: JSON.stringify({
      modelId: input.modelId,
      prompt: input.prompt,
      parameters: input.parameters || {}
    })
  });
}

export async function generateImage(input: {
  modelId: string;
  image?: File | null;
  prompt: string;
  size: string;
  count: number;
}) {
  const formData = new FormData();
  if (input.image) {
    formData.append("image", input.image);
  }
  formData.append("modelId", input.modelId);
  formData.append("prompt", input.prompt);
  formData.append("size", input.size);
  formData.append("count", String(input.count));

  const response = await fetch(`${apiBase}/images/generate`, {
    method: "POST",
    credentials: "include",
    body: formData
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "图片生成失败" }));
    throw new Error(body.message ?? "图片生成失败");
  }

  return response.json() as Promise<GenerateResponse>;
}
