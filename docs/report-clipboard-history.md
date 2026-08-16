# 剪贴板历史（Clipboard History）专项调研报告

> 面向：桌面宠物 AI 助手（Electron ≥ v42，macOS 优先，后期兼容 Windows）
> 调研时间：2026 年；资料范围：2023–2026（优先 2024–2026）
> 配套文档：`docs/decision-summary.md`（决策汇总）、`docs/report-desktop-pet-cross-platform.md`（托盘/通知/窗口）
> 状态：✅ 调研完成，可直接进入实现

---

## 0. TL;DR（结论先行）

1. **macOS 监听机制**：`NSPasteboard` 没有公开的"内容变化通知"，业界唯一主流做法是**轮询 `changeCount`（常见 0.5s）**；pasteboard owner 回调不可用于通用监听。⚠️ 但 **Electron 的 `clipboard` 模块没有暴露 `changeCount`**，纯 Electron 只能"内容比对轮询"，要拿到 `changeCount` 需要一个小型 native addon（见 §2.4、§8）。
2. **macOS 隐私提示——重要修正**：**macOS 14 Sonoma 本身并没有"后台读剪贴板就弹提示"的通用机制**（该前提不准确）。真正的分水岭是 **macOS 26 Tahoe（2025-09 发布，WWDC25 宣布）**：App 在**无用户交互**情况下访问剪贴板将触发系统警告（类似 iOS 的粘贴权限提示），同时苹果还**内置了系统级剪贴板历史**（Spotlight 集成）。这对"桌宠常驻后台 + 持续轮询读剪贴板"是**致命打击**，必须改为"交互时同步 + 显式授权常驻"的双层策略（详见 §3）。
3. **Electron 影响**：`clipboard.readText()` 底层就是读 NSPasteboard，**同样受 macOS 26 警告约束，无豁免**；Electron 官方正在给 clipboard 读操作加权限检查（PR #45473），方向与苹果一致。
4. **Windows**：首选 `AddClipboardFormatListener` + `WM_CLIPBOARDUPDATE`（事件驱动，无轮询），但 Electron 主进程拿不到自己窗口的 WndProc，需要 native addon；MVP 可用 0.3–0.5s 轮询兜底。Win+V 内置历史与第三方可共存，但系统历史功能有限（无搜索/固定/图片弱）。
5. **功能设计**：文本/图片/文件/富文本四类；SQLite（FTS5）存储 + 内容哈希去重 + pin 标记 + 全局快捷键 + "写回剪贴板 + 可选自动粘贴（辅助功能权限）"。
6. **开源参考**：Maccy（Swift/轮询/SQLite）、CopyQ（Qt/跨平台/平台抽象层）、Flycut、Jumpcut，以及多个 Electron 剪贴板历史项目（ClipChronicle、clipboard-elephant 等）——详见 §6。
7. **与桌宠集成**：点击桌宠弹出面板为主 + 全局快捷键 + 托盘为辅；AI 结合点：对历史条目做翻译/总结/格式化；架构落点遵循 monorepo 平台工厂模式（§7）。

---

## 1. macOS 剪贴板监听机制

### 1.1 结论：changeCount 轮询是唯一主流方案

`NSPasteboard`（`NSPasteboard.general`）**没有公开的内容变化通知**。可选方案对比：

| 方案 | 原理 | 可行性 | 采用者 |
|---|---|---|---|
| **轮询 `changeCount`**（推荐） | `changeCount` 是全局递增整数，任何 app 写入剪贴板都会 +1；定时读取并与上次比较，变化则拉取内容 | ✅ 简单可靠，业界事实标准 | Maccy、Flycut、Jumpcut、PastePal、CopyQ(macOS 后端) 等 |
| pasteboard owner 回调 | `declareTypes(_:owner:)` 后，owner 会收到 `pasteboardChangedNotification` | ❌ 只对"自己声明的类型被其他方请求/修改"生效，且成为 owner 会干扰正常复制；**无法用于监听第三方写入** | 基本无人用于通用监听 |
| 系统通知（`NSNotification`） | 不存在的公开通知 | ❌ 无 | — |
| macOS 26 新 API | 目前**没有**公开的"剪贴板变化通知"API（苹果内置历史是系统私有的） | ❌ 无 | — |

### 1.2 轮询间隔怎么选

- **0.5s 是事实标准**：Maccy 源码用 `Timer` 定时 0.5s 轮询 `changeCount`，Flycut/Jumpcut 同量级。0.5s 对"复制→记录"的体感延迟可忽略，CPU 占用极低（读一个整数，macOS 下几乎为零）。
- 可配区间 **0.3–1.0s**：需要更快响应（如配合 AI 场景）用 0.3s；追求省电用 1s。不建议低于 0.2s（无意义且放大隐私提示频率）。
- 只比较 `changeCount` 整数即可判定"变了"，**变后再读内容**；内容读取才涉及隐私提示与开销（§3）。

### 1.3 判重与内容读取

`changeCount` 变化 ≠ 内容变化（同一内容连续复制、密码管理器定时覆写等也会 +1）。业界统一做法：**内容哈希去重**——读内容后算 SHA-256，与最新一条相同则只更新时间戳不新增条目（§5.3）。

### 1.4 ⚠️ Electron 的关键缺口：没有 changeCount API

Electron `clipboard` 模块**没有暴露 `NSPasteboard.changeCount`**。因此纯 Electron 的轮询只能：

- 每次轮询调用 `clipboard.readText()` / `availableFormats()` 并与上次比对（**内容级轮询**）—— 每次都在读内容，macOS 26 上隐私提示风险更高、开销更大；
- 或者写一个极小的 native addon（Node-API + Objective-C，十几行）暴露 `changeCount`（**只读整数、不读内容**），再配合 Electron 的读取 API。推荐后者（§8 给出思路）。

---

## 2. macOS 剪贴板访问隐私提示：查证结果与对策（重点章节）

> ⚠️ **先修正一个常见认知偏差**：**macOS 14 Sonoma 并没有"任何 app 后台读剪贴板就弹系统提示"的通用机制**。查证后的真实时间线如下。

### 2.1 真实时间线（2023–2026）

| 系统版本 | 时间 | 与剪贴板相关的隐私/行为变化 | 对剪贴板历史类 App 的影响 |
|---|---|---|---|
| macOS 14 Sonoma | 2023-09 | 无针对普通 App 的剪贴板读取提示；个别 app 出现兼容性回归（如 wezterm 的复制问题） | 基本无影响 |
| macOS 14.4–14.5 | 2024 | 针对 **Terminal/SSH 会话**的 pasteboard 防护修复（CVE 类修复）：远程会话访问本机剪贴板会弹确认 | 只影响 Terminal 场景，不影响普通 App |
| macOS 15 Sequoia | 2024-09 | 剪贴板管理器出现兼容问题（如 [Maccy #882：Sequoia 上粘贴不工作](https://github.com/p0deje/Maccy/issues/882)）；无系统级读提示 | 轻度：个别粘贴路径回归 |
| **macOS 26 Tahoe** | **2025-09 发布（WWDC25 宣布）** | **两个重磅变化**：① **剪贴板隐私保护**——App 在**无用户交互**时访问剪贴板会触发系统警告/通知，并新增控制选项，类似 iOS 的"粘贴自其他 App"权限；② **内置剪贴板历史**（Spotlight 集成） | **重大影响**：后台轮询读剪贴板的 App 会频繁触发系统警告；同时苹果自家历史功能上线 |
| macOS 26.x 后续 | 2025–2026 | 持续收紧：26.4 起 Terminal 粘贴命令也会弹警告（防 ClickFix 攻击） | 方向明确：剪贴板读取将越来越"需要用户在场" |

**关键证据**：
- [9to5Mac：macOS 16 to enable clipboard privacy protection, mirroring iOS alerts and adding new controls](https://9to5mac.com/2025/05/12/macos-16-clipboard-privacy-protection/)（2025-05-12）
- [MacRumors：Apple to Block Mac Apps From Secretly Accessing Your Clipboard](https://www.macrumors.com/2025/05/12/apple-mac-apps-clipboard-change/)（2025-05-12）
- [Cult of Mac：macOS 16 to clamp down on clipboard snooping by Mac apps](https://www.cultofmac.com/news/macos-16-clamp-down-clipboard-snooping-by-mac-apps)
- [heise：More warning dialogs ahead: Apple regulates access to macOS clipboard](https://www.heise.de/en/news/More-warning-dialogs-ahead-Apple-regulates-access-to-macOS-clipboard-10380754.html)
- [36氪：加强隐私保护，苹果阻止 Mac 应用随意读取剪贴板](https://36kr.com/p/3295144909998341)
- 内置历史：[macmost：How To Use the Spotlight Clipboard History In macOS Tahoe](https://macmost.com/how-to-use-the-spotlight-clipboard-history-in-macos-tahoe.html)、[MacObserver](https://www.macobserver.com/tips/how-to/use-clipboard-history-on-macos-tahoe/)、[dev.to：macOS Tahoe has built-in clipboard history — what it's still missing for developers (2026 update)](https://dev.to/jrw0ng/macos-tahoe-has-built-in-clipboard-history-heres-what-its-still-missing-for-developers-2026-4eko)

### 2.2 触发条件的精确描述（基于现有报道的谨慎表述）

- 苹果宣布的是 **"App 在无用户交互（without user interaction）时访问 pasteboard 会触发警告"**，形态为系统级警告/通知，并"新增控制选项"（与 iOS 16 的粘贴权限弹窗对齐）。
- 可操作的理解：**用户当前正与你的 App 交互（前台、最近有点击/按键）时读取，不触发；后台静默轮询读取，触发。**
- 判断标准是"是否有用户交互"，不是"是否跨 App"（读剪贴板天然就是跨 App 读别人写的内容，系统不区分）。

### 2.3 对"桌宠 + 剪贴板历史"的具体影响

桌宠的形态是**常驻后台 + 透明置顶小窗口 + 点击穿透**，正是 macOS 26 警告机制瞄准的"后台无交互读取"场景：

- ❌ **危险做法**：启动即后台 0.5s 轮询读剪贴板 → macOS 26 上会**高频弹出系统警告**，体验灾难，且未来可能被系统直接拦截。
- ✅ **可行做法**（业界主流演进方向）：
  1. **交互时同步**：只在"用户激活桌宠 / 呼出面板 / 点击历史按钮"等**用户在场事件**时读取剪贴板并入历史（此时有用户交互，不触发警告）。
  2. **显式授权常驻**：首次启用剪贴板历史时向用户说明"需要常驻监听剪贴板，macOS 26 可能会弹出系统提示，请选择允许"，让用户在知情下打开"常驻监听"开关（对应苹果新增的控制选项）；已入库内容之后**读缓存**，不再读系统剪贴板。
  3. **分层策略（推荐，见 §8.3）**：按 `process.getSystemVersion()` 或 `darwin 版本` 分流——macOS < 26 全量常驻轮询；macOS ≥ 26 默认"交互时同步"，提供"常驻监听"开关。
  4. 监听循环里**只轮询 `changeCount` 整数**（native addon），变化了再在**下一次用户交互时**补拉内容——把"读内容"全部收敛到用户在场时刻。
- 2024–2026 新变化总结：**macOS 26 是分水岭**；未来方向是"剪贴板读取必须伴随用户交互或显式授权"，任何"后台无感抓取"设计都应视为不可持续。

### 2.4 对 Electron 的影响

- `clipboard.readText()` 等底层就是读 NSPasteboard，**受同样约束，无豁免**。
- Electron 官方已在适配：PR [#45473 "route deprecated sync clipboard read through permission checks"](https://github.com/electron/electron/pull/45473) —— 说明 Electron 正把剪贴板读操作纳入权限检查，方向与苹果一致。
- 结论：**别指望 Electron 帮你规避**，要在应用层设计"交互时读取"策略；同时注意 Electron 自身版本必须 ≥ v42（项目红线，兼有 macOS 26 性能修复）。

---

## 3. Electron 的 clipboard 模块能力

### 3.1 支持的数据类型与 API

| 类型 | 读 | 写 | 说明 |
|---|---|---|---|
| 纯文本 | `readText()` | `writeText(text)` | 跨平台 |
| HTML | `readHTML()` | `writeHTML(html)` | 跨平台 |
| 富文本 RTF | `readRTF()` | `writeRTF(rtf)` | macOS/Windows |
| 图片 | `readImage()` → `nativeImage` | `writeImage(nativeImage)` | 跨平台；PNG/JPEG 等 |
| 书签（URL 链接） | `readBookmark()` | `writeBookmark(title, url)` | **仅 macOS**（NSPasteboard 的 URL 类型） |
| 原始 Buffer | `readBuffer(format)` | `writeBuffer(format, buf)` | 自定义格式（见文件路径） |
| 统一读写 | `read(Data)` | `write(Data)` | `{text, html, image, rtf, bookmark, format}` |
| 格式探测 | `availableFormats()` | — | 返回当前剪贴板所有类型名（如 `public.utf8-plain-text`、`public.png`、`NSFilenamesPboardType`） |
| 清空 | `clear()` | — | — |

- **文件路径**：Electron **没有**正式的 `readFiles()/writeFiles()` API（[feature request #44221 仍 open](https://github.com/electron/electron/issues/44221)）。做法是：
  - 写文件复制：`clipboard.writeBuffer('text/uri-list', Buffer.from('file:///path\n...'))`，macOS 也可写 `'NSFilenamesPboardType'`（属性列表格式）；
  - 读文件列表：macOS 用 `readBuffer('NSFilenamesPboardType')` 解析（注意 [issue #39853：`clipboard.read` 对 `text/uri-list` 有 bug](https://github.com/electron/electron/issues/39853)，需规避或用 buffer 路径）。
- **同步 API**：主进程与渲染进程都可用；建议**统一在主进程访问**（渲染进程访问受页面聚焦状态影响，且权限语义更清晰）。

### 3.2 Electron 没有的东西

- ❌ 无剪贴板**变化事件**（无 `app.on('clipboard-change')` 之类）——必须自己轮询或 native addon。
- ❌ 无 `changeCount` 暴露（见 §1.4）。

---

## 4. Windows 剪贴板监听

### 4.1 机制对比

| 方案 | 原理 | 优缺点 |
|---|---|---|
| **`AddClipboardFormatListener` + `WM_CLIPBOARDUPDATE`**（推荐） | 向系统注册监听，剪贴板变化时向你的消息窗口投递 `WM_CLIPBOARDUPDATE` | ✅ 事件驱动、零轮询、低开销；⚠️ 需要一个窗口句柄与消息循环，且**拿不到内容**（仍要自己 `GetClipboardData`） |
| 轮询 `IsClipboardFormatAvailable`/内容比对 | 定时器轮询 | ✅ 简单、无 native 依赖；⚠️ 有延迟与开销 |
| 挂钩 `SetClipboardData`（钩子） | 全局 hook | ❌ 侵入性强、易被杀软拦截、Electron 内不可行 |

### 4.2 与 Electron 结合的落地方式

- Electron 主进程**拿不到自己窗口的 WndProc**（[issue #31173：无法在 Electron 窗口内拦截 WM_CLIPBOARDUPDATE](https://github.com/electron/electron/issues/31173)）。两个可行路线：
  1. **MVP：轮询**（0.3–0.5s 内容比对），零 native 依赖，先跑通功能；
  2. **进阶：native addon**（Node-API）创建隐藏消息窗口 + `AddClipboardFormatListener`，把 `WM_CLIPBOARDUPDATE` 通过回调/事件推给主进程，再在主进程用 Electron API 读内容。
- 社区现成轮询库：[electron-clipboard-watcher](https://www.npmjs.com/package/electron-clipboard-watcher)（joshwnj，内容比对型）可作参考，但维护一般，建议自研薄封装。

### 4.3 Win+V 内置剪贴板历史对第三方的影响

- Windows 10 1809+ / 11 自带剪贴板历史（Win+V），可保存文本/少量图片，支持云同步。
- 对第三方工具的实际影响：**并存为主**。系统历史能力有限——**无搜索、无固定（pin）、图片支持弱、容量小**，且依赖系统设置开启；因此第三方管理器（历史容量、搜索、固定、AI 处理）仍有明确价值。
- 技术上：WinRT 的 `Windows.ApplicationModel.DataTransfer.ClipboardHistory` 可读系统历史但**受限**（需开启系统历史与隐私设置、无图片、API 封闭），主流第三方（如 CopyQ）**不依赖它，仍自建监听**。结论：**自建监听 + 差异化功能**是正确路线，无需对接系统历史。

---

## 5. 功能设计要点

### 5.1 支持类型与存储模型

| 类型 | 记录内容 | 存储 | 容量建议（默认，可配） |
|---|---|---|---|
| 文本 | 字符串 | 入库 SQLite | 500–2000 条 |
| 富文本 | HTML + 纯文本兜底 | 入库（HTML 字段） | 与文本同池，限制单条大小（如 256KB） |
| 图片 | PNG 字节 + 缩略图 | 文件系统 + DB 记录路径/尺寸/哈希 | 50–200 张，或按总大小（如 200MB） |
| 文件 | 文件路径列表（**不存文件内容**） | DB 记录路径 | 500 条 |
| 其他/无法识别 | 忽略 | — | — |

统一表结构（示意）：

```sql
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,            -- text | html | image | file
  content TEXT,                  -- 文本/html 原文（文件类型存路径 JSON）
  image_path TEXT,               -- 图片文件路径（缩略图 thumb_path）
  hash TEXT NOT NULL,            -- SHA-256（去重键）
  is_pinned INTEGER DEFAULT 0,   -- 固定
  source_app TEXT,               -- 来源 app（macOS NSWorkspace.frontmostApplication）
  copied_at INTEGER NOT NULL,    -- 时间戳
  created_at INTEGER NOT NULL
);
```

### 5.2 关键策略

- **去重**：内容哈希（SHA-256）。同内容连续复制/密码管理器覆写 → 只更新时间戳，不新增。
- **清理**：LRU 按 `copied_at` 淘汰，**pinned 条目永不淘汰**；图片按总容量淘汰。
- **搜索**：SQLite **FTS5**（`better-sqlite3`，需 `electron-rebuild`）；中文建议用 FTS5 `trigram` tokenizer（对中文搜索友好）；纯前端可用 MiniSearch 兜底（内存索引，数据量大时不如 FTS）。
- **固定（pin）**：`is_pinned` 标记，列表置顶分组，不参与清理。
- **暂停记录**：全局快捷键"暂停/恢复"（如 Cmd+Shift+P）+ 忽略来源 app 列表（macOS 用 `NSWorkspace.shared.frontmostApplication` 取前台 app 名；注意 macOS 26 上"读前台 app"本身是安全的，不读剪贴板内容）。
- **敏感内容**：
  - 无法可靠识别"密码框复制"（剪贴板 API 无来源上下文）；提供**启发式关键词过滤**（`password/token/secret/私钥` 等，可配）；
  - 提供"忽略密码管理器来源 app"（1Password/Keychain Access 等）；
  - 提供"本次复制不记录"的兜底快捷键；
  - 图片不记录裸照类无法判定——由用户开关"不记录图片"。
- **存储安全**：
  - 默认本地明文 SQLite（Maccy 等主流同款，性能与可搜索性最佳）；**绝不云同步敏感内容**；
  - 提供"加密存储"选项：macOS 用系统 Keychain 派生密钥（`safeStorage`/`keytar`）加密敏感字段，或整体 SQLCipher；成本：搜索变难（FTS 对密文失效）——权衡后建议"默认明文 + 用户可选对**密码类关键词条目**加密或直接不记录"。

### 5.3 点击粘贴的实现

| 方案 | 实现 | 优点 | 缺点 |
|---|---|---|---|
| **A. 写回剪贴板 + 提示 Cmd+V**（默认） | `clipboard.writeText(...)` 后 toast "已复制，Cmd+V 粘贴" | 零权限、零风险、跨平台 | 多一步用户操作 |
| **B. 写回 + 自动模拟 Cmd+V**（可选项） | 写回后模拟按键：macOS `CGEventPost` 发 Cmd+V；Windows `SendInput` | 一键粘贴，体验最好 | macOS 需要**辅助功能（Accessibility）权限**；Windows 需要 UIAccess/管理员或被输入法干扰；Electron 内 `webContents.paste()` **只能粘贴到自己的页面**，对系统级粘贴无效 |
| C. Electron 内粘贴 | `webContents.paste()` | 仅面板内可用 | 粘贴目标受限，不适用于"粘贴到别的 App" |

> 结论：默认 **A**；提供 **B** 作为"自动粘贴"开关（申请辅助功能权限，需在设置页引导，因为 macOS 无法弹窗申请 Accessibility）。

### 5.4 全局快捷键

- `globalShortcut.register('CommandOrControl+Shift+V', showPanel)` —— 跨平台统一写法；呼出面板时同步剪贴板（用户在场，隐私安全）。
- 注意：macOS 上与系统保留键（Cmd+Space 等）冲突会注册失败，需检测失败并提示用户在设置里改键；参考 Maccy 的做法（默认 Cmd+Shift+V，可自定义）。

---

## 6. 开源参考清单

### 6.1 macOS 原生

| 项目 | 技术 | 亮点/可借鉴点 | 链接 |
|---|---|---|---|
| **Maccy** | Swift/SwiftUI，MIT | 剪贴板管理器标杆：0.5s 轮询 changeCount、SQLite 存储、快捷键弹出搜索、pin；**Sequoia 兼容问题 #882 可作"新系统适配"教训** | [github.com/p0deje/Maccy](https://github.com/p0deje/Maccy)（[changelog](https://maccyapp.com/changelog)、[issue #882](https://github.com/p0deje/Maccy/issues/882)） |
| **CopyQ** | Qt/C++，GPLv3 | 跨平台剪贴板管理器：**平台抽象层**（macOS 轮询/Windows 消息）+ 插件/脚本/加密 + 观察者模式架构；我们的"平台工厂"可直接对齐其思路 | [github.com/hluk/CopyQ](https://github.com/hluk/CopyQ)（[Clipboard Monitoring 架构](https://deepwiki.com/hluk/CopyQ/5.3-clipboard-monitoring)、[平台抽象](https://deepwiki.com/hluk/CopyQ/2.4-platform-abstraction)） |
| **Flycut** | Objective-C | 老牌轮询实现；**按 App 禁用**（[issue #225](https://github.com/TermiT/Flycut/issues/225)）对我们"忽略敏感来源 app"有参考价值 | [github.com/TermiT/Flycut](https://github.com/TermiT/Flycut) |
| **Jumpcut** | Objective-C | 最老牌的 macOS 剪贴板管理器，菜单栏形态参考 | [github.com/snark/jumpcut](https://github.com/snark/jumpcut) |
| **Paste**（商业） | Swift | 商业标杆：智能分组/去重/搜索体验；App Store 形态 | [pasteapp.me](https://pasteapp.me) |
| **PastePal**（商业） | Swift | 通用剪贴板 + 多端同步 | [App Store](https://apps.apple.com/us/app/clipboard-manager-pastepal/id1503446680) |

### 6.2 Electron / JS 技术栈

| 项目 | 说明 | 链接 |
|---|---|---|
| **ClipChronicle** | AI-powered 跨平台 Electron 剪贴板管理器，本地优先存储 + 搜索，含 Chrome 扩展与落地页——与我们"桌宠 + AI"定位最接近的参考 | [github.com/hoangsonww/ClipChronicle-Cross-Platform-App](https://github.com/hoangsonww/ClipChronicle-Cross-Platform-App) |
| **clipboard-elephant** | Electron 剪贴板历史管理器（CodingGarden） | [github.com/CodingGarden/clipboard-elephant](https://github.com/CodingGarden/clipboard-elephant) |
| **clipboard-manager-js** | 跨平台 Electron 剪贴板管理器 | [github.com/mahhov/clipboard-manager-js](https://github.com/mahhov/clipboard-manager-js) |
| **ClipboardHistory**（savannahar68） | Electron 实现的剪贴板管理器 | [github.com/savannahar68/ClipboardHistory](https://github.com/savannahar68/ClipboardHistory) |
| **clipboard-history**（sudhakar3697） | 跨平台剪贴板历史应用 | [github.com/sudhakar3697/clipboard-history](https://github.com/sudhakar3697/clipboard-history) |
| electron-clippy 主题 | 相关 Electron 剪贴板项目集合 | [repos.ecosyste.ms/topics/electron-clippy](https://repos.ecosyste.ms/topics/electron-clippy) |
| **electron-clipboard-watcher**（npm） | 轮询型监听参考实现 | [npmjs.com/package/electron-clipboard-watcher](https://www.npmjs.com/package/electron-clipboard-watcher) |

### 6.3 关键文章与一手资料

- [The Invisible Complexity of Clipboard Monitoring（Deck）](https://deckclip.app/blog/clipboard-monitoring)（[中文版](https://deckclip.app/zh-cn/blog/clipboard-monitoring)）——剪贴板监控的隐藏复杂性（类型、时序、去重）。
- [灵剪 Cliperx：剪贴板历史塞进灵动岛的 macOS 工具，踩坑分享](https://www.cnblogs.com/xizhe-chan/p/20508543) —— 极简弹出 UI + 新系统适配经验。
- [PurePaste：SwiftUI 剪贴板意图识别工具技术实践](https://segmentfault.com/a/1190000048014362) —— 剪贴板内容的"意图识别"思路（与 AI 结合点）。
- [I shipped a clipboard manager inside the macOS App Store sandbox（dev.to）](https://dev.to/eduardo_revillavaquero_0/i-shipped-a-clipboard-manager-inside-the-macos-app-store-sandbox-heres-what-works-and-what-5a30) —— 沙盒下剪贴板管理器能做什么/不能做什么（上架经验）。
- [macOS 26 剪贴板隐私（9to5Mac）](https://9to5mac.com/2025/05/12/macos-16-clipboard-privacy-protection/)、[MacRumors](https://www.macrumors.com/2025/05/12/apple-mac-apps-clipboard-change/)、[heise](https://www.heise.de/en/news/More-warning-dialogs-ahead-Apple-regulates-access-to-macOS-clipboard-10380754.html)、[36氪](https://36kr.com/p/3295144909998341)
- [macOS Tahoe 内置剪贴板历史（macmost）](https://macmost.com/how-to-use-the-spotlight-clipboard-history-in-macos-tahoe.html)、[macobserver](https://www.macobserver.com/tips/how-to/use-clipboard-history-on-macos-tahoe/)、[dev.to 开发者视角 2026 更新](https://dev.to/jrw0ng/macos-tahoe-has-built-in-clipboard-history-heres-what-its-still-missing-for-developers-2026-4eko)
- [Security.SE：为什么 macOS 允许 App "主动"访问剪贴板](https://security.stackexchange.com/questions/280180/why-macos-allows-app-to-actively-access-the-clipboard)

---

## 7. 与桌宠的集成方式

### 7.1 UI 形态建议（三级入口）

| 入口 | 交互 | 适合场景 | 实现要点 |
|---|---|---|---|
| **点击桌宠弹出面板**（主推） | 点击桌宠 → 从桌宠位置展开剪贴板面板（列表 + 搜索框） | 与桌宠形态一致，用户主动交互 → **隐私安全**（用户在场才读剪贴板） | 独立无边框 `BrowserWindow`（`frame:false`、`alwaysOnTop`），从桌宠坐标弹出；或桌宠窗口内嵌 popover |
| **全局快捷键**（Cmd+Shift+V） | 任意位置呼出 | 高频用户、桌宠被遮挡时 | `globalShortcut.register`；呼出时同步剪贴板 |
| 托盘菜单 | 托盘 → 剪贴板历史 | 后台管理、设置入口 | 复用同一面板窗口 |

> 面板窗口建议：搜素框 + 类型过滤（全部/文本/图片/文件）+ 列表（缩略图 + 来源 app + 时间）+ 固定置顶分组；Enter 粘贴、Cmd+数字 快捷选择、右键菜单（固定/删除/复制/AI 处理）。

### 7.2 与 AI 助手的结合点

- **AI 处理历史条目**：条目右键/悬停按钮 → "翻译 / 总结 / 格式化 / 提取邮箱电话 / 生成周报 / 翻译成英文" —— 走已有的 OpenAI 兼容封装层（`packages/core` 的 AI client），把条目文本作为输入。
- **AI 对话中引用剪贴板**：用户对桌宠说"翻译我刚复制的文本"，AI 工具调用 `clipboard.getRecent()`（读的是**已入库缓存**，不触发系统剪贴板读取，隐私安全）。
- **智能分类**：借鉴 PurePaste 的意图识别——按内容自动打标签（代码/链接/地址/数字），提升搜索与 AI 上下文质量。
- **与 macOS 26 内置历史的差异化**：系统历史无 AI、无桌宠形态、无跨设备（我们也不做同步敏感数据）——**AI 处理 + 桌宠弹出 + 图片/文件 + 搜索**就是我们的差异化卖点。

### 7.3 架构落点（对齐 monorepo 平台工厂模式）

```
packages/core            # ClipboardHistoryService：存储接口、去重、容量、pin、FTS 查询、暂停/忽略规则（纯 TS）
packages/platform-api    # IClipboardWatcher（start/stop/onItem）+ IClipboardHistoryStore（接口）
apps/desktop/src/main/
  ├── platform/darwin/   # DarwinClipboardWatcher：changeCount 轮询（native addon 暴露 changeCount）+ 交互时同步策略
  ├── platform/win32/    # Win32ClipboardWatcher：MVP 轮询 → 进阶 native addon（AddClipboardFormatListener）
  └── services/          # clipboard-history.service.ts：组装 watcher + store + 隐私策略（分层模式 §8.3）
apps/desktop/src/preload/ # 暴露 clipboard:history 通道（list/search/pin/paste/aiAction）
```

IPC 通道示意：`clipboard:list` / `clipboard:search` / `clipboard:pin` / `clipboard:remove` / `clipboard:paste` / `clipboard:ai-action` / `clipboard:pause-toggle`。

---

## 8. 推荐实现方案（含 Electron 具体 API）

### 8.1 监听器（macOS，主进程）

**方案 1（推荐，native addon 暴露 changeCount）**——只读整数、不读内容，配合"交互时补拉内容"策略：

```ts
// apps/desktop/src/main/platform/darwin/clipboard-watcher.ts
import { clipboard, nativeImage } from 'electron';
import { getPasteboardChangeCount } from '../../native/pasteboard.node'; // Node-API addon

export class DarwinClipboardWatcher {
  private timer?: NodeJS.Timeout;
  private lastCount = getPasteboardChangeCount();
  private paused = false;

  constructor(private readonly onItem: (item: ClipboardItem) => void) {}

  start(intervalMs = 500) {
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  private tick() {
    const count = getPasteboardChangeCount();      // 只读整数，开销≈0
    if (count === this.lastCount || this.paused) return;
    this.lastCount = count;
    if (!this.shouldReadNow()) return;              // §8.3 分层策略：后台不读内容
    this.readAndEmit();
  }

  private readAndEmit() {
    const formats = clipboard.availableFormats();   // Electron API
    if (formats.includes('public.png') || formats.includes('public.tiff')) {
      const img = clipboard.readImage();
      this.onItem({ kind: 'image', image: img.toPNG(), hash: hash(img.toPNG()) });
    } else if (formats.includes('NSFilenamesPboardType')) {
      this.onItem({ kind: 'file', paths: parseFiles(clipboard.readBuffer('NSFilenamesPboardType')) });
    } else if (formats.includes('public.html')) {
      this.onItem({ kind: 'html', text: clipboard.readText(), html: clipboard.readHTML() });
    } else {
      const text = clipboard.readText();
      if (text) this.onItem({ kind: 'text', text });
    }
  }
}
```

> native addon 的 10 行核心（Objective-C）：

```objc
#import <AppKit/AppKit.h>
// NAPI_METHOD(getPasteboardChangeCount) {
//   return Number::New(env, NSPasteboard.generalPasteboard.changeCount);
// }
```

**方案 2（纯 Electron，零 native）**：`tick()` 里直接 `clipboard.readText()` 与上次比对（内容级轮询）。实现最快，但每次轮询都读内容，macOS 26 上仅建议配合"后台不轮询"的交互式策略使用。

### 8.2 监听器（Windows）

```ts
// apps/desktop/src/main/platform/win32/clipboard-watcher.ts（MVP：轮询）
start(intervalMs = 400) {
  this.timer = setInterval(() => {
    const text = clipboard.readText();
    if (text && text !== this.lastText) { this.lastText = text; this.onItem({ kind: 'text', text }); }
    // 图片：clipboard.readImage().isEmpty() 判断
  }, intervalMs);
}
// 进阶：native addon 注册隐藏消息窗口 + AddClipboardFormatListener，
// WM_CLIPBOARDUPDATE → 回调主进程 → Electron API 读内容（零轮询）
```

### 8.3 隐私分层策略（macOS 26 对策，核心）

```ts
type MonitorMode = 'always' | 'on-interaction';

function detectMode(): MonitorMode {
  if (osMajorVersion() < 26) return 'always';        // macOS < 26：全量常驻
  return userEnabledAlwaysWatch() ? 'always' : 'on-interaction'; // macOS ≥ 26：默认交互式
}

// 'on-interaction'：后台只记录 changeCount，不读内容；
// 在 app 'browser-window-focus' / 全局快捷键 / 点击桌宠 等用户在场事件里统一 readAndEmit() 补齐。
```

配套 UX：首次启用时弹窗说明（"macOS 26 起系统会提示剪贴板访问，可选择：仅呼出面板时同步（推荐）/ 常驻监听（可能频繁看到系统提示）"）；设置页提供开关与"忽略来源 App/敏感词/不记录图片"。

### 8.4 粘贴与快捷键

```ts
// 全局快捷键
globalShortcut.register('CommandOrControl+Shift+V', () => { syncNow(); showPanel(); });

// 粘贴（默认方案 A）
function pasteItem(item: ClipboardItem) {
  clipboard.writeText(item.text);            // 或 writeImage/writeHTML/writeBuffer(文件)
  if (settings.autoPaste && hasAccessibility()) {
    simulateCmdV();                          // macOS: CGEventPost Cmd+V（需辅助功能权限）
  } else {
    notify('已复制，按 Cmd+V 粘贴');
  }
}
```

### 8.5 存储

- 主进程 `better-sqlite3`（`electron-rebuild` 后使用）+ FTS5 表（§5.1 结构 + `CREATE VIRTUAL TABLE items_fts USING fts5(content, tokenize='trigram')`）。
- 图片：`app.getPath('userData')/clipboard-images/` + 缩略图目录；DB 只存路径。
- core 层只依赖 `IClipboardHistoryStore` 接口，SQLite 实现放 desktop 壳（保持 core 零平台依赖，对齐项目红线）。

---

## 9. 机制对比总表（速查）

| 维度 | macOS（NSPasteboard） | Windows（Win32） |
|---|---|---|
| 首选监听 | 轮询 `changeCount`（0.5s） | `AddClipboardFormatListener` + `WM_CLIPBOARDUPDATE` |
| 兜底方案 | 内容比对轮询 | 内容比对轮询（0.3–0.5s） |
| Electron 直连 | 无 changeCount API，需 native addon 或内容比对 | 无法拦截 WM_CLIPBOARDUPDATE，需 native addon 或轮询 |
| 读取内容 API | `clipboard.readText/readHTML/readRTF/readImage/readBookmark/readBuffer` | 同左（无 readBookmark；文件用 `text/uri-list` buffer） |
| 系统级历史 | **macOS 26 内置**（Spotlight，无搜索/图片弱） | Win+V（1809+，无搜索/固定） |
| 后台读取隐私 | **macOS 26 起无用户交互读取触发系统警告** | 无系统警告（但杀软/EDR 可能提示） |
| 敏感数据防护 | 关键词/来源 app/暂停记录 + 可选加密 | 同左 |

---

## 10. 行动清单（接入开发路线）

- [ ] **P0 决策**：确认"交互时同步"为默认策略（macOS 26+），常驻监听设为显式开关。
- [ ] P0：`packages/core` 定义 `IClipboardWatcher` / `IClipboardHistoryStore` 接口 + 去重/容量/pin 纯逻辑（可先行单测）。
- [ ] P1：darwin 实现——native addon（changeCount）+ 轮询循环 + 交互事件补拉；面板窗口 PoC（点击桌宠弹出 + 搜索 + 列表）。
- [ ] P1：存储——better-sqlite3 + FTS5（trigram）+ 图片文件存储与缩略图。
- [ ] P2：全局快捷键 + 粘贴（方案 A 先行，B 待辅助功能权限引导完善）。
- [ ] P2：AI 结合——历史条目"翻译/总结/格式化"动作（复用 AI 封装层）；对话工具 `clipboard.getRecent()`。
- [ ] P3：隐私完备——忽略来源 App、敏感词过滤、暂停记录快捷键、加密选项、首次启用说明弹窗。
- [ ] P3：Windows 阶段——轮询 MVP → native addon（AddClipboardFormatListener）→ Win+V 差异化说明。
- [ ] 上线前：在 macOS 26 实机验证警告触发行为（区分"仅读 changeCount"与"读内容"是否都触发），据实调整策略。

---

*报告完。主要一手来源集中在 §2.1、§6.3；实现层面的 Electron API 均基于当前稳定版（v42 兼容）。*
