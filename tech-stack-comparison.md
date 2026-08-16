# 桌面宠物 AI 助手 · 跨平台技术栈选型报告

> 调研时间：2026 年（基于 2024–2026 资料）
> 目标平台：macOS 优先开发（当前开发机 macOS 26.3 / Node.js v24.14.0 / 无 rustc / 无 Xcode CLT），后期必须兼容 Windows。
> 核心需求：透明无边框窗口 + 始终置顶 + 点击穿透 + 动画渲染 + 系统托盘。

---

## 0. 结论速览（TL;DR）

| 结论 | 内容 |
|---|---|
| **主推** | **Tauri v2**（Rust 后端 + 系统 WebView，前端用 Web 技术做动画） |
| **备选** | **Electron**（若团队想"零原生工具链、最快出 Demo"，接受内存/耗电代价） |
| **不建议** | 双原生方案（维护成本≈两套产品）、Flutter Desktop（窗口层能力最弱） |
| **特判场景** | 若第一优先级是"本周在 macOS 26 上零安装出可跑 Demo"→ 用 Electron |
| **关键前提** | 选 Tauri 必须先装 Rust 工具链 + Xcode CLT（一次性，约 10–30 分钟）；macOS 26 上 Electron 需 ≥ v40 才避开 Tahoe 性能 bug |

---

## 1. 五类核心需求 × 技术栈总对比表

| 需求 | Electron | Tauri v2 | Qt / QML | Flutter Desktop | 双原生 (AppKit+WPF/WinUI3) |
|---|---|---|---|---|---|
| 透明无边框窗口 | ✅ 成熟（`transparent+frame:false`，Windows 走分层窗口，macOS 走 NSWindow） | ✅ 支持（`transparent+decorations:false`，macOS WKWebView / Windows WebView2），**但有多个已知 bug** | ✅ 成熟（`FramelessWindowHint + WA_TranslucentBackground` / `setMask`） | ⚠️ 无官方支持，靠 `window_manager` + `flutter_acrylic` 等插件硬凑 | ✅ 原生（macOS `NSWindow.isOpaque=false`；Windows `AllowsTransparency=true` / WinUI3 需 Win32 互操作） |
| 始终置顶 | ✅ `alwaysOnTop` + macOS level（floating/screen-saver）+ `setVisibleOnAllWorkspaces`；**全屏 Space 下有已知缺陷** | ✅ `setAlwaysOnTop`（tao 层支持），全屏 Space 行为同 Electron 一样要自己调 | ✅ `Qt::WindowStaysOnTopHint` | ✅ `window_manager.setAlwaysOnTop`（插件） | ✅ 原生（`NSWindow.level` / `SetWindowPos(HWND_TOPMOST)`），最可控 |
| 点击穿透 | ✅ `setIgnoreMouseEvents(true,{forward:true})`，**macOS+Windows 均支持且带事件转发** | ⚠️ `setIgnoreCursorEvents` 可用，**但无 forward 选项**（issue #6164 仍未实现），需要转发要自己写 | ✅ `Qt::WindowTransparentForInput`（macOS/Windows 正常；Wayland 有 bug） | ⚠️ 需插件 + Win32/AppKit 手动调用，无统一 API | ✅ 原生（macOS `ignoresMouseEvents`；Windows `WS_EX_TRANSPARENT`/`WS_EX_LAYERED`） |
| 动画渲染 | ✅ 极佳：Chromium Canvas/WebGL/WebGPU，Live2D、Lottie、Spine、PixiJS 生态最全 | ✅ 同左（系统 WebView，macOS 为 WKWebView：支持 WebGL2，性能略逊 Chromium） | ✅ 极佳：Qt Quick Scene Graph 60fps 硬件加速，粒子系统一流 | ✅ 渲染引擎强（Impeller），但 Web 动画资产（Live2D 等）集成生态弱 | ⚠️ 各自为战：macOS Core Animation/SpriteKit 一流；Windows WPF 动画/异形窗口成熟但 Live2D 原生集成要手写 |
| 系统托盘 | ✅ 内置 `Tray` API，双平台成熟 | ✅ 内置（v2 含托盘），双平台 | ✅ `QSystemTrayIcon` 成熟 | ⚠️ `tray_manager` 插件，可用但非官方 | ✅ 原生（NSStatusItem / NotifyIcon） |
| 一套代码 | ✅ 一套 Web 代码 | ✅ 一套 Web 代码（Rust 后端一套） | ✅ 一套 QML/C++ | ✅ 一套 Dart | ❌ **两套**（Swift 一套 + C# 一套） |
| 包体大小 | ≈100–200 MB | ≈5–15 MB | ≈30–60 MB（含 Qt 库） | ≈50–100 MB | 各平台各自打包 |
| 空闲内存（24h 常驻） | ⚠️ 150–400 MB，Chromium 常驻 | ✅ 40–90 MB | ✅ 原生级，30–80 MB | ⚠️ 100–200 MB | ✅ 原生级，最低 |
| 开发机工具链 | ✅ 仅 Node.js（已具备），**零额外安装** | ❌ 需 rustup + Xcode CLT（一次性 10–30 分钟），首次编译较慢 | ❌ 需 Qt SDK（官方安装器/CMake 工具链，体积大） | ✅ Dart SDK 即可，但插件要编译需 Xcode CLT | ❌ 需完整 Xcode（macOS 端）+ 单独 Windows 构建机（C#/VS） |
| 社区/生态 | 极大，桌宠案例极多 | 增长快（2024-10 v2 稳定后），2026 已有一批桌宠开源项目 | 成熟（Qt 6.8/6.9 LTS），桌宠案例少但可行 | 移动端极大、桌面窗口层生态薄弱 | 各平台各自成熟，无"统一社区" |
| 已知坑（桌宠场景致命点） | 常驻内存/耗电高；macOS 26 Tahoe 性能 bug（<v40）；透明窗口阴影/圆角要手工处理 | macOS 透明窗口多个 open bug；无鼠标事件 forward；WKWebView 某些 Chromium 特性缺失 | 商业授权（LGPL/商业版）；QML 生态小；Wayland 兼容问题 | 透明/穿透/置顶全靠插件拼，稳定性差；正是桌宠场景最弱处 | 维护成本 = 两套产品；Live2D/动画管线要写两遍 |

---

## 2. 各方案详细分析

### 2.1 Electron —— "上手最快，代价是常驻成本"

**优点**
- 透明窗口、置顶、点击穿透是**一等公民 API**：`transparent: true`、`alwaysOnTop: true`（macOS 支持 `floating`/`screen-saver` 层级）、`setIgnoreMouseEvents(true, { forward: true })` 在 macOS 与 Windows 都可用且支持鼠标事件转发（桌宠"局部可交互"场景很关键）。
- 动画生态是五大方案里最强的：Live2D、Lottie、Spine、PixiJS、Three.js、WebGPU 全都能跑，桌宠素材基本是 Web 格式，拿来即用。
- 桌宠开源案例最多（如 [kirineko/desktop-pet](https://github.com/kirineko/desktop-pet)、[duzexu/desktop-pet](https://github.com/duzexu/desktop-pet) 等），踩坑参考多。
- 开发机零工具链成本：只有 Node.js（你已有 v24），`npm install electron` 直接跑。

**缺点（桌宠场景的致命短板）**
- **常驻内存 150–400 MB + 持续耗电**。桌宠是 24 小时开机自启常驻的应用，内存与电池是长期隐性成本；macOS 会降低未聚焦 Chromium 的渲染优先级（有其他 app 全屏时窗口被节流，见 [Stack Overflow 讨论](https://stackoverflow.com/questions/79803322/how-to-prevent-electron-browserwindow-from-being-throttled-when-other-apps-are-i)）。
- **macOS 26 Tahoe 性能 bug**：Electron 曾长期覆盖 Apple 私有 API（`cornerMask`），导致 Tahoe 上 WindowServer GPU 负载飙升、全局掉帧，Slack/Discord 等中招（[The Register 报道](https://www.theregister.com/2025/10/02/macos_26_electron_slowdown?td=keepreading)）。**已在 Electron 40 修复**（[PR #48376](https://github.com/electron/electron/pull/48376)，[9to5Mac 报道 macOS 侧 beta 亦修复](https://9to5mac.my/2025/11/21/mac-tahoe-electron-performance-bug/)）。**结论：用 Electron 必须 ≥ v40（当前已到 v42），否则 Tahoe 上体验极差。**
- 透明窗口细节坑：macOS 上阴影要 `hasShadow:false`、圆角要自己 mask；历史上透明无边框窗口在 macOS 上收不到点击的问题（[issue #23042](https://github.com/electron/electron/issues/23042)，有第三方 workaround 包）；全屏 Space 下 `alwaysOnTop + setVisibleOnAllWorkspaces` 有时要手动聚焦才生效（[issue #36364](https://github.com/electron/electron/issues/36364)）。

**维护成本 / 动画性能 / 生态**：一套代码跨双平台，维护成本低；动画性能顶级（GPU 加速）；生态最大。**取舍**：用"常驻内存+耗电"换"开发效率与生态"。

---

### 2.2 Tauri v2 —— "小而美的原生壳 + Web 动画"

**优点**
- 底层是 Rust + 各系统原生 WebView（macOS WKWebView / Windows WebView2），窗口由 tao 直接管原生窗口，包体 5–15 MB、空闲内存 40–90 MB，**对 24h 常驻的桌宠是显著优势**；置顶、透明、点击穿透、托盘都有 API（`setAlwaysOnTop` / `setIgnoreCursorEvents` / 托盘内置）。
- 前端仍用 Web 技术，Live2D/Lottie/Spine 资产生态完整，动画质量接近 Electron。
- v2 自 2024-10 稳定发布后迭代很快（[官方公告](https://tauri.app/blog/tauri-20/)），2026 年已出现一批真实的 Tauri 桌宠项目，证明可行性：如 [NekoAI](https://github.com/nucket/NekoAI)（Tauri+Rust 的 AI 桌宠）、[OpenPet](https://github.com/X-T-E-R/OpenPet)（本地桌宠运行时）、[CodexPetDesk](https://github.com/fangbm/CodexPetDesk)、[convai-desktop-pet](https://github.com/AkshitIreddy/convai-desktop-pet) 等。

**缺点（已知坑，务必提前评估）**
- **macOS 透明窗口有一串 open bug**，需要逐个 workaround：
  - [DMG 打包后透明失效（issue #13415）](https://github.com/tauri-apps/tauri/issues/13415)
  - [Sonoma 后聚焦切换时透明窗口闪烁/glitch（issue #8255）](https://github.com/tauri-apps/tauri/issues/8255)
  - [透明 + 背景模糊（vibrancy）不兼容（issue #12804）](https://github.com/tauri-apps/tauri/issues/12804)
  - macOS 透明窗口黑边/光晕（[TIL 记录](https://agents.stackoverflow.com/tils/ef9796d8-8f2e-454d-b2f9-76068a16cbc2)）；毛玻璃需 `macOSPrivateApi: true` + `window-vibrancy` 插件。
- **点击穿透无 forward（事件转发）选项**：`setIgnoreCursorEvents` 只能整窗穿透，不能像 Electron 那样把鼠标事件转发给下层窗口（[issue #6164](https://github.com/tauri-apps/tauri/issues/6164)、[讨论 #11507](https://github.com/orgs/tauri-apps/discussions/11507)）。若桌宠需要"透明区域穿透 + 本体可交互"的局部穿透体验，得在 macOS 用 NSEvent 全局监听等自行实现。
- **WKWebView 特性差异**：相比 Chromium 少了部分能力（某些 DevTools 能力、部分 Web API），Live2D WebGL2 在 macOS 12+ 的 WKWebView 可用，但踩坑概率比 Chromium 高。
- **Rust 工具链成本**（对你是硬性前置条件）：见 §4。
- Rust 学习曲线 + 编译时间（首次全量编译 Tauri 项目数分钟）。

**维护成本 / 动画性能 / 生态**：一套代码双平台；动画性能取决于系统 WebView（macOS WKWebView 略逊 Chromium，仍 60fps 无压力）；生态 2024 年后快速成熟，桌宠案例已可参考。**取舍**：用"一次性工具链安装 + WebView 边角 bug"换"原生级体积/内存/电池"。

---

### 2.3 Qt / QML —— "原生三平台，但生态与速度偏传统"

**优点**
- 真正的原生跨平台（Windows/macOS/Linux 一套 QML），桌宠所需全有：`Qt::FramelessWindowHint` + `WA_TranslucentBackground` 透明、`setMask` 异形、`Qt::WindowStaysOnTopHint` 置顶、`Qt::WindowTransparentForInput` 穿透（macOS/Windows 正常）、`QSystemTrayIcon` 托盘。
- Qt Quick Scene Graph 动画性能顶级（60fps 硬件加速、粒子系统），原生内存（30–80 MB）。
- 有专门的桌宠形态无边框窗口实践文章（如 [Create a Frameless Desktop-Pet-Style Window in Qt](https://greatzaochen.dev/en/posts/8cd07b68/)），并有跨平台桌宠项目（如 [desktop-pet](https://github.com/duzexu/desktop-pet)）。

**缺点**
- **授权**：Qt 商业版收费，LGPL 需遵守动态链接规则（对闭源商业应用是合规成本，多数情况用 LGPL 动态链接可接受，但要法务确认）。
- QML 生态远小于 Web：Live2D/Spine 等 Web 资产要转 QML 原生实现或接 C++ 插件，AI/LLM 相关 SDK 生态也弱于 Web/JS。
- UI 迭代速度慢于 Web 技术栈；Wayland 上有穿透相关 bug（[Qt 论坛](https://forum.qt.io/topic/154266/windowtransparentforinput-not-worked-on-wayland/3?lang=en-GB)），Windows/macOS 无此问题。
- 工具链重（Qt SDK + CMake + 编译器），开发机还要额外装。

**维护成本**：一套 QML 代码 + 少量平台原生窗口代码；但动画资产管线与 AI 集成生态是短板。**取舍**：原生性能换"生态与开发速度"。

---

### 2.4 Flutter Desktop —— "移动端王者，桌宠窗口层是软肋"

**优点**
- Dart 一套代码；渲染引擎（Impeller）动画能力本身很强；UI 开发效率高。
- 通过社区插件可拼出透明/置顶/穿透：`window_manager`（[GitHub](https://github.com/AdguardTeam/window_manager)）提供 `setAlwaysOnTop`、`setIgnoreMouseEvents`；`flutter_acrylic` 提供透明度/磨砂（含 `acknowledgeMouseEvents`）。

**缺点（桌宠场景致命短板）**
- **透明、穿透、置顶均无官方窗口 API，全靠社区插件 + 各平台 Win32/AppKit 手工 hack**（Stack Overflow 上大量 workaround：[Ignore Mouse Events](https://stackoverflow.com/questions/66454744/flutter-desktop-ignore-mouse-events)、[Click through window](https://stackoverflow.com/questions/71059568/flutter-desktop-click-through-window)）。
- 托盘靠 `tray_manager` 第三方插件；多窗口（对话窗 + 宠物窗）支持弱（`desktop_multi_window` 也是第三方且与 window_manager 有兼容问题）。
- 桌面端在"常驻置顶小窗"这一 niche 上正是生态最薄弱处，且插件稳定性/版本跟进风险高。

**维护成本**：一套 Dart 代码，但窗口层要自己维护平台 hack。**取舍**：仅当你重度依赖 Flutter 的 UI 体系时才值得；本项目不建议。

---

### 2.5 双原生方案（Swift/AppKit + WinUI3/WPF）—— "体验天花板，成本地板"

**优点**
- 各平台原生 API 全部第一方支持，无任何兼容层：
  - macOS：`NSWindow`（`isOpaque=false`、`level=.floating/.screenSaver`、`ignoresMouseEvents`、`collectionBehavior` 跨 Space）、`NSStatusItem` 托盘、Core Animation/SpriteKit 动画，**性能与省电最优**；已有大量 Swift 桌宠教程（如 [用 Swift 手搓 macOS 桌面宠物](https://jishuzhan.net/article/2064638626436296706)）。
  - Windows：WPF `AllowsTransparency=true` + `Topmost` + `WS_EX_TRANSPARENT` 点击穿透是**经过大量实践验证**的成熟路线（中文社区"异形窗口/点击穿透"资料极多，如[林德熙的 WPF 异形窗口](https://blog.lindexi.com/post/WPF-%E5%88%B6%E4%BD%9C%E6%94%AF%E6%8C%81%E7%82%B9%E5%87%BB%E7%A9%BF%E9%80%8F%E7%9A%84%E9%AB%98%E6%80%A7%E8%83%BD%E7%9A%84%E9%80%8F%E6%98%8E%E8%83%8C%E6%99%AF%E5%BC%82%E5%BD%A2%E7%AA%97%E5%8F%A3.html)）；WinUI3 也可（透明需 Win32 互操作，见 [WinUI3 无边框透明窗口指南](https://linux.do/t/topic/1790806)）。

**缺点**
- **两套代码 = 两套产品**：UI、动画、AI 集成、托盘、更新、打包全都要写两遍，长期维护成本是其他方案的 2–3 倍；团队技能也要分裂（Swift + C#）。
- Live2D/Spine 等动画资产在两个原生栈都要单独集成（Web 版 SDK 不直接可用）。
- macOS 端需要完整 Xcode（你未安装）且发布需 Apple 开发者账号；Windows 端需要独立 Windows 构建机。

**维护成本**：最高。**取舍**：只有当你把"每平台体验极致 + 不在乎双倍人力"作为前提才选它。

---

## 3. macOS 26 (Tahoe) 兼容性专项查证

| 技术栈 | macOS 26 上的已知问题 | 结论 / 对策 |
|---|---|---|
| Electron | **< v40 存在 Tahoe 性能 bug**：长期覆盖 Apple 私有 cornerMask API 导致 WindowServer GPU 负载飙升、全局掉帧（[The Register](https://www.theregister.com/2025/10/02/macos_26_electron_slowdown?td=keepreading)）；Electron 40 起停止覆盖该私有 API（[PR #48376](https://github.com/electron/electron/pull/48376)），macOS 侧 beta 也修复（[9to5Mac](https://9to5mac.my/2025/11/21/mac-tahoe-electron-performance-bug/)） | ✅ 用 Electron ≥ 40（现稳定版已 v42）即无此问题；老版本应用（如未更新的 Slack/Discord）才会卡顿 |
| Electron（透明/毛玻璃） | macOS 26 上 vibrancy/毛玻璃有主题相关的失效报告（[Obsidian 论坛](https://forum.obsidian.md/t/translucent-window-shows-no-vibrancy-blur-on-macos-26-works-in-other-apps-fails-in-themes-default/115493)），第三方库 electron-liquid-glass 受影响 | ⚠️ 桌宠一般不需要毛玻璃，普通 alpha 透明不受影响；如要毛玻璃留意 |
| Tauri v2 / WKWebView | 不受 cornerMask 问题影响；但有自身的 macOS 透明窗口 bug（#13415 DMG 后透明失效、#8255 聚焦切换闪烁、#12804 透明+模糊冲突） | ⚠️ 用最新 Tauri 2.x、透明窗口+模糊不要同时开、发布前在 DMG 形态回归测试透明 |
| Qt | 无专项严重问题（Qt 6.8/6.9 适配 macOS 26 正常） | ✅ 正常 |
| Flutter | 无专项严重问题，但窗口层插件在系统升级后常有兼容性滞后 | ⚠️ 常规风险 |

---

## 4. 工程前置：Rust 工具链安装成本（选 Tauri 必读）

开发机现状：**无 rustc、无 Xcode CLT**（Tauri 在 macOS 上编译需要 Xcode CLT 提供 clang/linker/SDK，二者缺一不可）。

| 步骤 | 内容 | 耗时（参考） |
|---|---|---|
| 1 | `xcode-select --install` 安装 Xcode Command Line Tools | 下载数 GB，约 5–15 分钟 |
| 2 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`（或国内镜像加速） | 约 2–5 分钟 |
| 3 | `cargo install tauri-cli --locked`（或改用 `npm i -D @tauri-apps/cli`，省去全局安装） | 数分钟 |
| 4 | 首次 `cargo build`（下载约 400+ crate，macOS 全量编译） | 首次约 3–10 分钟，之后增量秒级 |

结论：**一次性成本约 10–30 分钟**（含下载），磁盘占用约 2–4 GB（Xcode CLT 大头）。国内网络建议配 rustup 与 crates.io 镜像源。之后日常开发与 Electron 无异（前端仍是 JS/TS）。Windows 端构建需额外在 Windows 机器装 MSVC Build Tools + WebView2（Win10/11 一般已预装）。

---

## 5. 最终推荐及工程理由

### 🥇 主推：Tauri v2（Rust + 系统 WebView）

**理由：**
1. **桌宠是 24h 常驻应用，"资源占用"是长期产品力**：Tauri 包体 5–15 MB、空闲内存 40–90 MB，对比 Electron 的 150–400 MB 常驻，在"开机自启、全天置顶"的形态下是决定性差异（省电、省内存、不拖慢系统）。
2. **五类核心需求全部可用官方/半官方 API 覆盖**：透明、置顶、穿透、托盘齐全；动画用 Web 技术栈（Live2D/Lottie/Spine），资产生态与 Electron 几乎等价。
3. **一套代码双平台**，Rust 后端还方便接系统级能力（全局快捷键、文件监听、后续接本地模型/LLM 推理的原生库）。
4. **可行性已被 2026 年的真实桌宠项目验证**（NekoAI、OpenPet、CodexPetDesk 等），且 Tauri 2.x 自 2024-10 稳定后迭代快、社区持续增长（对比 Electron 的"稳定但停滞的窗口 API"）。
5. 工具链成本是**一次性**的（§4，约 10–30 分钟），不构成长期负担。

**必须接受的代价与对策：**
- macOS 透明窗口 open bug → 紧跟最新 2.x、透明与模糊不同开、DMG 后回归测试（已有社区 workaround 可抄）。
- 无 forward 事件转发 → 桌宠"整体穿透/整体交互"够用；若要做"局部穿透"，用全局鼠标事件自行实现（或改用 Windows `WM_NCHITTEST` / macOS `hitTest`）。
- Rust 学习曲线 → 业务逻辑可尽量留在前端，Rust 只做壳与系统能力。

### 🥈 备选：Electron

**适用场景：** 团队想"零原生工具链、本周出 Demo"；或需要 forward 事件转发做精细的局部穿透交互；或重度依赖 Chromium 特有 Web 能力（WebGPU、DevTools 协议等）。
**代价：** 常驻内存/耗电显著更高；macOS 26 上必须锁 Electron ≥ 40；透明窗口阴影/圆角手工处理。
**落地要点：** 锁定 ≥ v42；`transparent + frame:false`、`alwaysOnTop`（macOS 配 `level:'screen-saver'` + `setVisibleOnAllWorkspaces`）、`setIgnoreMouseEvents(true,{forward:true})`、内置 `Tray`；动画用 Live2D Web SDK / Lottie；后续迁移 Tauri 时前端资产可复用。

### ❌ 不推荐

- **Flutter Desktop**：透明/穿透/置顶全靠第三方插件拼凑，恰好在桌宠最核心的窗口能力上最弱，风险最高。
- **双原生**：体验天花板，但两套代码的长期维护成本对单团队是沉重的；除非未来团队分裂为 mac 组 + win 组再考虑。
- **Qt/QML**：技术上完全可行且性能好，但授权合规 + 动画资产生态弱 + AI 集成生态弱，综合性价比低于 Tauri。

### 决策速查

```
要"常驻省资源 + 原生手感 + 一套代码"          → Tauri v2（先装 Rust + Xcode CLT，10–30 分钟）
要"零安装最快出 Demo / 精细局部穿透 / 强 Web 能力" → Electron（≥v40，接受内存耗电）
```

---

## 6. 主要参考来源

- Electron：透明/无边框官方文档 [自定义窗口交互](https://az.electronjs.org/zh/docs/latest/tutorial/custom-window-interactions)；[issue #23042 点击穿透回归](https://github.com/electron/electron/issues/23042)；[issue #36364 置顶+全屏 Space 缺陷](https://github.com/electron/electron/issues/36364)；Tahoe 性能 bug：[The Register](https://www.theregister.com/2025/10/02/macos_26_electron_slowdown?td=keepreading)、[PR #48376](https://github.com/electron/electron/pull/48376)、[9to5Mac](https://9to5mac.my/2025/11/21/mac-tahoe-electron-performance-bug/)、[Hacker News 讨论](https://news.ycombinator.com/item?id=45469468)
- Tauri：v2 稳定发布 [官方博客](https://tauri.app/blog/tauri-20/)；透明窗口 bug [issue #13415](https://github.com/tauri-apps/tauri/issues/13415)、[#8255](https://github.com/tauri-apps/tauri/issues/8255)、[#12804](https://github.com/tauri-apps/tauri/issues/12804)；无 forward [issue #6164](https://github.com/tauri-apps/tauri/issues/6164)、[讨论 #11507](https://github.com/orgs/tauri-apps/discussions/11507)；Tauri 桌宠实例 [NekoAI](https://github.com/nucket/NekoAI)、[OpenPet](https://github.com/X-T-E-R/OpenPet)、[convai-desktop-pet](https://github.com/AkshitIreddy/convai-desktop-pet)；[Why I Chose Tauri v2 for a Desktop Overlay in 2026](https://dev.to/manasightgg/why-i-chose-tauri-v2-for-a-desktop-overlay-in-2026-597h)
- Qt：桌宠形态窗口实践 [Create a Frameless Desktop-Pet-Style Window in Qt](https://greatzaochen.dev/en/posts/8cd07b68/)；穿透 flag Wayland 问题 [Qt 论坛](https://forum.qt.io/topic/154266/windowtransparentforinput-not-worked-on-wayland/3?lang=en-GB)
- Flutter：窗口能力短板 [Ignore Mouse Events](https://stackoverflow.com/questions/66454744/flutter-desktop-ignore-mouse-events)、[Click through window](https://stackoverflow.com/questions/71059568/flutter-desktop-click-through-window)、[window_manager](https://github.com/AdguardTeam/window_manager)、[flutter_acrylic](https://pub.dev/packages/flutter_acrylic)
- 双原生：macOS 桌宠教程 [用 Swift 手搓 macOS 桌面宠物](https://jishuzhan.net/article/2064638626436296706)；WPF 异形窗口点击穿透 [林德熙](https://blog.lindexi.com/post/WPF-%E5%88%B6%E4%BD%9C%E6%94%AF%E6%8C%81%E7%82%B9%E5%87%BB%E7%A9%BF%E9%80%8F%E7%9A%84%E9%AB%98%E6%80%A7%E8%83%BD%E7%9A%84%E9%80%8F%E6%98%8E%E8%83%8C%E6%99%AF%E5%BC%82%E5%BD%A2%E7%AA%97%E5%8F%A3.html)；WinUI3 无边框透明 [LINUX DO](https://linux.do/t/topic/1790806)；WinUI3 点击穿透 [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1418063/(winui3)-semi-transparent-window-click-through-win)
- macOS 26 毛玻璃问题：[Obsidian 论坛](https://forum.obsidian.md/t/translucent-window-shows-no-vibrancy-blur-on-macos-26-works-in-other-apps-fails-in-themes-default/115493)
- Tauri 前置条件（Rust/Xcode CLT）：[Tauri 官方 Prerequisites](https://tauri.app/start/prerequisites/)、[中文版](https://v2.tauri.org.cn/start/prerequisites/)
