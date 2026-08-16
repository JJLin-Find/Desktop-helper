# 桌面宠物 AI 助手 · 决策汇总与开发路线

> 本文件是 4 份调研报告的导读 + 最终决策。目标：macOS 优先的桌宠形态 AI 桌面助手，后期兼容 Windows。
> 调研完成时间：2026 年。工作区原始报告见文末「报告清单」。

---

## 1. 决策结论（依据"开箱即用"标准）

用户倾向：**哪个更开箱即用选哪个**。

### 🥇 选型：Electron（锁定 ≥ v40，当前稳定版 v42）

| 维度 | Electron | Tauri v2 | 结论 |
|---|---|---|---|
| 工具链 | ✅ 仅 Node.js（本机已有 v24），`npm i` 即跑 | ❌ 需装 Rust + Xcode CLT（10–30 分钟）+ 首次编译 3–10 分钟 | **Electron 开箱即用** |
| 窗口 API（透明/置顶/穿透） | ✅ 一等公民，穿透带 `forward` 事件转发 | ⚠️ 可用但有 3 个 macOS 透明窗口 open bug（#13415/#8255/#12804）需自己 workaround | **Electron 更省心** |
| 桌宠案例与踩坑资料 | ✅ 最多（PPet / desktop-pet 等现成架构可抄） | ⚠️ 2024 后才起步，案例少 | **Electron 更成熟** |
| 常驻内存（24h） | ⚠️ 150–400 MB | ✅ 40–90 MB | **Tauri 胜，但非"开箱即用"维度** |
| 包体 | 100–200 MB | 5–15 MB | Tauri 胜，非开箱即用维度 |

**结论**：按"开箱即用"标准，Electron 全面胜出——零安装、API 最全、案例最多、本周即可出 Demo。
**代价**：常驻内存 150–400MB + 耗电（桌宠 24h 常挂的长期成本）；**macOS 26 上必须 ≥ v40**（否则 Tahoe 性能 bug：WindowServer GPU 负载飙升）。

**Tauri 的定位**：若日后发现"内存/耗电"成为用户痛点，可迁移 Tauri——**前端资产（Live2D 模型、UI、状态机代码）可复用**，迁移成本主要在 Rust 壳与窗口 API 适配。

### 关键版本约束（红线）

- **Electron ≥ v40（建议 v42+）**：macOS 26 Tahoe 性能 bug 修复版。
- 桌宠窗口参数：`transparent + frame:false + alwaysOnTop + skipTaskbar + hasShadow:false + resizable:false`。
- 穿透：默认 `setIgnoreMouseEvents(true, {forward:true})`，鼠标悬停时关闭穿透恢复交互（Live2D 桌宠标配）。
- 全屏 Space 可见：`setVisibleOnAllWorkspaces(true, {visibleOnFullScreen:true})`（注意 #36364 需先 focus 的 bug）。

---

## 2. 各模块推荐方案速查

| 模块 | 推荐方案 | 备注 |
|---|---|---|
| 动画渲染 | **Live2D + `pixi-live2d-display`（MIT）**，序列帧/Spine 为辅 | 免费模型：`live2d-model-assets`；年营收 <1000 万日元免 SDK 合约；"可扩展性 APP"（任意模型导入）需单独合约 |
| 交互 | 状态机：`idle/walk/chase/sleep/drag/interact/click-through`（优先级+冷却） | 参考 duzexu/desktop-pet 规则引擎、Neco（CC0）oneko 跟随 |
| LLM | **DeepSeek API + OpenAI 兼容统一封装层**（云/本地一键切换） | 本地兜底：llama.cpp + Qwen2.5-7B(4bit)；统一封装是核心架构决策 |
| 工具调用 | **OpenAI 兼容 function calling** | 打开应用走 `open -a`/URL Scheme > AppleScript > Accessibility（权限最小化） |
| TTS | 开发期 Edge TTS；商用：通义 CosyVoice/豆包（在线）+ Piper（离线 MIT） | ⚠️ Edge TTS 非官方接口、禁商用，只限原型 |
| ASR/唤醒 | MVP 用 PTT 按钮；免提：openWakeWord（Apache-2.0）/ Porcupine（免费个人版） | ⚠️ Snowboy 已停更勿用；macOS 优先系统 SFSpeechRecognizer |
| 托盘 | Electron `Tray`，macOS 用模板图标 | 菜单：显示/隐藏、暂停提醒、自启开关、退出（关窗≠退出） |
| 开机自启 | `app.setLoginItemSettings`（macOS 13+ 自动走 SMAppService） | ⚠️ 必须 Developer ID 签名+公证，否则登录项不生效（#42376 别用 loginItemService 类型） |
| 通知/提醒 | 系统通知 + app 内 scheduler（桌宠常驻无需系统服务） | Windows toast 需 AUMID；macOS 需请求授权 + `NSAppSleepDisabled` 防 App Nap 节流 |
| 隐藏 Dock | `Info.plist` `LSUIElement=true` | 设置面板时临时 `app.dock.show()` |
| 配置/密钥 | `electron-store`（JSON）；API Key 用 `keytar`（Keychain） | 勿把 Key 明文写 JSON |
| 自动更新 | **electron-updater + GitHub Releases** | macOS 更新包同样要公证；初期零成本，后续再上灰度 |
| 分发 | **Developer ID 签名 + notarization（$99/年）** | Sequoia 起 Gatekeeper 逐步强制公证，"右键打开"正被封死；ad-hoc 签名视同未签名 |
| 剪贴板历史 | **监听：macOS 轮询 `changeCount`（native addon 暴露，0.5s）/ Windows `AddClipboardFormatListener`；存储：SQLite FTS5 + SHA-256 去重 + pin** | ⚠️ **macOS 26 Tahoe 起后台无交互读取剪贴板触发系统警告**（非 Sonoma）；对策：默认"交互时同步"（呼出面板/快捷键/点桌宠时才读内容，后台只记 changeCount 整数）+ 显式"常驻监听"开关；粘贴默认写回+提示 Cmd+V，自动粘贴（模拟按键）需辅助功能权限设可选项 |
| 文件搜索 | **macOS：`mdfind`（child_process）**；Windows：随包 Everything 便携版 + `es.exe -json` | 非沙盒无需 TCC（读受保护目录内容需 FDA 引导）；300ms 去抖 + `app.getFileIcon` + `open -R`/`explorer /select,` reveal + `webContents.startDrag` 拖出；AI 用 function calling 结构化拼查询 |
| 日程管理/提醒 | **本地 SQLite 存储 + 统一调度器 + 系统通知**；macOS 可选 osascript 写系统日历（写单向） | macOS 14+ 权限：`NSCalendarsFullAccessUsageDescription`/`NSRemindersFullAccessUsageDescription`；进阶：N-API+Swift 接 EventKit 双向、CalDAV 同步；Windows 无系统日历 API → 本地 + `.ics` 导出 + toast |
| 番茄钟/倒计时 | **主进程时间戳调度（防漂移）+ 通知 + 音效 + 桌宠动画反馈 + 持久化** | 与提醒共用统一 Scheduler Job 层；休眠唤醒用时钟 diff 恢复；专注统计（本地 sessions 表）值得做；UI 用桌宠气泡/弹出小面板 |
| 桌宠娱乐交互 | **core 层纯 TS 数值/心情系统（Stats: mood/satiety/affection/energy）+ 单向数据流** | 参考 VPet（数值驱动行为）、Shimeji（行为引擎）、Neco（追逐）；MVP：抚摸强化/喂食/点击连击/基础心情/鼠标追逐；进阶：迷你游戏/抓窗口/多只同屏/心情联动 AI 语气；勿扰模式一键关闭 |

---

## 3. 工程结构（"macOS 优先 + 预留 Windows"）

```
desktop-pet/
├── packages/
│   ├── core/            # 纯 TS 核心：AI client、会话、scheduler、状态机、提醒模型（零平台依赖）
│   ├── platform-api/    # 抽象接口：ITray / IAutoLaunch / INotifier / IWindowManager（反向依赖禁止）
│   └── shared/          # 常量、IPC 协议类型、i18n
├── apps/
│   └── desktop/         # Electron 壳
│       ├── src/main/
│       │   ├── platform/darwin/   # 托盘模板图标、dock 隐藏、SMAppService、AppNap
│       │   ├── platform/win32/    # 托盘 AUMID、注册表自启、toast（第二阶段补）
│       │   ├── services/          # scheduler、notification、updater、store、logging
│       │   └── ipc/               # preload 桥接
│       ├── src/preload/
│       ├── src/renderer/          # 桌宠 UI（Live2D）、设置页
│       └── build/                 # electron-builder.yml、Info.plist、entitlements
├── scripts/             # notarize、release、sign
└── .github/workflows/   # CI/CD（matrix: macos-latest + windows-latest）
```

工厂注入：`createPlatform(): IPlatform`（`process.platform === 'darwin' ? new DarwinPlatform() : new Win32Platform()`）。Windows 阶段 = 补 `win32/` 实现，不改 core。

---

## 4. 开发路线（P0 → P4）

```
P0  工程骨架：monorepo + 透明置顶穿透 PoC（验证 Electron ≥v42 在 macOS 26 上的行为）
P1  桌宠本体：Live2D 渲染 + 状态机（待机/行走/睡觉/拖拽/穿透切换）+ 免费模型
P2  AI 对话：气泡 UI + DeepSeek + function calling（打开应用/查天气/设提醒）
P3  语音：TTS 朗读 + ASR（PTT）→ 唤醒词 → 流式对话（barge-in 打断）
P4  发布与跨平台：托盘/自启/通知/公证 → GitHub Releases + 自动更新 → Windows 适配（补 win32 实现 + CI matrix）
```

---

## 5. 风险与红线清单（开发前必读）

1. **macOS 签名/公证是刚需**：Sequoia 起逐步强制公证；自启动（SMAppService）与通知授权均依赖签名状态。开发期可 ad-hoc + 右键打开，正式版必须 Developer ID。
2. **Electron 版本锁 ≥ v42**：macOS 26 性能 bug 在 <v40 存在。
3. **LIVE2D 授权边界**：营收 <1000 万日元免合约；做"模型市场/任意导入"前先评估可扩展性 APP 合约；素材商用许可逐个确认。
4. **权限 UX 是重灾区**：Accessibility 权限无法弹窗申请，需设置页引导；麦克风/语音识别权限要早做检测与引导 UI。
5. **关窗≠退出**：`window-all-closed` 不 quit，托盘"退出"才退出；`tray.destroy()` 防 macOS 图标残留。
6. **常驻资源**：透明窗口贴近精灵包围盒、空闲降帧、低功耗模式（睡觉状态长驻）；`setBackgroundThrottling(false)` 防后台冻结。
7. **不依赖灰色方案**：Edge TTS（禁商用）、Snowboy（停更）只可开发期试玩。

---

## 6. 报告清单（工作区，按阅读顺序）

| # | 文件 | 内容 | 重点章节 |
|---|---|---|---|
| 1 | `tech-stack-comparison.md` | 五大技术栈对比 + macOS 26 专项 + Rust 工具链成本 | §1 总对比表、§3 macOS 26 查证、§5 最终推荐 |
| 2 | `docs/desktop-pet-research-report.md` | 动画四方案 + 12+ 开源项目 + 交互实现 + 性能要点 | 一（动画对比）、二（项目清单）、三（交互）、四（性能）、五（推荐架构） |
| 3 | `桌面宠物AI助手集成方案调研报告.md` | LLM/TTS/ASR/唤醒/工具调用/流式延迟 | §1 统一封装决策、§4 权限、§5 流式管线 |
| 4 | `docs/report-desktop-pet-cross-platform.md` | 托盘/自启/通知/窗口行为/CI/更新 | §4 窗口行为、§5 工程结构、§7 落地清单 |
| 5 | `docs/report-clipboard-history.md` | 剪贴板历史专项（✅ 已完成） | §2 macOS 26 Tahoe 隐私分水岭、§5 功能设计、§8 分层策略与代码、§10 行动清单 |
| 6 | `docs/report-new-features.md` | 文件搜索/日程提醒/番茄钟/娱乐交互专项（✅ 已完成） | §1 文件搜索（mdfind/Everything 对比）、§2 日程（EventKit TCC 拆分）、§4 娱乐交互（心情系统数据流） |
| 7 | `docs/design-pet-interactions.md` | 行为交互设计（✅ 已完成） | 逗猫棒（chase/pounce）、喂食、抚摸、待机链、数值联动、状态机扩展 11 态、动画资产映射、调参表 |
| 8 | `docs/report-live2d-integration.md` | Live2D 集成专项（✅ 已完成） | 版本选型（pixi-live2d-display 0.4.0=Pixi v6 / @naari3 fork=Pixi v8）、官方模型直链、**模型许可红线**、file:// 协议坑、capturePage 注意点 |

---

## 8. 实现进度

### ✅ P0 已完成（工程骨架）
- monorepo + Electron 42.9.1 + 透明置顶穿透窗口 + 统一调度器 + JSON 存储 + IPC 白名单 + 平台工厂
- 验证：透明窗口截图（68% 像素 alpha=0）

### ✅ P1 已完成（桌宠本体 + 行为交互）
- **Live2D**：pixi-live2d-display(cubism4) + 官方 Cubism Core 5.1 + aidang_2 模型（14 动作 → 命名组）
- **core**：状态机 11 态 + 优先级/冷却表 + reducer 事件（pounce/feed-food/pet-part）+ PetBehaviorConfig/PettingController/IdleChainTimer
- **行为控制器**（主进程）：逗猫棒（watch/chase/pounce）、抚摸（hitPart+连击衰减）、喂食（食物表+饱和）、待机链（30s/90s 入睡+惊起）、心情联动
- **渲染层**：指令驱动 + @pixi/unsafe-eval（CSP 兼容）+ WebGL 失败回退 Canvas
- 验证：Live2D 渲染截图（7961 色）、行为命令链路（feed→eat、click→pet_head）

### ⏳ 后续（P2+）
AI 对话（DeepSeek）、剪贴板历史、文件搜索、日程/番茄钟、语音、打包分发（.app/公证）

---

## 7. 完整功能清单（需求总览）

### 第一期（桌宠核心）
- [x] 透明无边框置顶窗口 + 点击穿透切换
- [x] 动画系统（Live2D 为主）：待机/行走/睡觉/点击反馈
- [x] 鼠标交互：拖拽、抚摸、右键菜单、鼠标跟随/避让
- [x] 系统托盘 + 开机自启 + 隐藏 Dock 图标
- [x] AI 文字对话（DeepSeek + OpenAI 兼容封装）
- [x] 工具调用：打开应用、查天气、设提醒
- [x] 通知与定时提醒（系统通知 + app 内 scheduler）
- [x] 语音：TTS 朗读、ASR（PTT → 唤醒词 → 流式）

### 第二期（用户新增）
- [x] **剪贴板历史**：监听/历史/搜索/固定/快捷粘贴 ✅ 方案已定（macOS 26 隐私分层策略）
- [x] **文件搜索**：macOS `mdfind` / Windows Everything（`es.exe -json`）✅ 方案已定
- [x] **日程管理/提醒**：本地 SQLite + 调度器 + 系统通知；进阶 EventKit 双向/CalDAV ✅ 方案已定
- [x] **番茄钟/倒计时**：统一调度层 + 通知 + 桌宠动画反馈 + 专注统计 ✅ 方案已定
- [x] **桌宠娱乐交互**：心情/数值系统（core 层）+ 喂食/连击/追逐/小游戏 ✅ 方案已定
