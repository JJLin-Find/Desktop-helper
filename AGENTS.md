# AGENTS.md — AI 接续开发指南

> 给 **AI 编码代理**（Codex / Cursor / Claude Code / 其他）和人类协作者的统一上下文。
> 本文件是**工程操作手册**：改代码前必读；详细决策背景见文末「文档导航」。
> 权威进度快照 = `docs/PROGRESS.md`（上下文被压缩时以此恢复）。

---

## 1. 项目是什么

macOS 优先、预留 Windows 的**桌宠形态 AI 桌面助手**（Electron + TypeScript monorepo）。
- 桌宠：Live2D **皮丘 Pichu** 形象（透明/置顶/穿透窗口，平时不动，仅按住拖拽）。
- AI：OpenAI 兼容协议，**免费优先**（主推智谱 GLM-4-Flash）；双击桌宠=气泡闲聊（皮丘人设），右键聊天框=信息查询助手（专业人设+Markdown+联网检索）。
- 工具：剪贴板历史 / 文件搜索(mdfind) / 日程 / 番茄钟 / 设置，全部从右键菜单进入。
- 形态红线：**信息查询助手不推气泡**；气泡跟随桌宠；聊天窗标题="{桌宠名称}自习室"。

## 2. 快速上手（在仓库根目录）

```bash
npm install                    # 装全部 workspace 依赖（大文件多，耐心等）
npm run build                  # 构建 core → platform-api → desktop（全部 TS）
npm run typecheck              # 0 错误才算干净（改完必跑）
npm run smoke                  # 统一冒烟测试 8 项（自动先构建；0=全过 / 1=失败）
./scripts/start.sh             # 一键启动（自动补依赖/构建；沙盒环境自动 --no-sandbox）
./scripts/start.sh --dev       # 开发模式（electron-vite HMR 热更新）
npm run dev                    # 等价于 --dev
```

> 受限环境（无 GUI/沙盒）：Electron 需 `--no-sandbox --user-data-dir=/tmp/xxx`；
> npm 缓存用 `--cache /tmp/npm-cache-desktop-helper`；Electron 二进制走国内镜像
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。start.sh 已自动处理。

## 3. 技术栈（版本已定案，勿轻易升级）

| 层 | 选型 | 注意 |
|---|---|---|
| 框架 | **Electron 42.9.1（钉死精确版本）** | macOS 26 Tahoe 性能修复；electron-builder 26 拒绝 range，别乱升 |
| 构建 | electron-vite 3 + Vite 6 | renderer `base: './'`（file:// 下绝对路径会 404） |
| 渲染 | PixiJS ^6.5.10 + pixi-live2d-display@0.4.0（cubism4）+ Cubism Core 5.1 | CSP 禁 eval → 必须 `@pixi/unsafe-eval` 的 `install(PIXI)` |
| 语言 | TypeScript 全栈，npm workspaces monorepo | workspace 依赖用 `"*"`（**不是** `workspace:*`，npm 不支持） |
| AI | OpenAI 兼容（baseURL+apiKey+model）| 主推智谱 GLM-4-Flash 完全免费；支持自定义局域网网关（无 Key 不发鉴权头） |
| 打包 | electron-builder 26 | appId `com.desktophelper.pet`；afterSign 公证钩子未配 APPLE_* 自动跳过 |

**残留依赖提醒**：`apps/desktop` 的 deps 里有 `edge-tts`（TTS 功能已被用户取消，代码中无引用）——可清理，别误以为要接语音。

## 4. 工程结构地图

```
packages/core/                 # 纯 TS、零运行时依赖、零平台 API —— 新逻辑优先放这里
  scheduler.ts                 #   统一调度器（时间戳防漂移/持久化快照/幂等注册）——日程/番茄钟/心情衰减共用
  event-bus.ts                 #   事件总线
  pet-state-machine.ts         #   状态机 11 态（idle/walk/watch/chase/pounce/sleep/drag/being-petted/eat/interact/click-through）
  pet-stats.ts / pet-behavior.ts
  ai-client.ts                 #   OpenAI 兼容封装（SSE 流式）+ AI_PROVIDER_PRESETS（GLM/豆包/DeepSeek/硅基/Ollama/自定义）
packages/platform-api/         # 平台抽象接口（ITray/INotifier/...）+ PetActionCommand 类型
apps/desktop/
  src/main/index.ts            # ★ 入口：IPC 全部白名单、服务装配、全部 PET_* 验证模式
  src/main/services/           #   ai / calendar / clipboard / file-search / pet-behavior / pomodoro / scheduler / store / web-tools
  src/main/window/             #   pet-window(桌宠) / bubble-window(气泡) / chat-window / settings-window
                               #   clipboard-panel / file-search-panel / calendar-panel / pomodoro-panel
  src/main/platform/           #   base / darwin / win32（平台工厂，Windows 分支已预留）
  src/preload/index.ts         #   contextBridge 白名单 → window.pet.*（新 IPC 必须同步加这里）
  src/renderer/src/main.ts     #   Live2D 渲染 + 右键菜单 CONTEXT_MENU_ITEMS + 图标模式 __renderIcon
  resources/*.html             #   各面板的独立 HTML（chat/clipboard/file-search/calendar/pomodoro）——别改成内嵌字符串！
  electron-builder.yml         #   打包配置（改这里，别碰根 package.json）
scripts/                       #   start.sh / smoke.js / generate-icons.js / notarize.js / download-live2d-model.js / normalize-model-motions.js
docs/                          #   调研报告 + PROGRESS.md(权威) + RELEASE.md(发布指南)
```

**Live2D 模型**：`src/renderer/public/live2d/` 下 `pichu/`（当前，1.6MB）与 `jixuanyou/`（疾旋鼬，50MB，保留可回切）。切换形象改 `main.ts` 的 `MODEL_URL`。

## 5. 架构与数据流（改代码前先懂这个）

- **单向链路**：renderer(Live2D/交互) ⇄ preload(`window.pet.*`) ⇄ main(服务) ⇄ `packages/core`(纯逻辑)。
- **IPC 白名单**：主进程 `ipcMain.handle('pet:*')` 全部显式注册；preload 只暴露需要的方法。**新增 IPC = 改 3 处**：main/index.ts、preload/index.ts、renderer 调用点。
- **双模式 AI 完全隔离**：人设、历史各自独立（`ai.service.ts` 内 pet / assistant 两套）。
- **流式**：AI 流式回调要 `BrowserWindow.getAllWindows()` 广播 `pet:ai:chunk`（聊天窗订阅）；气泡窗由主进程直写 `appendBubbleText`。
- **窗口体系**：桌宠窗=透明置顶穿透；**气泡是独立窗口**（跟随桌宠移动，勿改桌宠窗尺寸）；聊天窗/面板窗各自独立 HTML 文件。
- **持久化**：JSON 于 `userData/`（store.service.ts 原子写）；AI Key 明文存储（见红线 8）。

## 6. 铁律（每一条都是踩过的坑，违反必踩雷）

1. **不要覆盖根 `package.json`**（曾被打包 subagent 误写导致 monorepo 崩溃）。任何 npm 操作后跑 `npm run typecheck` 自查。打包配置只改 `apps/desktop/package.json` + `electron-builder.yml`。
2. **workspace 依赖用 `"*"`**，不用 `workspace:*`。
3. **renderer 资源必须相对路径**（`base: './'`，`/live2d/...` 绝对路径在 file:// 下 404）。
4. **气泡/面板 HTML 用独立文件**（`resources/*.html`）：内嵌字符串里的正则 `\[`、`\s`、反引号会被模板转义破坏。
5. **桌宠窗口尺寸永远不要动态改**（曾引发抖动、模型被挤出）——气泡用独立窗口跟随。
6. **模型锚定用固定高度**（加载时取一次），勿用动画中实时 getBounds（会跳动）；图标模式不调 `renderer.resize`（背景会变蓝）。
7. **pixi 提取像素别用 `extract.pixels`/region**（120M 缓冲 / `_rawPixels` bug）——手动离屏渲染到受控 RenderTexture。
8. **API Key 明文存储**（`b64:` 前缀，兼容旧 `enc:` 数据）：safeStorage 在未签名开发模式重启后解密不可靠，可靠性优先；正式签名打包后再考虑加密。
9. **fetch 必须带超时**（AbortController / AbortSignal.timeout），否则网络挂起卡死对话。天气 5-6s / 搜索 8s / LLM 30s。
10. **CSP 禁 eval**：PixiJS v6 需要 eval → 保持 `@pixi/unsafe-eval` 的 `install(PIXI)`。
11. **bash 3.2 兼容**（start.sh）：变量后 `"${VAR}"` 花括号（全角字符会误并入变量名）；不用空数组展开。
12. **Windows 分支**：`src/main/platform/win32.ts` 已预留（toast/自启/托盘/文件搜索 es.exe），但**未在真机验证**——涉及 win32 的改动要标注"待实机验证"。

## 7. 开发新功能的标准流程

1. **纯逻辑先进 `packages/core`**（零依赖、可单测）；需要系统能力再进 main 服务层。
2. 主进程加服务 → `index.ts` 装配 + IPC handler 注册（`pet:xxx`）。
3. preload 同步暴露（`contextBridge.exposeInMainWorld` 白名单）。
4. 渲染层调用 `window.pet.*`；新右键菜单项加进 `CONTEXT_MENU_ITEMS`。
5. 面板类窗口：新建 `resources/xxx.html` + `src/main/window/xxx-panel.ts`。
6. **加验证模式**：在 `index.ts` 加 `PET_XXX_TEST=1` 分支（自测后打印 `[xxx-test] 全部完成 ✅`），并在 `scripts/smoke.js` 的 `CASES` 数组加一项——保持 8 项以上全绿。
7. 收尾必跑：`npm run typecheck` → `npm run build` → `npm run smoke` → 更新 `docs/PROGRESS.md`（完成项移入、坑追加、待办更新）。

## 8. 测试与验证

- **统一冒烟**：`npm run smoke`（或 `node scripts/smoke.js --build`）。当前 8 项：启动渲染 / AI 全链路 / 剪贴板 / 文件搜索 / 日程 / 番茄钟 / 存储持久化 / Markdown。每项独立 `--user-data-dir=/tmp/dsh-smoke/*` 隔离，单模式超时 180s，失败自动打印关键输出。
- **验证模式速查**（主进程 index.ts，`PET_*` 环境变量）：`PET_SCREENSHOT=<path>` 截图退出、`PET_AI_MOCK=1` mock OpenAI 全链路、`PET_SEARCH_MOCK=1`、`PET_CLIP_TEST=1`、`PET_FS_TEST=1`、`PET_CAL_TEST=1`、`PET_POMO_TEST=1`、`PET_STORE_PROBE=1`、`PET_MD_TEST=1`、`PET_ICON_SHOT=1`、`PET_DEBUG=1` 渲染调试面板。
- 新增/改动功能后：**必须**让对应 PET_* 模式全 PASS 并更新 smoke 断言，否则视为未完成。

## 9. 打包与发布（不做商用，本地分发即可）

```bash
cd apps/desktop
npm run dist:dir     # 出未打包 .app（最快验证）
npm run dist         # 出 dmg/zip（mac）+ NSIS（win，需在对应平台构建）
```

- 详情见 `docs/RELEASE.md`（含"本地打包给朋友"流程：macOS AirDrop 直传免 quarantine；Windows SmartScreen 点"仍要运行"）。
- **无需** Apple Developer 账号/公证（用户明确不做商用）；`scripts/notarize.js` 未设 `APPLE_*` 自动跳过。
- 产物输出 `apps/desktop/release/`（已 gitignore）。

## 10. 许可与合规红线（重要）

- **皮丘 Pichu 模型**（BOOTH raddleii）：免费**个人使用**，**不可商用/倒卖/改贴图**；疾旋鼬（帕鲁官方）同理。
- 本仓库是**公开 GitHub 仓库**，含版权模型有侵权风险——若担忧应建议转私有；本地/朋友间非商用分发可接受。
- 搜索：博查需 key；**Bing API 已 2025-08 停服**，勿再接入。

## 11. 文档导航

| 文档 | 用途 |
|---|---|
| `docs/PROGRESS.md` | ★ 权威进度快照：已完成/坑列表/待办/验证速查 |
| `docs/RELEASE.md` | 打包、签名、公证、本地分发指南 |
| `docs/report-*.md` | 各专项调研报告（技术栈/动画/AI/系统集成/剪贴板/搜索/Live2D） |
| `README.md` | 面向用户的介绍（部分章节落后于现状，以 PROGRESS 为准） |

## 12. 协作约定

- 大任务用 subagent 并行推进，每完成一项**更新 `docs/PROGRESS.md`**。
- 日志统一 `[main]` / `[xxx-test]` / `[clip-test]` 前缀风格，冒烟断言依赖这些标记。
- 改动先过 `npm run typecheck`（0 错误）+ 相关 PET_* 验证 + `npm run smoke` 全绿，再提交。
