# 桌面宠物 AI 助手：多模块集成方案调研报告

> 调研时间：2025 年 10 月 · 目标平台：macOS 优先（后期兼容 Windows）· 形态：桌面宠物 + 气泡对话 UI + 语音（TTS/ASR/唤醒）+ 工具调用
> 说明：本报告中所有价格均为调研时点（2025 Q3–Q4）的参考价，云厂商调价频繁，落地前请以各厂商官方计价页为准。

---

## 0. 推荐组合速览（先看结论）

| 模块 | MVP 推荐（免费/低成本） | 进阶推荐（体验优先） | 保底方案 |
|---|---|---|---|
| LLM | DeepSeek API（国内直连、超低价、OpenAI 兼容） | 多 Provider 切换（OpenAI / 通义 / 豆包 / 本地 Ollama） | 本地 Qwen2.5-7B（4bit，M 系列芯片可用） |
| TTS | 方案 A：Edge TTS（免费、音质好、中文佳，仅限原型）<br>方案 B：系统 say/AVSpeechSynthesizer（零依赖） | 云端：豆包/通义/OpenAI gpt-4o-mini-tts<br>本地：Piper（离线、MIT 可商用） | Azure 语音（标准版 $15/百万字符，有免费层） |
| ASR | 系统原生 SFSpeechRecognizer（macOS，零成本） | 本地 faster-whisper（小而快）或 whisper.cpp（可嵌入） | 云端 Whisper API（$0.006/分钟） |
| 唤醒词 | 按钮/快捷键 PTT（最稳） | openWakeWord（Apache-2.0 全免费）或 Porcupine（免费个人版） | Porcupine 商业授权 |
| 工具调用 | OpenAI 兼容 function calling（各家都支持） | Anthropic tool use / OpenAI Responses API tools | MCP 协议（生态向） |
| 系统权限 | Tauri/Rust 原生壳 + AppleScript/`open -a`，按需申请 TCC 权限 | Accessibility + Automation 授权做深度控制 | 无 |

**总体架构建议**：桌面壳用 **Tauri 2.x（Rust）**（内存占用远小于 Electron，桌宠常驻更合适）；语音/推理组件优先选**可嵌入的 C/C++/Rust 库**（whisper.cpp、Piper、porcupine C SDK），用 FFI 或本地 sidecar 进程（如 `whisper.cpp server`、`llama.cpp server`）接入；所有 LLM/云服务统一走 **OpenAI 兼容协议**，做一层 Provider 抽象，便于一键切换云/本地。

---

## 1. LLM 对话接入

### 1.1 方案对比表

| 方案 | 国内可用性 | 中文能力 | 参考价格（每百万 token） | 延迟 | 隐私 | 备注 |
|---|---|---|---|---|---|---|
| OpenAI GPT-4.1 / 4.1-mini / 4o-mini | ⚠️ 需海外网络/代理 | 好（4.1 系列中文显著提升） | 4.1-mini：$0.40 / $1.60；4o-mini：$0.15 / $0.60 | 中 | 数据可被用于训练（除非企业版） | 生态最全，文档/示例最多 |
| Anthropic Claude | ⚠️ 需海外网络/代理 | 好 | Sonnet 4.5：$3 / $15 | 中 | 同上 | tool use 文档优秀 |
| DeepSeek V3.1 / V3.2 | ✅ 国内直连 | 优秀（中文第一梯队） | 输入 $0.56（缓存命中 $0.028）/ 输出 $1.68（V3.1 2025-09 价），V3.2-Exp 又降 50%+ | 快 | 数据用于训练（可申请关闭） | 性价比之王，官方 OpenAI 兼容端点 |
| 通义千问 qwen-plus / qwen-turbo | ✅ 国内直连 | 优秀 | qwen-plus 约 ¥0.8 / ¥2 | 快 | 阿里云合规 | 百炼平台新用户长期送免费额度 |
| 豆包 doubao-seed | ✅ 国内直连 | 优秀 | 国产最低价位之一（约 ¥0.8/百万输入量级） | 快 | 火山引擎合规 | 常与豆包 TTS/ASR 同生态 |
| Gemini 2.0 Flash / Flash-Lite | ⚠️ 需海外网络 | 好 | Flash 约 $0.10 / $0.40，有免费层 | 快 | 注意数据政策 | 免费层适合测试 |
| 本地 Ollama | ✅ 完全离线 | 取决于模型（qwen2.5 / llama3.1 中文可用） | 0（电费） | 取决于硬件 | 完全本地 | 一键部署，OpenAI 兼容 |
| 本地 LM Studio | ✅ 完全离线 | 同左 | 0 | 同上 | 完全本地 | 图形化，适合开发调试 |
| 本地 llama.cpp / MLX | ✅ 完全离线 | 同左 | 0 | 最低（可控性最强） | 完全本地 | 库级嵌入，定制自由 |

### 1.2 云端 API 要点

- **国内可用性与合规**：桌面宠物若要长期在中国大陆运行，优先选**国内直连**的 DeepSeek / 通义 / 豆包（无需代理、延迟低、合规、按量付费且便宜）；OpenAI / Anthropic / Gemini 需要海外网络，且 OpenAI 对地区有限制，个人开发者通常要借代理/中转，不稳定且合规风险高。
- **价格走势**：2025 年大模型价格战激烈——OpenAI 4.1 系列上市即降价（[OpenAI 官方公告](https://openai.com/index/gpt-4-1/)）；DeepSeek 2025-09-06 上调 V3.1 价格后，9 月底 V3.2-Exp 又宣布降价 50%+（[Skywork 分析](https://skywork.ai/blog/deepseek-v32-price-drop-2025/)、[东方财富报道](https://finance.eastmoney.com/a/202509293526550153.html)）。**落地时以官方计价页为准**，并把价格做成配置项。
- **DeepSeek 细节**：官方提供 OpenAI 兼容的 `https://api.deepseek.com` 端点，`deepseek-chat`（V3）与 `deepseek-reasoner`（R1）两个模型，支持 function calling 与流式；**上下文缓存命中价格极低（输入降到 $0.028/M）**，对"桌宠反复带系统提示词/工具 schema"的场景非常友好（参考 [Roo-Code 定价更新 PR](https://github.com/RooCodeInc/Roo-Code/pull/7813)）。

### 1.3 本地模型（离线兜底）

- **硬件门槛**：macOS 上只有 **Apple Silicon（M1 起，内存 ≥ 8GB，建议 16GB）** 才实用；Intel Mac 基本放弃 7B+ 模型。
  - 7B 模型 4bit 量化：M1/M2 8GB 内存可跑（约 4-5 token/s），16GB 更从容（6-9 token/s）。
  - 3B 模型（Qwen2.5-3B / Llama-3.2-3B）：M1 8GB 流畅（15-25 token/s），桌宠对话够用。
  - 14B 4bit：建议 16GB 以上。
- **三件套对比**（[CNBlogs 实测](https://www.cnblogs.com/itech/p/19919532)、[Edge of Context 深度文](https://slavadubrov.github.io/blog/2025/05/10/local-llms-on-macos/)、[2026 大对比](https://codersera.com/blog/ollama-vs-lm-studio-vs-vllm-vs-llama-cpp-vs-mlx-2026/)）：
  - **Ollama**：安装最简单，一条命令跑模型，自带 OpenAI 兼容 API；缺点是封装黑盒、定制难、进程常驻内存。
  - **LM Studio**：图形化、能加载 GGUF，适合开发和给用户演示；也是常驻 GUI 应用。
  - **llama.cpp**（含其 `server`）：库级方案，可编译进桌宠或做 sidecar，内存/启动控制最细，**是"内嵌进桌面应用"的首选**；Apple Silicon 上也有官方支持的 MLX 分支。
- **推荐组合**：`llama.cpp server`（OpenAI 兼容 HTTP）作为可选"离线模式"；桌宠检测到用户无网络或想离线时切换。中文优先选 **Qwen2.5-7B-Instruct（4bit）** 或 Qwen2.5-3B。

### 1.4 OpenAI 兼容协议统一封装

- 事实标准：**OpenAI Chat Completions 协议**已被 DeepSeek、通义百炼、豆包、Ollama、LM Studio、llama.cpp server、vLLM、SiliconFlow、OpenRouter 等全面支持。**写一套 Provider 抽象（一个 base URL + api_key + model 名），即可云/本地无缝切换**——这是本项目的关键架构决策。
- 若想省事可选用聚合平台：**SiliconFlow（硅基流动）**、**OpenRouter** 等，一个 key 切所有模型（含免费模型额度），且都是 OpenAI 兼容（[聚合网关选型对比](https://www.modb.pro/db/2077579266863226880)、[SiliconFlow vs OpenRouter 对比](https://ofox.ai/zh/blog/siliconflow-vs-ofox-api-platform-comparison-2026)）；但注意聚合平台稳定性与隐私边界，自用可以，商用需评估。

### 1.5 推荐结论

> **首选 DeepSeek API（默认在线）**：国内直连、中文强、价格极低、官方 OpenAI 兼容、function calling 完善。
> **统一封装层（必做）**：抽象 `LLMProvider`，支持切换 DeepSeek / 通义 / OpenAI / 本地 llama.cpp，让"在线/离线"成为用户可选项。
> **离线兜底（可选）**：llama.cpp + Qwen2.5-7B(4bit) 或 3B，Apple Silicon 16GB 内存即可。

---

## 2. TTS（语音合成）

### 2.1 方案对比表

| 方案 | 需联网 | 中文音质 | 速度/延迟 | 免费商用 | 成本 | 集成方式 |
|---|---|---|---|---|---|---|
| macOS `say` / AVSpeechSynthesizer | 否 | 中（国语 Ting-Ting 等；新版音质有提升，但机器感仍明显） | 即时 | ✅ 系统自带 | 0 | 系统 API，最简 |
| Windows SAPI / WinRT Speech | 否 | 中（微软 Huihui/Yaoyao，视系统版本） | 即时 | ✅ 系统自带 | 0 | System.Speech / Windows.Media.SpeechSynthesis |
| **Edge TTS（免费接口）** | 是 | **优**（晓晓/云希/云扬等多音色，接近真人） | 快（首个音频包 <500ms） | ⚠️ **非官方逆向接口，微软 TOS 禁止商用，稳定性无保证** | 0 | `edge-tts` Python 包 / [openai-edge-tts-cn 兼容层](https://github.com/cjy37/openai-edge-tts-cn) |
| OpenAI TTS（tts-1 / tts-1-hd / gpt-4o-mini-tts） | 是 | 良（gpt-4o-mini-tts 中文"略有翻车"被实测吐槽，见 [36Kr 实测](https://36kr.com/p/3215592773192838)） | 快 | ✅ 按量付费 | tts-1 $15/百万字符；gpt-4o-mini-tts 约 $0.015/分钟（[TokenMix](https://tokenmix.ai/blog/gpt-4o-mini-tts-cheapest-tts-api-2026)） | REST API |
| Azure 语音 | 是 | 优（晓晓/云希，Neural 音色丰富） | 快 | ✅ 按量付费 | 标准版约 $15/百万字符；**每月 50 万字符免费层** | SDK（含流式） |
| 阿里通义 CosyVoice / qwen-tts | 是 | 优（CosyVoice 支持情感/拟人，中文顶级） | 快 | ✅ 按量付费（需实名） | 按字符计费，国产中很有竞争力；百炼有免费额度（[官方计价](https://help.aliyun.com/zh/model-studio/model-pricing)） | REST/SDK，OpenAI 兼容 |
| 豆包（火山引擎）语音合成 | 是 | 优（多音色，情感自然） | 快 | ✅ 按量付费（需实名） | 大模型语音合成按字符/次计费，价位低，有免费试用 | REST/SDK |
| **Piper（本地）** | 否 | 中（zh_CN-huayan-medium 等模型，清晰但偏机械） | 极快（CPU 实时） | ✅ **MIT 可商用** | 0 | 可嵌入（C++/Python/[Rust](https://github.com/rhasspy/piper)），有 [中文模型](https://huggingface.co/Trelis/piper-zh-cn-huayan-medium) |
| ChatTTS（本地） | 否 | **优**（为对话场景设计，自然、有停顿） | 中（需 GPU/较新 Mac 可 CPU 但慢） | ⚠️ **开源但模型权重限非商用**（商业需授权） | 0 | Python 为主，集成较重 |
| Kokoro（本地，82M 小模型） | 否 | 良（v1.0 起支持中文） | 极快（可实时流式，[优化文档](https://github.com/neosun100/kokoro-tts/blob/main/docs/STREAMING_OPTIMIZATION.md)） | ✅ Apache-2.0 可商用 | 0 | Python/ONNX，轻量 |

### 2.2 关键结论

- **音质排序（中文）**：豆包/通义 CosyVoice ≈ Edge TTS > Azure > OpenAI gpt-4o-mini-tts（中文不稳定）> Piper > 系统 say。**追求中文自然度，云端选国产（豆包/通义）或 Edge TTS（免费但仅限原型）**。
- **免费商用的干净路径**：Piper（MIT）或 Kokoro（Apache-2.0）做离线；Azure / 通义 / 豆包做在线（有免费额度）。**Edge TTS 免费但属逆向接口，微软服务条款不允许商用**，适合快速原型和自用，正式发布前必须替换（[Edge TTS 生态资料](https://github.com/cjy37/openai-edge-tts-cn)）。
- **macOS 系统 say 现状**：音质较旧版有提升（[V2EX 讨论](https://global.v2ex.co/t/1187276)），但仍是明显的合成感；优点是零依赖、零成本、断网可用——可作为"最后兜底"和开发期占位。

### 2.3 推荐结论

> **开发期**：Edge TTS（免费、音质好，开发体验最佳）。
> **MVP（商用安全）**：在线用**通义 CosyVoice 或豆包**（中文顶级、便宜、合规），离线用 **Piper**（MIT，中文模型 huayan）。
> **进阶**：本地 Kokoro（Apache-2.0）评估流式效果；预算充足可上 Azure（有免费层）。
> **架构**：封装统一 `TTSProvider` 接口（文本入、音频流出），支持"在线/离线"与"音色"配置，便于 A/B 与降级。

---

## 3. ASR（语音识别 / 唤醒）

### 3.1 ASR 方案对比表

| 方案 | 需联网 | 中文识别 | 首字/实时性 | 免费商用 | 成本 | 集成成本 |
|---|---|---|---|---|---|---|
| macOS Speech 框架（SFSpeechRecognizer） | 部分语种离线；中文需验证（`supportsOnDeviceRecognition`） | 良（系统级） | 好（支持增量结果） | ✅ | 0 | 低（系统 API，需麦克风+语音识别权限） |
| Windows Speech（System.Speech / WinRT SpeechRecognizer） | 支持离线（UWP 有离线 SR，见 [离线 SAPI 指南](https://en.ittrip.xyz/windows/windows-offline-sapi-sr)） | 中（中文需安装语言包） | 好 | ✅ | 0 | 低 |
| Whisper API（`whisper-1`）/ gpt-4o-transcribe | 是 | 优（Whisper 中文稳健） | 需等说完（非流式） | ✅ 按量付费 | $0.006/分钟（whisper-1）；新 transcribe 模型按音频 token 计费 | 极低 |
| **faster-whisper**（本地） | 否 | 优 | small/base 模型可近实时（VAD 分片 + 增量） | ✅ MIT | 0 | 中（Python 或 CTranslate2 绑定） |
| **whisper.cpp**（本地） | 否 | 优 | 同左，可嵌入 C/C++/Rust | ✅ MIT | 0 | 中高（可编译进应用/做 sidecar） |
| 通义 Paraformer 实时语音识别 | 是 | 优（中文专长） | 流式，支持增量 | ✅ 按量付费（需实名） | 按输入音频秒数计费、输出不计费，有 90 天免费额度（[官方计价](https://help.aliyun.com/zh/model-studio/model-pricing)） | 低 |
| 豆包/火山 语音识别 | 是 | 优 | 流式 | ✅ 按量付费 | 价位低，有免费试用 | 低 |
| 讯飞语音听写 | 是 | 优（老牌） | 流式 | ✅ 按量付费 | 新用户免费额度，商用按分钟 | 低（SDK 成熟） |
| Moonshine（流式 ASR 新秀） | 否 | 中（英文为主） | 流式极低延迟（[论文](https://arxiv.org/html/2602.12241v1)） | ✅ | 0 | 中 |

**本地 ASR 集成成本关键点**：faster-whisper（CTranslate2）比原版 Whisper 快数倍、内存更低，社区已有**带 VAD 的实时转写库**（如 [RealtimeSTT-mac](https://github.com/tomWhiting/RealtimeSTT-mac)，集成 VAD + 唤醒 + 增量转写），甚至有人做了 **Apple Silicon 上完整的本地 STT-LLM-TTS 流水线**（[speech-to-speech-pipeline](https://github.com/eauchs/speech-to-speech-pipeline)）可参考。桌面端要"边说边出字"，VAD 分片 + 增量假设（partial results）是核心。

### 3.2 语音唤醒词（桌面端实现现状）

| 方案 | 免费商用 | 状态 | 说明 |
|---|---|---|---|
| **Porcupine（Picovoice）** | ⚠️ 免费个人版（设备数/营收有限制），商用需付费授权 | 活跃维护 | 端侧关键词检测，多平台（含 macOS/Windows）C SDK，延迟极低；支持自定义唤醒词训练（[官网](https://picovoice.ai/products/voice/wake-word/)） |
| **openWakeWord** | ✅ Apache-2.0 完全免费 | 活跃（[GitHub](https://github.com/dscripka/openWakeWord)） | 开源端侧唤醒框架，预训练词少（默认支持 "hey jarvis" 等），**自定义词需自己训练**；纯 Python 较重，有 C++ 移植 [lowwi](https://github.com/CLFML/lowwi) |
| Snowboy | ⚠️ 曾是 MIT | **已停止维护（项目冻结）** | KITT.AI 被百度收购后停止开发，旧版只支持到 Python 2/旧依赖，**新项目不建议使用** |
| 系统级 | — | macOS 无第三方自定义唤醒词 API（"Hey Siri"不可被第三方应用调用） | 唤醒词必须自研或集成上述库 |

**唤醒词实现的现实建议**：
1. **MVP 用"按钮/快捷键 PTT（Push-to-Talk）"**——最稳、零误唤醒、免权限纠缠；桌宠形态天然适合"点一下宠物说话"。
2. 要"免提唤醒"再上 openWakeWord（免费）或 Porcupine（免费个人版够用）；注意**常驻麦克风监听**会持续占用 TCC 麦克风权限、耗电，并可能被用户关闭——要做好"唤醒词开关 + 指示状态（灯/圈）"的 UX。
3. Porcupine 支持自定义唤醒词（如"小助手"），体验最好但商用要付费；openWakeWord 完全免费但需要自己训练中文词（训练集要自己准备）。

### 3.3 推荐结论

> **在线优先**：通义 Paraformer 实时识别 或 豆包/讯飞（中文流式成熟、便宜、有免费额度）；whisper-1 API 作为统一兜底（$0.006/分钟）。
> **本地优先**：**faster-whisper（small/base）**，VAD 分片实现增量转写；要嵌入桌面应用用 **whisper.cpp**（MIT，C/C++ 友好）。
> **唤醒词**：MVP 用 PTT；免提用 **openWakeWord**（免费）或 **Porcupine 免费个人版**；**不要用 Snowboy**（已死）。
> **架构**：统一 `ASRProvider` 接口（音频流入、文本/增量出），在线/本地可切换；麦克风采集 + VAD 由 Rust 原生层做，走系统 API。

---

## 4. 工具调用 / Function Calling 与系统权限

### 4.1 实现模式（三种主流）

| 模式 | 协议 | 各家支持 | 特点 |
|---|---|---|---|
| **OpenAI 兼容 function calling**（Chat Completions `tools`） | 声明 JSON Schema → 模型返回 `tool_calls` → 本地执行 → 回传 `tool` 结果 | OpenAI / DeepSeek / 通义 / 豆包 / Ollama / vLLM 全部支持 | **事实标准，统一封装层直接复用**；本地模型（Qwen2.5、Llama 3.1+）也支持 |
| **OpenAI Responses API `tools`** | 新版协议，流式与工具调用更顺（含 `function` / `web_search` 等内建工具） | OpenAI 官方（[流式+工具示例](https://github.com/openai/openai-dotnet/discussions/403)） | 新项目可优先；但各家兼容层以 Chat Completions 为主，需权衡 |
| **Anthropic tool use** | `tools` 参数 + `tool_use` 输出块 | Claude 系 | 文档/Agent 能力强（[官方文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use)），但生态兼容性不如 OpenAI 协议 |
| （未来方向）**MCP** | 标准化的工具服务器协议 | 多家推动 | 适合"工具生态"扩展，但对单一桌宠项目偏重，可后续接入 |

**推荐实现**：走 **OpenAI 兼容 function calling**。桌宠定义工具 schema（`open_app`、`get_weather`、`set_reminder`、`take_screenshot` 等），LLM 输出 `tool_calls` → 本地 Rust 层执行 → 结果回填后继续对话。这个循环在流式模式下要处理好"流中途出现 tool_calls 暂停文本输出 → 执行 → 继续流"的状态机。

### 4.2 macOS 系统权限注意点（TCC 权限清单）

| 权限 | 用途 | 申请方式 | 注意事项 |
|---|---|---|---|
| **麦克风**（Microphone） | 语音输入/唤醒 | Info.plist `NSMicrophoneUsageDescription`，首次使用弹窗 | 必须，无它 ASR 不可用 |
| **语音识别**（Speech Recognition） | SFSpeechRecognizer | `NSSpeechRecognitionUsageDescription` | 与麦克风是两个独立权限 |
| **辅助功能**（Accessibility） | 控制其他 App：模拟点击/键盘、读取 UI、截取其他应用界面 | **不能弹窗申请**，只能引导用户去「系统设置 → 隐私与安全性 → 辅助功能」勾选（用 `AXIsProcessTrustedWithOptions` 检测并跳转）；**沙盒应用受限**（[Apple 论坛讨论](https://developer.apple.com/forums/thread/707680)） | 桌宠"控制其他应用"的最重权限，需在 UI 里做醒目的引导页 + 状态检测 |
| **自动化**（Apple Events） | 用 AppleScript 控制其他 App（如 `tell app "Music" to play`） | `NSAppleEventsUsageDescription`，每次控制一个新 App 会弹窗（[问题示例](https://github.com/tinyhumansai/openhuman/issues/985)） | 逐 App 授权，弹窗烦人但比 Accessibility 轻；`osascript` 调用即触发 |
| **屏幕录制**（Screen Recording） | 截屏/录屏（如"帮我看一下当前屏幕"） | 手动勾选（同上） | 只在你需要视觉能力时才申请 |
| **输入监控**（Input Monitoring） | 全局快捷键/键盘钩子 | 手动勾选 | 有全局热键需求才需要 |
| 通知 / 全盘访问 / 日历 / 通讯录 | 提醒、日程、联系人等工具 | 各自弹窗 | 按工具需求申请 |

**实操要点**：
- **能走 AppleScript/`open -a`/URL Scheme 的，优先于 Accessibility**。"打开应用"用 `open -a Safari`（无需任何权限）；"控制某 App 播放/暂停"用 Apple Events（Automation 弹窗即可）；只有"模拟鼠标键盘/读 UI"才需要 Accessibility——**权限最小化**，降低用户拒绝率。
- 权限状态要在桌宠设置页**可视化检测并给出引导**（如"需要辅助功能权限：点此打开设置"），因为 TCC 弹窗机制对 Accessibility/Screen Recording 不生效。
- 沙盒：若上 Mac App Store 需沙盒，Accessibility 受限严重（[Apple 论坛](https://developer.apple.com/forums/thread/707680)）；桌宠类工具通常**不走沙盒/直接分发**（Homebrew、dmg、Tauri 签名）。

### 4.3 推荐结论

> 工具层用 **OpenAI 兼容 function calling**（统一封装层直接支持，本地模型也能跑）。
> 系统操作优先级：**URL Scheme / `open -a` / AppleScript（Automation）> Accessibility**；按需申请权限，设置页提供权限检测与引导。
> Windows 侧（后期）：`start`/PowerShell、COM Automation、UIA（UI Automation）对应 Accessibility，届时按 TCC 对等设计。

---

## 5. 语音流式对话（"边说边显示"）的延迟控制

### 5.1 延迟构成与量级

```
麦克风采集 → VAD 检测（10–30ms）
  → ASR 增量转写首字（本地 faster-whisper ~200–500ms；云端流式 ~300–800ms）
  → LLM 首 token（TTFT：DeepSeek/通义 ~300–800ms；本地 7B 4bit ~500–1500ms）
  → TTS 首个音频包（本地 Piper/Kokoro ~50–200ms；云端 ~200–600ms）
  → 播放
```
端到端首声目标 **< 1.5–2s**（可感知流畅），理想 < 1s。

### 5.2 两条技术路线

**路线 A：分治（ASR + LLM + TTS 三段管线，各自流式）——推荐 MVP**
- ASR 用流式增量（partial results），用户话没说完就开始出字。
- LLM 用 SSE 流式，**文本 token 一到就更新气泡 UI**（"边说边显示"的直接实现）。
- TTS 消费已产出的文本：**按标点/句号分句**，句子完整即合成并播放，与文本显示并行——这就是"边说边显示+边发声"。
- 关键点：**文本流与音频流解耦**，用"已消费游标"管理；对话长句时句级切分避免等待整段。

**路线 B：端到端语音模型（音频进、音频出）——进阶/可选**
- OpenAI **Realtime API（gpt-4o-realtime → 新 GPT-Realtime）**：原生音频进出，端到端延迟可到 ~0.5–1s，支持打断（barge-in），2025 年新一代模型加量降价（[36Kr 报道](https://36kr.com/p/3443721740948864)、[成本分析](https://skywork.ai/blog/agent/openai-realtime-api-pricing-2025-cost-calculator/)）；但**按音频 token 计费较贵**，中文支持有进步但仍非最佳，且需海外网络。
- 国内对应：通义 qwen-omni / 豆包端到端语音模型（国内直连，价格低）。
- 权衡：端到端少了两段拼接误差、延迟更稳，但**定制困难（音色/打断策略/文本气泡同步）**、成本高、各家兼容性差。桌宠要"气泡+语音+工具调用"三合一，分治路线更可控。

### 5.3 延迟控制要点清单

1. **连接复用**：LLM / TTS / ASR 全部用**长连接（WebSocket/HTTP/2 流）**，避免每次握手开销。
2. **模型选型**：在线 LLM 选 TTFT 低的（DeepSeek V3、通义 qwen-turbo/flash、GPT-4.1-mini）；本地用 3B–7B 量化，配 Metal 推理。
3. **流式 TTS 分句**：句级切分 + 首个音频包尽快出；可对高频短语/系统提示做**音频缓存**（如"好的""请问还需要什么"）。
4. **并行流水线**：ASR 增量结果提前送入 LLM（边听边想）；LLM 输出与 TTS 合成并行（不要等全文）。
5. **打断（barge-in）**：播放/合成中检测到新语音立即停 TTS、清队列、重发 LLM——桌宠"被插话能停"是体验分水岭；Realtime 方案自带，分治方案需自己实现（VAD 触发 interrupt）。
6. **播放端**：用低延迟音频后端（Rust 侧 miniaudio/cpal 直接喂 PCM，而非系统文件播放）；预加载音频设备、保持打开。
7. **降级策略**：延迟劣化时自动降级（云端→本地 Piper；7B→3B），并在 UI 显示"打字中"等状态掩盖等待。
8. **性能预算**：本地 whisper.cpp + 3B LLM + Piper 全离线链路在 M 系芯片上可做到 <1.5s 首声，是"断网也能用的桌宠"的可行配置（参考 [Home Assistant 低延迟本地 STT 实践](https://community.home-assistant.io/t/even-faster-whisper-for-local-voice-low-latency-stt/864762/7)、[Orpheus-TTS sub-100ms TTFT](https://github.com/canopyai/Orpheus-TTS/issues/221)）。

### 5.4 推荐结论

> MVP 走**分治流水线**：faster-whisper/云端流式 ASR（增量）→ LLM SSE 流式（气泡实时更新）→ 句级 TTS 流式播放；目标首声 < 1.5s。
> 做**打断**、**音频缓存**、**连接复用**三大优化；把延迟做成可观测指标（记录 TTFT/首包/端到端）。
> 端到端 Realtime 类方案留作"体验增强"选项，不阻塞主线。

---

## 6. 综合推荐架构（落地图）

```
┌─────────────────────────────────────────────────────┐
│  桌宠 UI（Tauri 2 / Rust + WebView）                  │
│  ├─ 宠物动画/气泡框（文本流实时渲染）                    │
│  ├─ 设置页（Provider 选择、权限引导、音色、唤醒词开关）   │
│  └─ 状态指示（录音中/思考中/播放中）                    │
├─────────────────────────────────────────────────────┤
│  语音管线（Rust 原生层）                                │
│  ├─ 麦克风采集 + VAD（系统 API）                       │
│  ├─ ASR：在线 Provider / faster-whisper / whisper.cpp │
│  ├─ TTS：在线 Provider / Piper / Kokoro / 系统 say    │
│  └─ 打断管理（barge-in）+ 音频播放（cpal/miniaudio）     │
├─────────────────────────────────────────────────────┤
│  LLM 层（OpenAI 兼容统一封装）                          │
│  ├─ 在线：DeepSeek / 通义 / 豆包 / OpenAI（可切换）     │
│  ├─ 本地：llama.cpp server（OpenAI 兼容）             │
│  └─ function calling 循环（工具执行 → 回填 → 继续）      │
├─────────────────────────────────────────────────────┤
│  系统能力层（工具调用）                                  │
│  ├─ open -a / URL Scheme（免权限）                    │
│  ├─ AppleScript（Automation 授权）                   │
│  ├─ Accessibility（深度控制，可选）                    │
│  └─ 天气/提醒等外部 API                                │
└─────────────────────────────────────────────────────┘
```

**分阶段路线**：
- **P0（能聊）**：气泡对话 + DeepSeek API + function calling（打开应用、查天气）。
- **P1（能说能听）**：Edge TTS（开发期）→ 通义/豆包 TTS；系统 SFSpeechRecognizer 或 faster-whisper ASR；PTT 交互。
- **P2（能唤醒）**：openWakeWord 中文词 / Porcupine 自定义词 + 麦克风常驻与状态 UI。
- **P3（体验）**：流式"边说边显示"优化（分句 TTS、打断、音频缓存）、权限引导页、离线模式（本地全家桶）。

---

## 7. 主要参考资料

**LLM**
- OpenAI GPT-4.1 发布与定价：https://openai.com/index/gpt-4-1/
- OpenAI 模型定价总览：https://futureagi.com/llm-cost-calculator/openai/
- DeepSeek V3.2 降价分析：https://skywork.ai/blog/deepseek-v32-price-drop-2025/ ；东方财富报道：https://finance.eastmoney.com/a/202509293526550153.html
- macOS 本地推理三件套实测：https://www.cnblogs.com/itech/p/19919532 ；https://slavadubrov.github.io/blog/2025/05/10/local-llms-on-macos/
- Ollama vs LM Studio vs llama.cpp vs MLX：https://codersera.com/blog/ollama-vs-lm-studio-vs-vllm-vs-llama-cpp-vs-mlx-2026/
- API 聚合平台对比：https://www.modb.pro/db/2077579266863226880 ；https://ofox.ai/zh/blog/siliconflow-vs-ofox-api-platform-comparison-2026

**TTS**
- Edge TTS 免费接口与 OpenAI 兼容层：https://github.com/cjy37/openai-edge-tts-cn
- Piper 中文模型：https://huggingface.co/Trelis/piper-zh-cn-huayan-medium
- OpenAI gpt-4o-mini-tts 价格：https://tokenmix.ai/blog/gpt-4o-mini-tts-cheapest-tts-api-2026 ；中文实测：https://36kr.com/p/3215592773192838
- 阿里百炼模型计价（含 TTS/实时语音识别）：https://help.aliyun.com/zh/model-studio/model-pricing
- 本地 16 款 TTS 盘点：https://pyvideotrans.com/blog/16tts ；ChatTTS 解析：https://developer.baidu.com/article/detail.html?id=3658978
- Kokoro 流式优化：https://github.com/neosun100/kokoro-tts/blob/main/docs/STREAMING_OPTIMIZATION.md

**ASR / 唤醒**
- faster-whisper vs whisper.cpp vs WhisperX：https://aifoss.dev/blog/faster-whisper-vs-whispercpp-vs-whisperx-2026/
- RealtimeSTT-mac（VAD+唤醒+增量转写）：https://github.com/tomWhiting/RealtimeSTT-mac
- Apple Silicon 本地语音流水线：https://github.com/eauchs/speech-to-speech-pipeline
- Windows 离线语音识别（UWP/SAPI）：https://en.ittrip.xyz/windows/windows-offline-sapi-sr
- Porcupine 唤醒词：https://picovoice.ai/products/voice/wake-word/
- openWakeWord：https://github.com/dscripka/openWakeWord ；C++ 移植 lowwi：https://github.com/CLFML/lowwi
- 讯飞语音听写免费额度：https://blog.csdn.net/fox11/article/details/155156837

**工具调用 / 权限**
- LLM Tool Use 综合报告：https://tencentcloudadp.github.io/youtu-agent/examples_output/deep_research/
- OpenAI Responses API 流式+工具示例：https://github.com/openai/openai-dotnet/discussions/403
- Anthropic tool use 文档：https://platform.claude.com/docs/en/agents-and-tools/tool-use
- macOS 沙盒与 Accessibility 权限限制：https://developer.apple.com/forums/thread/707680
- Apple Events 权限弹窗问题：https://github.com/tinyhumansai/openhuman/issues/985
- 请求 Accessibility 权限方案：https://stackoverflow.com/posts/79811683/revisions

**流式/延迟**
- OpenAI Realtime 定价分析：https://skywork.ai/blog/agent/openai-realtime-api-pricing-2025-cost-calculator/ ；新模型发布：https://36kr.com/p/3443721740948864
- 本地低延迟 STT 实践（Home Assistant）：https://community.home-assistant.io/t/even-faster-whisper-for-local-voice-low-latency-stt/864762/7
- Orpheus-TTS sub-100ms TTFT：https://github.com/canopyai/Orpheus-TTS/issues/221
- Moonshine 流式 ASR：https://arxiv.org/html/2602.12241v1
