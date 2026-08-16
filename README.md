# Desktop Helper · 桌面宠物 AI 助手

macOS 优先、预留 Windows 的桌宠形态 AI 桌面助手。

## 工程结构（monorepo）

```
desktop-helper/
├── packages/
│   ├── core/            # 纯 TS 核心：调度器、事件总线、桌宠状态机、数值系统（零平台依赖）
│   └── platform-api/    # 平台抽象接口：ITray / IAutoLaunch / INotifier / IWindowManager / IClipboardWatcher
├── apps/
│   └── desktop/         # Electron ≥ v42 壳
│       ├── src/main/    #   主进程：桌宠窗口（透明/置顶/穿透）、平台工厂、服务、IPC
│       ├── src/preload/ #   contextBridge 白名单 API（window.pet.*）
│       └── src/renderer/#   渲染层：桌宠绘制骨架（Canvas 占位，P1 换 Live2D）
├── scripts/             # 工具脚本（如 generate-icons.js）
└── docs/                # 调研报告与决策文档
```

## 当前进度

### ✅ P0（已完成）：工程骨架 + 透明窗口 PoC
- monorepo：`packages/core`（纯 TS 核心）+ `packages/platform-api`（接口）+ `apps/desktop`（Electron 42.9.1）
- 透明置顶穿透窗口、托盘、统一调度器、JSON 存储、IPC 白名单、平台工厂 darwin/win32
- 已验证：截图 260×260 透明窗口，68% 像素 alpha=0

### ✅ P1（已完成）：桌宠本体 + 行为交互
- **Live2D 渲染**：`pixi-live2d-display(cubism4)` + 官方 Cubism Core 5.1 + **皮丘模型**（Pichu，宝可梦皮卡丘家族的 Q 版形象，BOOTH 作者 Raddleii 免费发布，可个人使用/直播，不可商用）
- **core 状态机扩展 11 态**：idle/walk/watch/chase/pounce/sleep/drag/being-petted/eat/interact/click-through + 优先级/冷却
- **行为控制器**（主进程）：逗猫棒（注视/追逐/扑击）、抚摸（部位+连击衰减）、喂食（食物表+饱和限制）、待机链（理毛/打哈欠/睡觉/惊起）、心情联动
- **渲染层**：指令驱动（行为控制器 → 命令 → 模型动作），透明窗内 WebGL 渲染 + CSP 兼容（@pixi/unsafe-eval），WebGL 失败自动回退 Canvas 形象
- 已验证：皮丘渲染截图、行为命令链路（feed→eat、click→pet）

> 形象切换：`RENDER_MODE` 支持 `'live2d' | 'cat'`（橘猫 Canvas 备用）；模型文件在 `renderer/public/live2d/`。
> 皮丘模型：VTube Studio 风格（无 Motions，自制 Idle 呼吸动作 + 5 个表情 Angry/Dispair/Happy/Sad/Shock 映射到行为命令）；许可：免费个人使用（BOOTH raddleii），不可商用/倒卖/改贴图。

### 行为交互（docs/design-pet-interactions.md）
- 逗猫棒：鼠标靠近注视 → 追逐 → 静止扑击（命中判定 + 心情联动 + 开关）
- 抚摸：点击头部/身体（模型包围盒判定）→ touch_head/touch_body 动作 + 连击衰减
- 喂食：拖文件/菜单 → eat 动作 + 饱腹/心情变化 + 饱和限制
- 待机链：无操作 30s 待机动作 → 90s 入睡，鼠标一动惊起

### ✅ P2（已完成）：AI 对话
- **免费 AI 优先**：主推智谱 **GLM-4-Flash**（官方完全免费、国内直连、OpenAI 兼容）；预设 5 个 provider（GLM/豆包/DeepSeek/硅基流动/本地 Ollama）三要素一键切换
- **core `ai-client.ts`**：OpenAI 兼容封装（SSE 流式）+ Provider 抽象，零依赖
- **主进程 `AIService`**：皮丘人设系统提示 + 心情注入 + 对话历史（10 轮，持久化恢复）
- **对话双模式**：
  - **双击桌宠** → 桌宠闲聊（皮丘人设、俏皮短句），回复在桌宠上方**圆润气泡窗口**流式呈现（透明气泡造型+小尾巴，高度自适应，8s 自动关闭）
  - **右键 → 聊天框** → **信息查询助手**（专业人设，可查询任何信息，回答准确详尽、支持长文），独立对话历史
  - 两模式人设/历史完全隔离；桌宠窗口/模型位置恒定不动
- **联网实时查询**：查询时自动实时检索并注入上下文：
  - **天气**（Open-Meteo，免费无 key、国内可直连）："北京天气" → 实时温度/天气/风速（已实测）
  - **网页搜索**（**博查 BochaAPI**，国内直连、注册送免费额度）：实时信息 → 搜索结果注入 → LLM 综合回答（已在设置配置 Key）
  - 注：经典 Bing API 已于 2025-08 停服，不再支持
  - 设置窗口 → "联网搜索" 区配置；查询时聊天窗显示"🔍 正在查询实时信息…"
- **点击命中**：模型 alpha 掩码（64×77 网格，按模型实际占用区域，非方形、不写死）
- **AI 设置窗口**：托盘菜单 → "AI 对话设置"（provider 下拉 / Key / 模型覆盖）
- **Key 安全**：`safeStorage`（macOS Keychain）加密存储
- **自定义/局域网模型**：预设含「自定义（局域网/自部署）」——填网关地址 baseURL + 模型名即可（支持 vLLM/Ollama/llama.cpp 等 OpenAI 兼容网关），内网无鉴权可不填 Key（已验证无 Key 调用正常）
- 已验证：mock 全链路（人设注入/历史上下文/流式/持久化）通过

> 使用：托盘 → AI 对话设置 → 选「智谱 GLM」→ 填 open.bigmodel.cn 免费注册的 API Key → 保存 → 双击桌宠开聊。

## 一键启动

```bash
./scripts/start.sh            # 生产启动（自动装依赖/构建/运行）
./scripts/start.sh --dev      # 开发模式（electron-vite HMR 热更新）
./scripts/start.sh --screenshot /tmp/pet.png   # 验证模式（截图后退出）
./scripts/start.sh --compat   # 受限环境（--no-sandbox --disable-gpu）
npm start                     # 等价于 ./scripts/start.sh
```

> macOS 下也可直接**双击 `start.command`** 启动（Finder 双击）。
>
> 脚本自动处理：依赖缺失 → npm install（独立缓存）；Electron 二进制缺失 → 国内镜像补装；
> 沙箱/GPU 受限环境 → 自动降级重试。无需手动配置。

## 手动方式（开发）

```bash
npm install                 # 安装全部 workspace 依赖
npm run build               # 构建 core → platform-api → desktop
npm run dev                 # electron-vite 开发模式（HMR）
```

## 验证透明窗口 PoC

```bash
./scripts/start.sh --screenshot /tmp/pet-proof.png
# 截图保存在指定路径：260×260，约 68% 像素透明（alpha=0），其余为桌宠形象
```

## 红线备忘（详见 docs/decision-summary.md）

- Electron 必须 ≥ v42（macOS 26 Tahoe 性能 bug 修复）
- 关窗 ≠ 退出：托盘「退出」才退出
- 打包期 Info.plist 设 `LSUIElement=true` 隐藏 Dock
- macOS 正式分发需 Developer ID 签名 + 公证
