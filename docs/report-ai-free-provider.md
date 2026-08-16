# 桌面宠应用 AI 对话免费接入调研报告

> 调研时间：2026 年初（基于 2025–2026 公开资料，部分政策/价格会变动，落地前请以各平台官方控制台与文档为准）
> 背景：macOS 桌宠应用（Electron + Node.js 主进程）需要接入 AI 对话能力。硬性约束：**免费为主、不持续消耗 token**；候选为豆包、DeepSeek；同时评估其他免费/本地方案。
> 结论速览：**主推智谱 GLM-4-Flash（GLM-4-Flash-250414）——官方完全免费 + 国内直连 + OpenAI 兼容，验证通过；本地 Ollama 作为零成本兜底**。

---

## 1. 候选对比总表

| Provider | 免费情况 | 免费额度/限制 | OpenAI 兼容 base URL | 推荐模型名 | API Key 获取 | 国内直连 |
|---|---|---|---|---|---|---|
| **智谱 GLM-4-Flash** ⭐ | ✅ **官方完全免费**（不收费、无需充值） | 免费但有限速（RPM/TPM，个人聊天足够，可申请提额） | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash-250414`（另有 `glm-4-flash`、`glm-4-flash-thinking-250414` 思考版） | 智谱开放平台 open.bigmodel.cn 手机号注册 → 创建 API Key（免费模型无需充值） | ✅ 直连 |
| **豆包 / 火山方舟** | 新用户赠送 token（活动额度，常见几十万~百万级，限时）；部分模型活动期 0 元/每日免费额度 | 送完按量计费；性价比高（doubao-seed-1.6-flash 约 输入¥0.3/百万、输出¥0.6/百万，2025-09 发布价） | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-1.6-flash-250915` 等（也支持推理接入点 `ep-xxx`） | 火山引擎控制台 → 方舟 → API Key 管理；**需个人实名认证** | ✅ 直连 |
| **DeepSeek 官方 API** | ❌ 按量付费，**不免费**（2025-09 涨价并取消夜间优惠） | deepseek-chat 约 输入 $0.28/百万(未命中) / $0.028(命中)、输出 $0.42/百万（V3.2 非思考，以官方定价页为准） | `https://api.deepseek.com/v1`（或 `/chat/completions`） | `deepseek-chat` / `deepseek-reasoner` | platform.deepseek.com 注册，充值后使用 | ✅ 直连 |
| **DeepSeek 网页版逆向** | ✅ 网页免费聊天（借账号） | 依赖网页 session + PoW 验证，随时失效 | 第三方库本地起服务（见下文） | 网页版模型 | 用自己的 chat.deepseek.com 登录态，**不生成官方 API key** | ✅ 直连 |
| **硅基流动 SiliconFlow** | ✅ 多款免费模型（Qwen2.5-7B/72B 等）；历史新用户赠 2000 万 tokens 体验金 | 免费模型有限速；**免费列表政策变动频繁**，部分需实名/账户有余额 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct`、`Qwen/Qwen2.5-72B-Instruct` 等 | siliconflow.cn 注册 → API 密钥；免费模型以控制台「模型广场」实时列表为准 | ✅ 直连 |
| **Groq** | ✅ 免费层 | 限额较紧（模型而异，常见约 15–30 RPM / 150 RPD 级别） | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile`、`qwen-2.5-32b` 等 | console.groq.com 注册（海外邮箱/条件） | ⚠️ 一般可访问，稳定性视网络 |
| **OpenRouter** | ✅ `:free` 免费模型（含 `deepseek/deepseek-r1:free`、`google/gemini-2.0-flash-exp:free` 等） | 免费层限额（2025 年调低后约 20 RPM / 50 请求/天） | `https://openrouter.ai/api/v1` | `deepseek/deepseek-r1:free`、`deepseek/deepseek-chat:free` | openrouter.ai 免费注册领 key（部分免费模型需绑卡或充少量余额） | ❌ 被墙，需代理 |
| **Google Gemini API** | ✅ 免费层（gemini-2.5-flash / 2.0-flash 等，RPM/RPD 限额） | 免费层限额有限（如 2.5-flash 约 10 RPM / 250 RPD 级） | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash` | aistudio.google.com 免费申请 API key | ❌ 被墙，需代理 |
| **Cohere** | ✅ 免费试用 key（限速） | 免费层收紧，限速明显 | `https://api.cohere.com/v2/compat/openai` | `command-r-plus` 等 | dashboard.cohere.com 注册 | ❌ 需代理，不推荐 |
| **本地 Ollama**（Apple Silicon） | ✅ **完全免费 + 离线**，不消耗任何云端 token | 受限于本机内存/算力；对话质量低于云端大模型 | `http://localhost:11434/v1` | `qwen2.5:3b`、`qwen2.5:7b`、`llama3.2:3b`、`qwen3:4b` | 无需 key（apiKey 填任意值如 `ollama`） | ✅ 本地无网络依赖 |

---

## 2. 各候选详细调研

### 2.1 智谱 GLM-4-Flash（⭐ 主推，验证通过）

- **免费政策**：智谱自 2024-08 宣布 GLM-4-Flash API 免费向公众开放；2025-04 上线的升级版 `GLM-4-Flash-250414` 延续免费策略，**免费模型无需充值、不消耗余额**。另有免费的 `glm-4-flash-thinking-250414`（思考版）、`glm-4v-flash`（视觉版）、`embedding-3`（向量）等。参考：[GLM-4-Flash 免费公告](https://www.letsclouds.com/news?keyword=%E5%A4%A7%E6%A8%A1%E5%9E%8BAPI%E6%8A%80%E6%9C%AF)、[OpenClaw 配置 GLM-4-Flash 完全免费指南](https://www.php.cn/faq/2745587.html)、[智谱免费 API 汇总（yangmao.ai）](https://yangmao.ai/zh/providers/zhipu/free-api/)
- **接入方式**：OpenAI 兼容。`POST https://open.bigmodel.cn/api/paas/v4/chat/completions`，请求体/鉴权与 OpenAI 一致（`Authorization: Bearer <key>`），支持 `stream: true`。
- **API Key 获取**：智谱开放平台（open.bigmodel.cn / bigmodel.cn）用手机号注册 → 控制台「API Keys」创建密钥 → 直接使用，**免费模型无需绑卡/充值**。
- **额度限制**：免费模型设有速率上限（每分钟请求数/每分钟 token 数，具体数值随账号状态变化），对桌宠聊天场景足够；量大可在控制台申请提额。
- **国内直连**：✅ 官方国内服务，无需代理。

> ✅ **验证结论：GLM-4-Flash 完全满足"完全免费 + 国内可直连 + OpenAI 兼容"三项硬性要求，作为主推。**

### 2.2 豆包（火山引擎方舟 Doubao API）

- **免费现状**：新用户注册有赠送 token 的试用活动（常见几十万到百万级 token，**限时/限额度**，送完即按量计费）；部分历史活动（如 doubao-1.5-lite、doubao-1.5-pro 的每日免费额度）存在过 **0 元定价 / 每日免费额度**，但属运营活动，**非长期承诺**。参考：[火山方舟与豆包产品页](https://www.volcengine.com/product/doubao)、[OpenClaw 配置豆包每日免费额度实战](https://www.php.cn/faq/2744304.html)、[豆包 API 价格解析](https://www.php.cn/faq/1370331.html)
- **按量价格**（赠送耗尽后）：性价比高，2025-09 发布的 doubao-seed-1.6 系列，flash 版本约 输入 ¥0.3/百万、输出 ¥0.6/百万（具体以控制台定价为准）。
- **OpenAI 兼容性**：✅ 方舟提供 OpenAI 兼容接口 `https://ark.cn-beijing.volces.com/api/v3`；模型名即"推理接入点"：可填模型 ID（如 `doubao-seed-1.6-flash-250915`）或自定义接入点 `ep-xxxx`。
- **注册流程**：火山引擎控制台（console.volcengine.com）→ 开通方舟 → **个人实名认证** → 创建 API Key。⚠️ 实名认证是门槛。
- **国内直连**：✅。

### 2.3 DeepSeek

#### 官方 API —— 不免费
- DeepSeek 官方 API 为**按量付费**，无免费层：2025-02 曾推出夜间错峰优惠，**2025-09 宣布涨价并取消夜间优惠**（参考：[DeepSeek 宣布涨价并取消夜间时段优惠](https://news.ycwb.com/ikinvkctij/content_53620251.htm)、[DeepSeek 下调夜间 API 价格（2025-02）](https://www.iotworld.com.cn/html/News/202502/909c3c9d76ea0659.shtml)、[deepseek-chat 定价与模型信息](https://llm-stats.com/models/deepseek-chat?tab=api)）。当前约：`deepseek-chat`（V3.2 非思考）输入 $0.28/百万（缓存未命中）/ $0.028（命中）、输出 $0.42/百万；`deepseek-reasoner`（R1 思考）更贵。**不满足"免费"要求**，只能作为按量备选。
- 国内直连 ✅；OpenAI 兼容 base：`https://api.deepseek.com/v1`。

#### 网页版逆向接口 —— 免费但高风险 ⚠️
- 社区有多个把 chat.deepseek.com 网页端（免费聊天）转成 OpenAI 兼容 API 的开源项目：
  - [Fly143/deepseek-free-api](https://github.com/Fly143/deepseek-free-api)：支持 OpenAI + Anthropic 两种兼容格式、Function Calling、**PoW 自动求解、token 自动刷新**，是目前较活跃的一个。
  - [smkttl/deepseek-api](https://github.com/smkttl/deepseek-api)、[rabilrbl/deepseek-api](https://github.com/rabilrbl/deepseek-api)：早期 wrapper。
  - [sums001/Deepseek-API](https://github.com/sums001/Deepseek-API)：自称无需 key、无需计费的逆向 REST 接口。
- **稳定性与合规风险（需明确告知用户）**：
  - 依赖网页端登录态（cookie/access token）与 **PoW 工作量验证**，DeepSeek 随时改协议即失效；官方持续加固反爬。
  - 违反 chat.deepseek.com 服务条款（禁止自动化调用），**账号存在封禁风险**。
  - 非官方、无 SLA，不适用于对稳定性有要求的桌面应用；**不建议作为正式方案**，仅可作一次性尝鲜/实验。若坚持用，应做成"可选高级功能"并免责声明。

### 2.4 其他完全免费（可商用性不一）的 provider

- **硅基流动 SiliconFlow**：国内平台、直连 ✅、OpenAI 兼容（`https://api.siliconflow.cn/v1`）。免费模型如 `Qwen/Qwen2.5-7B-Instruct`、`Qwen/Qwen2.5-72B-Instruct` 等，历史新用户曾赠 2000 万 tokens 体验金（约 ¥14）。⚠️ **免费模型清单政策变动频繁**，且 2025 年起部分模型要求实名或账户有余额，落地前以[官方文档](https://docs.siliconflow.cn/cn/userguide/introduction)与控制台「模型广场」为准。
- **Groq**：免费层 ✅（无需绑卡），推理速度极快；模型以开源为主（llama-3.3-70b、qwen-2.5-32b、deepseek-r1-distill 等）。限额较紧（约 15–30 RPM / 150 RPD 级别，模型而异）。OpenAI 兼容 `https://api.groq.com/openai/v1`。国内一般可访问，注册需海外条件。
- **OpenRouter**：`:free` 后缀免费模型（含 `deepseek/deepseek-r1:free`、`google/gemini-2.0-flash-exp:free`、`qwen/qwen-2.5-72b-instruct:free` 等），一个 key 试遍多模型。⚠️ 2025 年免费层限额调低（约 20 RPM / 50 请求/天），且**国内被墙需代理**。参考：[OpenRouter 免费模型限制讨论](https://linux.do/t/topic/619828/7)。
- **Google Gemini API**：官方免费层存在（gemini-2.5-flash / 2.0-flash 等，RPM/RPD 限额），有 OpenAI 兼容端点 `https://generativelanguage.googleapis.com/v1beta/openai/`。⚠️ **国内被墙需代理**；社区有第三方 Deno 代理方案（如 [trueai-org/gemini](https://github.com/trueai-org/gemini)）但属第三方中转，不建议商用依赖。
- **Cohere**：免费试用 key 限速明显、免费层收紧，国内需代理，**不推荐**。

### 2.5 本地模型（Ollama）—— 零成本兜底

- **接入成本极低**：Ollama 一键安装（`brew install ollama` 或官网 dmg），Apple Silicon 原生 Metal 加速；安装后 `ollama run qwen2.5:3b` 即可。
- **推荐小模型与内存占用**（统一内存，模型+系统共占用）：
  - `qwen2.5:3b`：约 1.9GB，8GB 内存 Mac 可流畅运行——**桌宠常驻场景首选**。
  - `qwen2.5:7b`：约 4.7GB，建议 16GB 内存。
  - `llama3.2:3b` / `llama3.2:1b`：约 2.0GB / 1.3GB，轻量备选。
  - `qwen3:4b` / `qwen3:8b`（2025 年新系列）：新一代，4B 级可作 3B 的升级项。
- **OpenAI 兼容**：✅ Ollama 原生提供 `/v1/chat/completions`（`http://localhost:11434/v1`），与 OpenAI SDK/封装完全同构，apiKey 随便填（如 `ollama`）。参考：[Ollama 官方 OpenAI 兼容文档](https://github.com/ollama/ollama/blob/main/docs/openai.md)、[Ollama 模型库 qwen2.5](https://ollama.com/library/qwen2.5)。
- **优缺点**：完全免费、离线、隐私、无网络/无被封风险；代价是对话质量低于云端大模型、常驻内存 2–5GB、无流式以外的额外能力。**适合作为断网/免费兜底层**。

---

## 3. 推荐结论

### 🥇 主推：智谱 GLM-4-Flash（`glm-4-flash-250414`）
验证通过，三项硬性要求全部满足：
1. **完全免费**：官方政策免费、无需充值、不消耗余额；
2. **国内直连**：无需代理，稳定；
3. **OpenAI 兼容**：标准 `/chat/completions`（含流式），封装成本最低；
4. 模型质量显著高于本地小模型，桌面宠物闲聊/问答完全够用。

### 备选排序
| 优先级 | 方案 | 理由 |
|---|---|---|
| 备选 1 | **豆包 doubao-seed-1.6-flash**（火山方舟） | 国内直连 + OpenAI 兼容 + 新用户免费 token + 极低单价；但免费额度是活动性质，需实名认证 |
| 备选 2 | **硅基流动 SiliconFlow 免费模型**（Qwen2.5-7B/72B） | 国内直连 + 完全免费模型 + OpenAI 兼容；政策变动频繁，需实时核对免费列表 |
| 备选 3 | **本地 Ollama（qwen2.5:3b）** | 完全免费离线兜底，无任何 token 消耗与网络依赖；质量较低 |
| 备选 4 | **Groq / OpenRouter / Gemini 免费层** | 模型更强、免费，但国内需代理或注册门槛高，作为"可选高级项" |
| 不推荐 | DeepSeek 官方 API（按量付费，非免费）；DeepSeek 网页逆向（稳定性/合规风险高） | 不满足"免费"或"稳定"约束 |

**建议默认链路**：`GLM-4-Flash → 豆包/SiliconFlow（可切换）→ 本地 Ollama（兜底）`；免费层撞限速（429）或网络失败时自动降级，保证桌宠"永远有回应"且"默认零 token 消耗"。

---

## 4. 多 Provider 配置设计（OpenAI 兼容封装）

### 4.1 三要素抽象
所有候选（除 DeepSeek 逆向需本地中转服务外）都是 OpenAI 兼容接口，封装层只需三个要素即可切换：

```ts
interface AIProviderConfig {
  id: string;            // 'zhipu' | 'doubao' | 'siliconflow' | 'groq' | 'openrouter' | 'gemini' | 'ollama'
  name: string;          // 显示名
  baseURL: string;       // 三要素①：如 https://open.bigmodel.cn/api/paas/v4
  apiKey: string;        // 三要素②：空/占位符表示无需 key（如 Ollama 填 'ollama'）
  model: string;         // 三要素③：如 glm-4-flash-250414
  // 可选扩展
  extra?: { maxTokens?: number; temperature?: number; timeoutMs?: number; };
}
```

统一入口（fetch 到 `{baseURL}/chat/completions`，`Authorization: Bearer {apiKey}`，body 含 `{model, messages, stream, ...}`）——因为协议同构，**切换 provider 只改配置，不改代码**。

### 4.2 各 Provider 三要素清单

| Provider | baseURL | model（示例） | apiKey 获取 |
|---|---|---|---|
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash-250414` | open.bigmodel.cn 注册 → API Keys |
| 豆包（方舟） | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-1.6-flash-250915` 或 `ep-xxxx` | 火山引擎控制台 → 方舟 → API Key（需实名） |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` | siliconflow.cn → API 密钥 |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | console.groq.com |
| OpenRouter | `https://openrouter.ai/api/v1` | `deepseek/deepseek-r1:free` | openrouter.ai → Keys |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash` | aistudio.google.com |
| Ollama（本地） | `http://localhost:11434/v1` | `qwen2.5:3b` | 无需（填 `ollama` 占位） |

> 注：baseURL 均指向兼容端点；最终请求路径为 `baseURL + /chat/completions`（Gemini 的 OpenAI 兼容端点在 base 后拼 `/chat/completions` 即可）。

### 4.3 切换与降级机制（建议）
- 配置存 `userData/settings.json`（key 走系统加密，见 §5.3），提供"当前 provider + 优先级链"。
- 实现 `chatWithFallback(messages)`：按优先级依次尝试 provider；遇到 `401`（key 失效）、`429`（限速）、超时、`5xx` 自动切下一个；全部失败最后落到 Ollama。
- 桌面端 UI 提供 provider 下拉切换 + "自定义 baseURL"输入框（方便用户接代理或第三方中转）。

---

## 5. 桌面应用（Electron + Node 18+）接入注意点

### 5.1 用原生 fetch 调用（含流式）
- **Node 18+ 自带 `fetch`**（基于 undici），无需引入 axios/openai SDK；Electron 主进程 Node 版本通常 ≥ 18，直接用。
- **非流式**：`const res = await fetch(url, opts); const data = await res.json();`（data.choices[0].message.content）。
- **流式（桌面宠物打字/逐字回复推荐）**：
  ```ts
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 256 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // 按行切分 SSE：data: {...}，行首 "data: " 去掉；"data: [DONE]" 结束
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') { /* 结束 */ continue; }
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) /* 逐字推给渲染进程（IPC event） */;
    }
  }
  ```
- **超时与中断**：用 `AbortController` 做首 token 超时（如 30s）与用户取消（关对话框/切换 provider 时 abort）；流式过程中也监听 abort 停止读取。
- **错误处理**：`401/403` → key 无效提示；`429` → 限速，退避重试或切 provider；`5xx/网络错误` → 重试 1–2 次后降级；所有错误统一收口为可读消息，避免渲染层看到裸异常。

### 5.2 国内网络与代理
- **GLM / 豆包 / 硅基流动 / DeepSeek / Ollama：国内直连，无需代理**（默认链路不用考虑代理问题）。
- **OpenRouter / Gemini / Groq**：国内访问不稳或被墙，仅当用户自备代理时可用。建议封装层支持「自定义 baseURL / 自定义代理」，让用户自己填中转地址，**应用不做内置代理**（避免合规与维护负担）。

### 5.3 Key 存储（不硬编码）
- **绝对不要**把 key 写进代码/仓库；用 Electron `safeStorage`（底层 Keychain/Keychain-like 加密）加密后存 `app.getPath('userData')/settings.json`：
  ```ts
  const encrypted = safeStorage.encryptString(apiKey); // Buffer -> 存盘
  const decrypted = safeStorage.decryptString(encrypted);
  ```
- 请求只在**主进程**发（渲染进程通过 IPC 传消息、收流式事件），key 不出主进程；不要经 preload 把 key 暴露给页面。
- 若用户坚持零配置，默认走无需 key 的 GLM 免费模型也要引导注册（首次启动弹窗引导创建 key 并 `safeStorage` 保存）。

### 5.4 Token 消耗控制（防"一直消费 token"）
- **默认 provider 选完全免费的 GLM-4-Flash / 本地 Ollama**，从机制上杜绝持续计费。
- 上下文裁剪：只携带最近 N 条消息（如 10 条）+ 精简 system prompt（桌宠人格设定短句即可），可显著省 token 与延迟。
- 设置 `max_tokens`（如 128–256）限制单次回复长度，避免长文刷 token。
- 每日调用次数上限（设置项，默认如 200 次/天），防桌面宠物高频轮询浪费。
- 免费层被 429 时自动降级而非重试轰炸。

---

## 6. 参考链接汇总

- 智谱：GLM-4-Flash 免费开放公告（[letsclouds](https://www.letsclouds.com/news?keyword=%E5%A4%A7%E6%A8%A1%E5%9E%8BAPI%E6%8A%80%E6%9C%AF)）、[OpenClaw GLM-4-Flash 完全免费指南](https://www.php.cn/faq/2745587.html)、[智谱免费 API 详情（yangmao.ai）](https://yangmao.ai/zh/providers/zhipu/free-api/)
- 豆包：[火山引擎豆包产品页](https://www.volcengine.com/product/doubao)、[豆包 API 价格解析（php.cn）](https://www.php.cn/faq/1370331.html)、[OpenClaw 豆包每日免费额度实战](https://www.php.cn/faq/2744304.html)
- DeepSeek：官方 API 定价（[deepseek-chat 模型与定价（llm-stats）](https://llm-stats.com/models/deepseek-chat?tab=api)）、[2025-09 涨价并取消夜间优惠（羊城晚报）](https://news.ycwb.com/ikinvkctij/content_53620251.htm)、[2025-02 下调夜间价格（IoT 世界）](https://www.iotworld.com.cn/html/News/202502/909c3c9d76ea0659.shtml)
- DeepSeek 网页逆向（高风险，仅参考）：[Fly143/deepseek-free-api](https://github.com/Fly143/deepseek-free-api)、[smkttl/deepseek-api](https://github.com/smkttl/deepseek-api)、[rabilrbl/deepseek-api](https://github.com/rabilrbl/deepseek-api)、[sums001/Deepseek-API](https://github.com/sums001/Deepseek-API)
- 硅基流动：[官方文档（产品简介）](https://docs.siliconflow.cn/cn/userguide/introduction)、[Qwen2.5-7B 免费 API 教程（CSDN）](https://blog.csdn.net/weixin_42524824/article/details/160107751)
- OpenRouter：[免费模型限制讨论（Linux.do）](https://linux.do/t/topic/619828/7)、[OpenRouter 免费模型使用攻略](https://m.toutiao.com/article/7501670651736949282/)
- Gemini 国内访问：[Deno 免费代理（trueai-org/gemini）](https://github.com/trueai-org/gemini)
- Groq：[Groq Free Tier 2026（pricepertoken）](https://pricepertoken.com/endpoints/groq/free)、[免费 LLM API 清单（含 Groq 限额，GitHub）](https://github.com/mnfst/awesome-free-llm-apis/blob/main/data.json)
- 综合盘点：[2026 年免费 AI 大模型 API 清单（cnblogs）](https://www.cnblogs.com/you1/articles/22482556)、[2026 免费大模型完全指南（CSDN）](https://blog.csdn.net/dozenyaoyida/article/details/162808955)
- Ollama：[OpenAI 兼容文档（GitHub）](https://github.com/ollama/ollama/blob/main/docs/openai.md)、[模型库 qwen2.5](https://ollama.com/library/qwen2.5)、[Mac 本地部署指南（ai-stack.site）](https://ai-stack.site/posts/20260528-juejin-2026-mac-%E6%9C%AC%E5%9C%B0%E5%A4%A7%E6%A8%A1%E5%9E%8B%E9%83%A8%E7%BD%B2%E6%B7%B1%E5%BA%A6%E8%A7%A3%E6%9E%90%E4%B8%8E%E6%B7%B7%E5%90%88%E6%9E%B6%E6%9E%84-0/)
