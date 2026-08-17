/**
 * AI 对话服务（主进程）
 *
 * - 持有 AIClient（由 store 中的 provider 配置构建）
 * - 提供预设 provider 清单、配置读写（Key 存 store，可后续迁移 Keychain）
 * - 流式对话：增量文本经回调推送给渲染层
 * - 桌宠人设系统提示 + 心情注入
 */
import {
  AIClient,
  AI_PROVIDER_PRESETS,
  type AIProviderConfig,
  type AIProviderPreset,
  type ChatMessage
} from '@desktop-helper/core';
import { safeStorage } from 'electron';
import type { JsonStore } from './store.service';
import { RealtimeRetrieval, isWeatherQuery, type SearchConfig } from './web-tools';

interface AIStoreShape {
  ai: {
    providerId: string;
    /** API Key 加密存储（safeStorage，macOS 走 Keychain） */
    apiKeyEnc: string;
    model?: string;
    baseURL?: string;
    systemPrompt?: string;
    /** 对话历史（按 mode 隔离：pet 桌宠闲聊 / assistant 信息查询） */
    history: { role: 'user' | 'assistant'; content: string; mode: ChatMode }[];
  };
}

/** 对话模式：pet = 桌宠闲聊（气泡）；assistant = 信息查询助手（聊天窗） */
export type ChatMode = 'pet' | 'assistant';

const DEFAULT_SYSTEM_PROMPT =
  '你是一只名叫"皮丘"的桌面宠物（皮卡丘家族的电系小老鼠，Pichu），性格活泼可爱、有点贪吃。' +
  '你在用户的桌面上陪伴用户工作学习。请用简短、俏皮、有宠物感的中文回复（一般不超过 3 句话），' +
  '可以偶尔关心用户的状态。不要提及你是 AI 模型或大语言模型，你就是一个桌宠。';

/** 信息查询助手人设（右键聊天框）：专业、准确、详尽 */
const ASSISTANT_SYSTEM_PROMPT =
  '你是运行在用户桌面上的「信息查询助手」，用户可以向你查询任何信息（知识、事实、数据、解释、方案、计算等）。' +
  '回答要求：准确、清晰、结构清晰（可分段/列表）；涉及不确定的信息要如实说明；中文回答。' +
  '不要提及你是大语言模型；你就是一个可靠的桌面信息助手。';

const DEFAULT_AI: AIStoreShape['ai'] = {
  providerId: 'glm',
  apiKeyEnc: '',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  history: []
};

/** 保留最近 N 轮上下文 */
const HISTORY_LIMIT = 10;

export class AIService {
  private client: AIClient;
  private readonly config: AIStoreShape['ai'];
  /** 实时检索（天气/搜索） */
  private readonly retrieval: RealtimeRetrieval;

  /** 流式回调（携带模式：pet 桌宠闲聊 → 气泡窗；assistant 信息查询 → 仅聊天窗） */
  onChunk: ((chunk: { text: string; done: boolean }, mode: ChatMode) => void) | null = null;

  constructor(private readonly store: JsonStore<AIStoreShape>) {
    const saved = store.get('ai');
    this.config = { ...DEFAULT_AI, ...saved };
    this.client = this.buildClient();
    this.retrieval = new RealtimeRetrieval(store as unknown as JsonStore<{ search: SearchConfig }>);
  }

  /** 由配置构建 AIClient（预设 + 覆盖） */
  private buildClient(): AIClient {
    const preset = AI_PROVIDER_PRESETS.find((p) => p.id === this.config.providerId);
    const cfg: AIProviderConfig = {
      id: this.config.providerId,
      label: preset?.label ?? this.config.providerId,
      baseURL: this.config.baseURL || preset?.baseURL || '',
      apiKey: this.getPlainKey(),
      model: this.config.model || preset?.model || ''
    };
    return new AIClient(cfg);
  }

  /**
   * 获取明文 Key。
   * 说明：Key 改为明文存储（safeStorage 在未签名开发模式重启后解密不可靠，导致持久化失效）；
   * 正式签名打包后可恢复加密。兼容旧数据：enc:(密文) / b64:(降级) / 纯明文。
   */
  private getPlainKey(): string {
    const stored = this.config.apiKeyEnc;
    if (!stored) {
      const legacy = (this.config as unknown as { apiKey?: string }).apiKey;
      return legacy ?? '';
    }
    if (stored.startsWith('b64:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf8');
    }
    if (stored.startsWith('enc:')) {
      try {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
      } catch {
        return ''; // 旧密文无法解密（钥匙串状态变化）
      }
    }
    return stored; // 明文（当前格式）
  }

  /** 明文存储 Key（可靠性优先） */
  private setKey(plainKey: string): void {
    this.config.apiKeyEnc = plainKey ?? '';
  }

  // ---------- 配置 ----------

  getPresets(): AIProviderPreset[] {
    return AI_PROVIDER_PRESETS;
  }

  getConfig(): Pick<AIStoreShape['ai'], 'providerId' | 'model' | 'baseURL' | 'systemPrompt'> & { apiKey: string } {
    return {
      providerId: this.config.providerId,
      model: this.config.model,
      baseURL: this.config.baseURL,
      systemPrompt: this.config.systemPrompt,
      apiKey: this.getPlainKey() ? '***' : ''
    };
  }

  setConfig(patch: Partial<Pick<AIStoreShape['ai'], 'providerId' | 'apiKeyEnc' | 'model' | 'baseURL' | 'systemPrompt'>> & { apiKey?: string }): void {
    if (patch.providerId !== undefined) this.config.providerId = patch.providerId;
    if (patch.apiKey !== undefined) this.setKey(patch.apiKey);
    if (patch.model !== undefined) this.config.model = patch.model;
    if (patch.baseURL !== undefined) this.config.baseURL = patch.baseURL;
    if (patch.systemPrompt !== undefined) this.config.systemPrompt = patch.systemPrompt;
    this.persist();
    this.client = this.buildClient();
  }

  /** 当前是否已配置可用（云端需 key，本地/局域网无需） */
  isReady(): boolean {
    if (this.config.providerId === 'custom') {
      // 自定义：局域网自部署，只需网关地址 + 模型名
      return Boolean(this.config.baseURL && this.config.model);
    }
    const preset = AI_PROVIDER_PRESETS.find((p) => p.id === this.config.providerId);
    if (preset && !preset.requiresKey) return true;
    return Boolean(this.getPlainKey());
  }

  /** 对话历史轮数（调试/验证用） */
  getHistoryLength(): number {
    return this.config.history.length;
  }

  private persist(): void {
    this.store.set('ai', this.config);
  }

  // ---------- 对话 ----------

  clearHistory(): void {
    this.config.history = [];
    this.persist();
  }

  /**
   * 移除最近 n 条历史（供一次性工具调用如"待办 AI 分析"完成后清理，避免污染正式对话）。
   * n 会被钳制到 [0, history.length]；为 0 时不做任何写盘。
   */
  popHistory(n: number): void {
    const count = Math.max(0, Math.min(Math.trunc(Number(n) || 0), this.config.history.length));
    if (count === 0) return;
    this.config.history = this.config.history.slice(0, this.config.history.length - count);
    this.persist();
  }

  /** 按模式取历史 */
  private historyFor(mode: ChatMode): { role: 'user' | 'assistant'; content: string }[] {
    return this.config.history.filter((h) => h.mode === mode);
  }

  /**
   * 流式对话：发送用户消息，流式产出回复；完整回复追加进对应模式的历史。
   * 查询时自动实时检索（天气/网页）注入上下文，回答更准确、支持实时信息。
   * @param mode 'pet' 桌宠闲聊（气泡）｜'assistant' 信息查询（聊天窗）
   */
  async chatStream(
    userMessage: string,
    opts: { mode?: ChatMode; moodHint?: string } = {}
  ): Promise<void> {
    const mode = opts.mode ?? 'pet';
    // 实时检索：查询助手模式全量检索；桌宠模式仅含天气词时查天气
    let context = '';
    try {
      if (mode === 'assistant') {
        context = await this.retrieval.retrieve(userMessage);
      } else if (isWeatherQuery(userMessage)) {
        context = await this.retrieval.retrieve(userMessage);
      }
    } catch (err) {
      context = `【实时检索失败】${err instanceof Error ? err.message : String(err)}`;
    }

    const messages = this.buildMessages(userMessage, mode, opts.moodHint, context);
    // 追加用户消息（带模式）
    this.config.history.push({ role: 'user', content: userMessage, mode });
    this.trimHistory();

    let reply = '';
    try {
      for await (const chunk of this.client.streamChat({
        messages,
        temperature: mode === 'assistant' ? 0.5 : 0.8,
        maxTokens: mode === 'assistant' ? 1500 : 500
      })) {
        if (chunk.done) break;
        reply += chunk.text;
        this.onChunk?.({ text: chunk.text, done: false }, mode);
      }
    } catch (err) {
      this.config.history.pop(); // 失败回滚用户消息
      this.persist();
      throw err;
    }

    if (reply.trim()) {
      this.config.history.push({ role: 'assistant', content: reply, mode });
      this.trimHistory();
    }
    this.persist();
    this.onChunk?.({ text: '', done: true }, mode);
  }

  private buildMessages(
    userMessage: string,
    mode: ChatMode,
    moodHint?: string,
    realtimeContext = ''
  ): ChatMessage[] {
    const sys =
      mode === 'assistant'
        ? ASSISTANT_SYSTEM_PROMPT
        : this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const moodLine = moodHint ? `\n（用户当前心情：${moodHint}，回复时可适度呼应）` : '';
    const realtime = realtimeContext
      ? `\n\n【实时信息（用户查询时实时检索所得，请优先据此回答）】\n${realtimeContext}`
      : '';
    const messages: ChatMessage[] = [{ role: 'system', content: sys + moodLine + realtime }];
    for (const h of this.historyFor(mode)) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: userMessage });
    return messages;
  }

  // ---------- 实时检索配置 ----------

  getSearchConfig(): SearchConfig {
    return this.retrieval.getSearchConfig();
  }

  setSearchConfig(patch: Partial<SearchConfig>): void {
    this.retrieval.setSearchConfig(patch);
  }

  hasSearch(): boolean {
    return this.retrieval.hasSearch();
  }

  private trimHistory(): void {
    if (this.config.history.length > HISTORY_LIMIT * 2) {
      this.config.history = this.config.history.slice(-HISTORY_LIMIT * 2);
    }
  }
}
