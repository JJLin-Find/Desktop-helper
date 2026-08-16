/**
 * AI 对话客户端（OpenAI 兼容协议封装）
 *
 * 设计：
 * - 单一 OpenAI 兼容封装支持所有 provider（GLM/豆包/DeepSeek/硅基流动/本地 Ollama…），
 *   通过 baseURL + apiKey + model 三要素切换，云/本地无缝；
 * - 流式（SSE /chat/completions）与非流式对话；
 * - 零依赖：仅用 Node 18+/Web 标准 fetch 与 AbortSignal；
 * - 纯逻辑，可在主进程/测试环境运行。
 */

export interface AIProviderConfig {
  /** provider id，如 'glm' | 'doubao' | 'deepseek' | 'siliconflow' | 'ollama' */
  id: string;
  label: string;
  /** OpenAI 兼容 base URL（不含 /chat/completions） */
  baseURL: string;
  /** API key；本地模型（Ollama）可为空 */
  apiKey?: string;
  /** 模型名（Ollama 为本地模型 tag） */
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 取消（AbortController） */
  signal?: AbortSignal;
}

export interface ChatStreamChunk {
  text: string;
  done: boolean;
}

export interface AIProviderPreset extends AIProviderConfig {
  /** 该 provider 是否需要 key（本地模型 false） */
  requiresKey: boolean;
  /** key 获取说明（引导用户） */
  keyHint?: string;
}

/** 预设 provider 清单（key 留空，由用户在设置中填写） */
export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: 'glm',
    label: '智谱 GLM（完全免费）',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash-250414',
    requiresKey: true,
    keyHint: 'open.bigmodel.cn 手机号注册 → API Keys 创建（免费模型无需充值）；GLM-4-Flash 官方完全免费'
  },
  {
    id: 'doubao',
    label: '豆包（火山方舟）',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1.6-flash-250915',
    requiresKey: true,
    keyHint: '火山引擎控制台 → 方舟 → API Key（需实名认证）；新用户有赠送 token，之后按量计费'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    requiresKey: true,
    keyHint: 'platform.deepseek.com 获取 API Key（按量付费，无免费层）'
  },
  {
    id: 'siliconflow',
    label: '硅基流动（免费模型）',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    requiresKey: true,
    keyHint: 'siliconflow.cn 注册获取 Key，部分模型免费'
  },
  {
    id: 'ollama',
    label: '本地 Ollama（免费离线）',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:3b',
    requiresKey: false,
    keyHint: '本地安装 Ollama 并拉取模型：ollama pull qwen2.5:3b；零 token 消耗'
  },
  {
    id: 'custom',
    label: '自定义（局域网/自部署模型）',
    baseURL: '',
    model: '',
    requiresKey: false,
    keyHint: '公司/组织内网自部署的开源模型（vLLM / Ollama / llama.cpp 等 OpenAI 兼容网关）：填写网关地址 baseURL 与模型名；内网无鉴权可不填 Key'
  }
];

export class AIClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly providerId?: string
  ) {
    super(message);
    this.name = 'AIClientError';
  }
}

export class AIClient {
  constructor(private config: AIProviderConfig) {}

  getConfig(): AIProviderConfig {
    return { ...this.config };
  }

  setConfig(config: AIProviderConfig): void {
    this.config = { ...config };
  }

  get chatUrl(): string {
    return `${this.config.baseURL.replace(/\/+$/, '')}/chat/completions`;
  }

  /** 流式对话：逐段产出文本，最后产出 { done: true } */
  async *streamChat(options: ChatOptions): AsyncGenerator<ChatStreamChunk> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: options.messages,
      stream: true,
      temperature: options.temperature ?? 0.7
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;

    // 超时兜底（30s），避免 API 挂起导致对话卡死
    const timeoutSignal = AbortSignal.timeout(30_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    const resp = await fetch(this.chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new AIClientError(
        `AI 请求失败（HTTP ${resp.status}）: ${errText.slice(0, 200)}`,
        resp.status,
        this.config.id
      );
    }
    if (!resp.body) throw new AIClientError('响应无流', undefined, this.config.id);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            yield { text: '', done: true };
            return;
          }
          try {
            const json = JSON.parse(data) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield { text: delta, done: false };
          } catch {
            // 忽略无法解析的行（心跳等）
          }
        }
      }
      yield { text: '', done: true };
    } finally {
      reader.releaseLock();
    }
  }

  /** 非流式对话 */
  async chat(options: ChatOptions): Promise<string> {
    let full = '';
    for await (const chunk of this.streamChat(options)) {
      full += chunk.text;
    }
    return full;
  }
}
