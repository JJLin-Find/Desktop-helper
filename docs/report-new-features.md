# 桌宠 AI 助手 · 新增功能模块调研报告

> 技术栈：Electron ≥ v42，macOS 优先开发，后期兼容 Windows。
> 调研时间：2025 年 12 月（资料以 2023–2025 为主）。
> 覆盖模块：① 文件搜索 ② 日程管理/提醒 ③ 番茄钟/倒计时 ④ 桌宠娱乐交互。

---

## 0. 结论速览

| 模块 | MVP 推荐方案 | 进阶方向 | 关键权限/注意点 |
|---|---|---|---|
| 文件搜索 | macOS：`child_process` 调 `mdfind`；Windows：随包分发 Everything 便携版 + `es.exe -json` | macOS 原生 `NSMetadataQuery` 实时监听；Windows Everything IPC（SDK DLL）/ 原生模块 | macOS 非沙盒无需专门 entitlement；读受保护目录内容需 TCC；Windows 无权限问题但需随包分发 |
| 日程/提醒 | 本地存储（SQLite）+ 主进程调度 + 系统通知；可选 osascript 写入系统日历 | macOS 原生模块（N-API + Swift）接 EventKit；CalDAV（iCloud/Google）同步 | macOS 14+ 日历/提醒 TCC 权限拆分；osascript 需"自动化"权限；Windows 无系统日历写入 API |
| 番茄钟 | 主进程时间戳调度 + 系统通知 + 音效 + 状态持久化 | 专注统计、与 AI/提醒共用调度层 | 无特殊权限；需处理休眠唤醒/退出恢复 |
| 娱乐交互 | 抚摸/喂食/点击连击/基础心情系统/鼠标追逐 | 迷你游戏、Shimeji 式抓窗口/爬墙、多只同屏、心情联动 AI | 鼠标全局坐标用 `screen.getCursorScreenPoint`；多窗口注意性能 |

**跨模块共享基建（先建，四个模块都依赖）：**

1. **主进程统一调度器（Scheduler Service）**：基于"绝对时间戳 + 轮询/重排"而非 `setTimeout` 累积（避免漂移）；统一注册 `Job { id, type, fireAt, payload }`；重启/唤醒时重算过期任务并补发。番茄钟、提醒、喂食衰减 tick 都注册到此。
2. **统一权限管理器**：集中声明/请求 macOS TCC（文件访问、日历、提醒、自动化）与 Windows 相关能力，权限状态可查、可跳转系统设置。
3. **IPC 规范**：全部走 preload 暴露的白名单 API（`contextIsolation: true`），主进程只暴露 `pet.fileSearch.*`、`pet.calendar.*`、`pet.scheduler.*` 等命名空间。
4. **本地持久化**：结构化数据用 SQLite（`better-sqlite3`），轻量设置用 JSON（`electron-store`），统一放 `app.getPath('userData')`。

---

## 1. 文件搜索

### 1.1 macOS：`NSMetadataQuery` vs `mdfind`

两者底层是同一套 Spotlight 元数据索引（MetadataQuery / MDQuery），区别只在调用形态：

| 维度 | `mdfind`（命令行） | `NSMetadataQuery`（Swift/ObjC） |
|---|---|---|
| 形态 | 命令行工具，读 Spotlight 索引并输出路径 | 框架 API，支持回调/通知 |
| 实时性 | 一次性查询（`-live` 可监听） | 原生支持 `NSMetadataQueryDidUpdateNotification` 增量通知（新文件/改文件即时出现） |
| 在 Electron 中调用 | `child_process.spawn('mdfind', [...])`，零原生代码，解析 stdout | 必须写原生模块（N-API 桥）或独立 helper 进程 |
| 查询语法 | 同一套 Spotlight 查询字符串（`kMDItem*` 属性） | 同一套查询字符串 + `NSPredicate` |
| 适用场景 | MVP 首选，跨平台代码路径统一（Windows 也用 child_process） | 进阶：需要"索引变化实时推送"（类似桌面搜索框边打字边补全） |

**结论**：MVP 用 `mdfind`（child_process），完全够快（毫秒级）；进阶再考虑用原生模块封装 `NSMetadataQuery` 做实时增量，或让 `mdfind -live` 跑在常驻 helper 进程里。

参考：[mdfind man page (ss64)](https://ss64.com/mac/mdfind.html)、[Apple 官方 Spotlight Query 编程指南（File Metadata Search Programming Guide）](https://developer.apple.com/library/archive/documentation/Carbon/Conceptual/SpotlightQuery/Concepts/Introduction.html)、[lululau/mfd（mdfind 封装）](https://github.com/lululau/mfd)、[Eclectic Light: SpotTest（Spotlight 诊断工具）](https://eclecticlight.co/2025/08/18/spottest-1-0-will-help-you-diagnose-spotlight-problems/)。

### 1.2 macOS：TCC 权限与 App Sandbox

- **非沙盒 app（推荐路径）**：读取 Spotlight 元数据**不需要**专门 entitlement，也不需要 TCC 授权——`mdfind` 在普通非沙盒 Electron app 里直接可用。但要注意：搜索结果里的文件路径若位于受保护目录（桌面/文稿/下载），**打开/预览文件内容**会触发 TCC（"文件与文件夹"），需引导用户在系统设置中授权，或用 `inket/FullDiskAccess`（[GitHub](https://github.com/inket/FullDiskAccess)）这类库提示用户授予"完全磁盘访问"（FDA）以解锁全文/内容访问。
- **App Sandbox 下**：Electron 官方默认**不启用沙盒**（分发时按非沙盒签名即可，这也是多数 Electron 桌宠/工具的做法）。若坚持沙盒：没有针对 Spotlight 索引的专门 entitlement，`NSMetadataQuery`/`mdfind` 的结果会被裁剪为"本 app 可访问的文件"，且 `mdfind` 作为子进程继承沙盒限制、行为不稳定——**不建议**为文件搜索上沙盒。
- **注意**：`mdfind` 依赖 Spotlight 索引开启；用户在系统设置关闭了 Spotlight 时结果为空，需在 UI 提示"索引未开启"。

### 1.3 `mdfind` 查询语法速查（AI 转查询时用得到）

```bash
# 按名称（*通配符，c=大小写不敏感）
mdfind "kMDItemFSName == '*报告*'c"

# 按类型（kind / content type tree）
mdfind "kMDItemKind == 'PDF 文稿'"
mdfind "kMDItemContentTypeTree == 'public.image'"
mdfind "kMDItemContentType == 'com.adobe.pdf'"

# 按修改时间（$time.today / $time.this_week / $time.now(-7d)）
mdfind "kMDItemFSContentChangeDate >= \$time.today"
mdfind "kMDItemFSContentChangeDate >= \$time.now(-7d) && kMDItemFSContentChangeDate < \$time.now(-1d)"

# 按标签
mdfind "kMDItemUserTags == '重要'"

# 组合 + 限定目录 + 限量
mdfind -onlyin ~/Documents "kMDItemFSName == '*发票*'c && kMDItemContentTypeTree == 'public.pdf'" -limit 50

# 自然语言（-interpret，能力有限，仅作兜底，不建议作为主路径）
mdfind -interpret "我昨天改的pdf"
```

常用开关：`-name`、`-onlyin <dir>`、`-limit N`、`-count`、`-0`（NUL 分隔，防路径含换行）、`-live`（持续输出）。

### 1.4 Windows：Everything vs Windows Search vs 自扫描

| 方案 | 原理 | 速度 | 集成复杂度 | 说明 |
|---|---|---|---|---|
| **Everything**（推荐） | 直接读 NTFS **USN Journal + MFT**，维护文件名索引 | 毫秒级（打一个字母就出结果） | 低～中：CLI `es.exe` 或 SDK/IPC | 免费、体积小；1.5 版支持 `-json` 输出，Electron 解析零成本；需要用户装 Everything 或**随包分发便携版**（自带 Everything 1.5 x64 绿色版 + 首次运行建索引约数秒～分钟） |
| Windows Search API | 走 `Windows.edb` 索引服务，COM 接口（`ISearchQueryHelper` / `ISearchQueryHelper`、DSearch 示例） | 取决于索引服务是否常开、索引是否完整（很多机器默认没开/很慢） | 高：COM 互操作，必须写原生模块（或 edge-js 之类） | 微软官方 [DSearch 示例](https://github.com/Microsoft/Windows-classic-samples/blob/main/Samples/Win7Samples/winui/WindowsSearch/DSearch/DSearch.cs) 可参考；跨机器行为差异大（服务关闭、索引范围、OneDrive 策略），桌宠这种轻量工具不值得绑定它 |
| 自扫描建索引 | 遍历目录树建自己的索引 | 首次全量慢（分钟级），之后增量 | 中 | 完全可控、无外部依赖，但工程量大、维护成本高，作为"Everything 不可用时的兜底"即可 |

**Electron 推荐**：MVP 直接随包分发 Everything 便携版 + `es.exe`，命令形如：

```bash
es.exe -json -sort DateModified -filter "*.pdf" -search "报告"
```

Everything 1.5 的 CLI 支持 `-json`、`-sort`、`-filter` 等（[Everything 命令行接口官方文档](https://www.voidtools.com/en-uk/support/everything/command_line_interface/)）。进阶用 [Everything SDK](https://www.voidtools.com/zh-cn/support/everything/sdk/)（Everything32/64.dll，通过命名管道/WM_COPYDATA 与主程序 IPC）写原生模块，去掉每次 spawn 的开销，并支持自动补全/高亮等。

> 注意：Everything 是**文件名搜索**（不做文件内容全文），对"找文件"场景完全够用；全文搜索（正文匹配）Windows Search 也不见得可靠，MVP 不建议做正文检索。

### 1.5 搜索 UI 与桌宠集成

- **即时结果**：输入 300ms 去抖（或 150ms + 取消上一查询），主进程 spawn 查询，`abort` 旧进程；结果按"文件名相似度 + 最近使用/修改时间"排序。
- **结果图标**：按扩展名/`kMDItemContentType` 映射到图标（macOS 用 `app.getFileIcon(path)` 拿系统图标——这是原生能力、免费且正确；Windows 同样支持 `app.getFileIcon`）。类型图标（图片/文档/PDF/文件夹）兜底。
- **在 Finder/Explorer 中显示**：macOS `open -R <path>`；Windows `explorer /select,<path>`（注意逗号无空格）。均为一次 spawn，无需权限（macOS 在受保护目录内 reveal 是允许的）。
- **拖拽文件到/出桌宠**：拖出用 Electron 官方能力——渲染层监听 `dragstart`，主进程 `webContents.startDrag({ file: path })`（[Electron 官方 Native File Drag & Drop 教程](https://github.com/electron/electron/blob/main/docs/tutorial/native-file-drag-drop.md)）；拖入（拖文件到桌宠身上）用主进程 `will-navigate`/`drop` 事件或 HTML5 dragover/drop 拿路径列表。
- **与 AI 结合（function calling）**：给模型注册 `search_files(query)` 工具；模型把自然语言拆成结构化参数（`name`、`kinds[]`、`dateRange`、`tags[]`、`dir`），主进程用 **查询构建器** 拼 `mdfind`/`es.exe` 命令（如"昨天改的 PDF"→ `kMDItemContentTypeTree == 'public.pdf' && kMDItemFSContentChangeDate >= $time.now(-1d)`）。注意：`-interpret` 自然语言能力有限，**不要**把原始用户句子直接丢给它，而是让模型结构化。
- **交互形态**：搜索面板从桌宠"拖出"（点击桌宠 → 弹出小搜索框窗口，置顶半透明）；结果点击→reveal，拖拽→丢到目标 app；也可以让 AI 对话流里直接返回文件卡片。

### 1.6 推荐实现

**MVP（约 1 周）**
1. 主进程 `FileSearchService`：macOS spawn `mdfind`，Windows spawn 随包的 `es.exe -json`，统一返回 `{path, name, kind, size, mtime}`；查询构建器 + 去抖 + 取消旧查询。
2. 渲染层搜索面板：输入框 + 结果列表 + 类型图标（`app.getFileIcon`）+ reveal + 拖拽。
3. function calling 接入 `search_files`。

**进阶**
1. macOS：原生模块（N-API + Swift）封装 `NSMetadataQuery`，`NSMetadataQueryDidUpdateNotification` 实时推送索引变化（"刚保存的文件立刻可搜到"），并支持按 `kMDItemContentTypeTree` 流式返回。
2. Windows：Everything IPC 原生模块（SDK DLL），去掉 spawn 开销，支持补全提示。
3. 文件预览（Quick Look：macOS `qlmanage -p`；Windows 缩略图 via `app.getFileIcon({size})`）；收藏/最近使用；全文搜索（macOS `kMDItemTextContent` 可做，Windows 需 Everything 1.5 content indexing 或放弃）。

**开源参考**
- [lululau/mfd（mdfind 封装）](https://github.com/lululau/mfd)
- [ainto-app（开源 macOS 启动器，Spotlight/Raycast 替代，Swift+Rust）](https://github.com/ainto-labs/ainto-app)
- [Flow Launcher（Windows 开源启动器，有 Everything 插件）](https://github.com/Flow-Launcher/Flow.Launcher)
- [Everything 官方 SDK](https://www.voidtools.com/zh-cn/support/everything/sdk/) 与 [CLI 文档](https://www.voidtools.com/en-uk/support/everything/command_line_interface/)
- [Microsoft DSearch 示例（Windows Search COM）](https://github.com/Microsoft/Windows-classic-samples/blob/main/Samples/Win7Samples/winui/WindowsSearch/DSearch/DSearch.cs)

---

## 2. 日程管理 / 提醒

### 2.1 macOS：EventKit 与 TCC（macOS 14+ 权限拆分）

- 读写日历 + 提醒事项的正统 API 是 **EventKit**（`EKEventStore`：`EKEvent` / `EKReminder`）。
- **TCC 权限（重点，macOS 14 Sonoma 起拆分）**：
  - 日历：`NSCalendarsFullAccessUsageDescription`（读写）或 `NSCalendarsWriteOnlyUsageDescription`（只写）；
  - 提醒：`NSRemindersFullAccessUsageDescription`（读写）或 `NSRemindersWriteOnlyUsageDescription`（只写）；
  - 旧的 `NSCalendarsUsageDescription` / `NSRemindersUsageDescription` 已废弃（仍兼容旧系统）。
  - 运行时 API：`requestFullAccessToEvents()` / `requestWriteOnlyAccessToEvents()` / `requestFullAccessToReminders()` / `requestWriteOnlyAccessToReminders()`，动态弹窗请求。
  - 依据：[Apple TN3152: Migrating to the latest Calendar access levels](https://developer.apple.com/documentation/technotes/tn3152-migrating-to-the-latest-calendar-access-levels)、[Protected resources 文档](https://developer.apple.com/documentation/bundleresources/protected-resources)。
- 用户拒绝授权后无法重弹，只能引导去"系统设置 → 隐私与安全性"开启（需要 `NSAppleEventsUsageDescription` 无关，但日历类需要 Info.plist key 齐全，否则直接 crash）。

### 2.2 Electron 接 EventKit 的三条路对比

| 方案 | 能力 | 优点 | 缺点 |
|---|---|---|---|
| **(a) 原生模块**（N-API + Swift/ObjC 桥） | 完整 EventKit：读写事件/提醒、订阅变更通知 | 能力最全、可靠；官方有教程 | 构建链路重（Xcode 工程、按架构编译、打包签名都要处理）；升级 macOS 要跟进 |
| **(b) `osascript` 调 AppleScript** | Calendar.app / Reminders.app 的 AppleScript 字典：**创建**事件/提醒可行；**读取/过滤**能力弱 | 零原生代码，几分钟接好"把提醒写进系统日历" | 每次调用弹"自动化"权限（TCC）；同步 IPC 慢；不同 macOS 版本字典有差异；无法高效批量查询/订阅变更；**不适合做主存储** |
| **(c) 自建本地存储**（SQLite/JSON） | 完全自主 | 无权限、可控、快；桌宠自己的"提醒"不依赖系统 | 与系统日历/iCloud 日历不打通，用户已有日程看不到 |

**AppleScript 对日历的支持到底如何**：Calendar 支持 `tell application "Calendar"` 创建 `new event`（摘要/开始/结束/日历归属）；Reminders 支持 `new reminder`（名称/到期日）。社区有较完整的 [Calendar AppleScript 参考](https://github.com/aiskillstore/marketplace/blob/14dc8f201a64f8d30fd131d7f036cd5e788be523/skills/7sageer/mac-automation/references/calendar-applescript.md) 和 [calendar.md（applescriptskill）](https://github.com/ckqbuilds/applescriptskill/blob/main/applescript/references/calendar.md)。但做"读取未来 7 天所有日历事件并过滤"这类需求，AppleScript 又慢又脆——**只适合"写入"这一单向动作**。

**推荐**：MVP = **(c) 本地存储为主 + (b) osascript 可选的"同步到系统日历"按钮**（写单向、失败静默降级）；进阶 = **(a) 原生模块**做 EventKit 双向（读系统日历进桌宠、桌宠提醒写回系统），订阅 `EKEventStoreChanged` 保持同步。

Electron 官方对"Swift 原生代码"有正式教程：[Native Code and Electron: Swift (macOS)](https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron-swift-macos)；社区还有 [kabiroberai/node-swift](https://github.com/kabiroberai/node-swift)、[NAPI-RS + swift-bridge 实践](https://strrl.dev/page/4/)。

### 2.3 Windows：系统日历无公开写入 API

- **现状**：Windows 11 的"人脉/日历"是 UWP 内置 app，**没有面向第三方的公开写入 API**（`Windows.ApplicationModel.Appointments` 只能加自己的数据源，无法写入系统日历视图）。
- 方案对比：
  - **自建 iCal/.ics + 本地 store（推荐）**：事件存 SQLite，导出 `.ics`（可导入 Outlook/Google/iCloud）；提醒用 Windows **toast 通知**（Electron `new Notification()` 在 Windows 上就是 toast，走系统通知中心，无需额外权限）。完全可控、零依赖。
  - **Outlook COM 集成**：仅当用户装有 Outlook；COM（MAPI）可建约会，但需要原生模块/`winax` 之类，且用户没装就白费——**不值得作为主力**，可做成可选"导出到 Outlook"。
  - **微软 Graph API**：功能最强（能写用户日历），但要微软账号 + 网络 + OAuth；桌宠是本地工具，**只适合作为进阶可选项**（多端同步），不当默认路径。
- 结论：Windows MVP = 本地 store + `.ics` 导出 + toast 提醒；进阶 = Graph/CalDAV 同步（可选）。

### 2.4 同步与存储

- **MVP：本地即可**。结构化数据用 SQLite（`better-sqlite3`，同步 API 在主进程用没问题），表：`events(id, title, start_at, end_at, all_day, repeat_rule, notes, source)`；轻量设置 JSON。
- **进阶：CalDAV 同步**（iCloud/Google/Nextcloud）。JS 生态有 [tsdav](https://tsdav.vercel.app/docs/caldav/import-ical-feed)（CalDAV 客户端）、[node-ical](https://www.npmjs.com/package/node-ical)（.ics 解析）、[ical.ts](https://github.com/nponsard/ical.ts)；iCloud 日历另有 [kalender-events](https://packages.ecosyste.ms/registries/npmjs.org/packages/kalender-events) 直接拉 iCloud 日历事件。同步做成后台任务：拉远端 → 合并到本地 → 冲突以远端/本地策略解决。注意 iCloud 的 WebCal/CalDAV 需要生成 app 专用密码，UX 上要讲清楚。
- 日历订阅（只读 .ics feed）也是低成本高价值项（节假日、天气等），可作为进阶小功能。

### 2.5 UI 与提醒触发

- **UI**：桌宠面板内嵌**迷你月历**（当月格子 + 事件点标记）+ **事件列表**（按时间排序，最近 7 天/今天）+ **添加事件表单**（标题、时间、重复、备注、是否同步系统日历）。面板可用"展开卡片"形态从桌宠弹出，不占常驻窗口。
- **提醒触发**：主进程调度器在 `fireAt` 触发时：① 发系统通知（macOS 走 Electron `Notification`，Windows toast）；② **桌宠"跳出来"**——把桌宠窗口置顶带到前台（`win.setAlwaysOnTop` + 播放提醒动画 + 气泡显示事件文案），用户点击通知/桌宠 → 打开事件详情或 snooze。
- 重复规则（每天/每周…）在调度器里展开成下一次 `fireAt`，每次触发后重排。
- 丢失补偿：App 退出期间错过的提醒，启动时按"仍在有效期内（如 15 分钟）"补发一次。

### 2.6 推荐实现

**MVP（约 1 周半）**
1. 本地事件存储（SQLite）+ CRUD + 重复规则展开。
2. 主进程调度器（复用 0 节基建）+ 系统通知 + 桌宠弹出动画 + 点击/稍后提醒。
3. 面板 UI：迷你日历 + 事件列表 + 添加表单。
4. macOS 可选：osascript"加入系统日历"（写单向，失败静默）；Windows 可选：导出 `.ics`。

**进阶**
1. macOS 原生模块接 EventKit 双向同步（读系统日历 + 订阅变更），权限按 2.1 的 key 申请。
2. CalDAV 同步（tsdav + node-ical），支持 iCloud/Google/Nextcloud。
3. 自然语言创建日程：function calling `create_event(title, start, duration, repeat)`，AI 对话里直接"周五下午三点提醒我交周报"→ 建事件。
4. Windows Outlook COM 可选集成。

**开源参考**
- [applescriptskill/calendar.md（AppleScript 日历参考）](https://github.com/ckqbuilds/applescriptskill/blob/main/applescript/references/calendar.md)
- [tsdav（CalDAV 客户端）](https://tsdav.vercel.app/docs/caldav/import-ical-feed) / [node-ical](https://www.npmjs.com/package/node-ical) / [ical.ts](https://github.com/nponsard/ical.ts)
- [kalender-events（iCloud 日历事件）](https://packages.ecosyste.ms/registries/npmjs.org/packages/kalender-events)
- [Apple TN3152（权限迁移）](https://developer.apple.com/documentation/technotes/tn3152-migrating-to-the-latest-calendar-access-levels)

---

## 3. 番茄钟 / 倒计时（关键实现要点）

模块简单，确认以下要点即可：

1. **主进程调度**：不用累加 `setTimeout`，用"目标结束时间戳 + 每 250ms 检查"或调度器 Job（`{fireAt}`），杜绝漂移；支持暂停（保存剩余秒数）。
2. **系统通知**：`new Notification({ title, body })` 跨平台（macOS 通知中心 / Windows toast）；可加按钮（开始下一轮）。
3. **音效**：打包一段短音频（如 mp3/ogg）用 `shell.beep()` 或 `play()`；注意 macOS 通知声音无需额外权限。
4. **桌宠动画反馈**：状态机输入 `pomodoro:start|tick|pause|done` → 桌宠进入"专注/休息/完成"动画（复用现有动画调度层）；剩余时间显示在**气泡/小面板**，托盘 tooltip 也可显示。
5. **状态持久化**：`{ phase, remainingMs, startedAt, targetEndAt }` 存 userData；**重启恢复**（重算剩余时间）、**休眠唤醒恢复**（用系统时钟 diff，别用 `Date.now` 之外的心跳计数）。
6. **与提醒模块共用调度层**：番茄钟就是一个"特殊 Job"，提醒是另一个 Job；统一注册/取消/持久化，避免两套定时逻辑。
7. **专注统计（值得做）**：本地存 `sessions(ts, duration, phase, tag)`，展示今日分钟数/连续天数/累计轮数。成本低、增强留存，MVP 可以只存不画复杂图表。
8. UI 形态建议：不占常驻窗口——点击桌宠或托盘弹出小面板（或桌宠头顶气泡显示 `25:00`）。

**开源参考**
- [amitmerchant1990/pomolectron（托盘番茄钟，Electron）](https://git-stars.org/blog/summaries/amitmerchant1990/pomolectron)
- [KeziahMoselle/tempus（托盘/菜单栏番茄钟）](https://github.com/KeziahMoselle/tempus)
- [Splode/pomotroid（桌面番茄钟）](https://git-stars.org/blog/summaries/Splode/pomotroid)

---

## 4. 桌宠娱乐交互

### 4.1 参考作品拆解

| 作品 | 核心交互 | 可借鉴点 |
|---|---|---|
| [VPet / VPet-Simulator（LorisYounger，WPF）](https://github.com/LorisYounger/VPet) | 摸头、喂食、洗澡、打工、好感度/心情、对话、可内置到任意 WPF app | **数值系统 + 状态机**：好感度/心情/饱腹/精力驱动动作选择；互动即喂数值 → 动画/行为变化；有完整的交互循环（点击→反馈→数值→行为） |
| [Shimeji-ee（Java；[DalekCraft2/Shimeji-Desktop 维护移植版](https://github.com/DalekCraft2/Shimeji-Desktop)）](https://github.com/DalekCraft2/Shimeji-Desktop) | 抓取窗口边缘、爬墙、悬挂、坠落、**多只同屏** | **行为引擎**：行为（behavior）是优先级队列/状态机（抓窗→爬→挂→摔），多角色并存；窗口信息来自系统 API |
| [oneko（X11；[winebarrel/Neco 为 macOS 的移植](https://github.com/winebarrel/Neco)）](https://github.com/winebarrel/Neco) | 猫追逐光标、睡觉 | 极简追逐算法：光标→宠物局部坐标换算→步进；切换"追逐/睡觉"两种状态即可 |

另外两个高度相关的 Electron 桌宠开源项目可直接参考架构：[2048Nemo/DeskPet（"住在刘海里的 deepseek 娘桌宠"，Electron + 刘海屏 + AI）](https://github.com/2048Nemo/DeskPet)、[kirineko/desktop-pet（Electron 像素桌宠）](https://github.com/kirineko/desktop-pet)。

### 4.2 Electron + Web 渲染层可行性确认

- **Live2D**：用 [pixi-live2d-display](https://github.com/zYxDevs/pixi-live2d-display)（PixiJS 插件，支持 Cubism 2/4/5 模型），在透明无边框 BrowserWindow 里渲染；点击/抚摸 = canvas 命中测试 + 鼠标事件，难度低。
- **透明置顶 + 点击穿透**：`transparent: true + frame: false + alwaysOnTop: true`；局部穿透用 `win.setIgnoreMouseEvents(true, { forward: true })`（需要鼠标时切回）。注意 [Electron #23042](https://github.com/electron/electron/issues/23042)：`setIgnoreMouseEvents` 与透明窗口在某些版本组合有 bug，需实测锁定版本；Wayland 侧 Electron 正在补输入区域支持（[PR #51144](https://github.com/electron/electron/pull/51144)）——**Windows/Linux 后续适配时留意**。
- **鼠标追逐（oneko）**：主进程 `screen.getCursorScreenPoint()` 轮询（或原生鼠标钩子）→ 换算成桌宠窗口局部坐标 → 渲染层移动宠物。macOS 上轮询 60Hz 够用；进阶用原生模块监听 `CGEvent`。
- **Shimeji 式抓窗口/爬墙**：主进程枚举窗口（macOS `CGWindowListCopyWindowInfo`；Windows `EnumWindows`，或直接拿 `screen.getAllDisplays` + 活动窗口信息）→ 让桌宠窗口吸附到目标窗口边缘/移到屏幕顶部。Electron 单窗口内做"多只同屏"复杂（命中区域冲突），更简单的是**一个宠物一个 BrowserWindow**（2–3 只封顶，注意透明窗口数量对性能/合成器的影响）。
- **小游戏**：直接复用桌宠渲染层（PixiJS/Live2D 同 canvas 或叠一个 canvas），面板内嵌（展开卡片）比全屏 overlay 简单；接金币/点击消除都是现成套路，重点是**与心情/好感数值联动**（玩得开心 → 心情上涨）。

### 4.3 心情/数值系统放 core 层：合理，且应如此

- 桌宠已有 core 层（纯 TS），**数值/心情系统做成纯 TS 状态机扩展完全合理**：
  - `Stats { mood, satiety, affection, energy }`（0–100，可含临时 buff）；
  - 纯函数 reducer：`applyStatChange(state, event)`、`tick(state, dt)`（心情随时间缓慢衰减、饱腹下降）；
  - 状态机：`MoodState = 开心|平静|低落|生气` 由数值映射（阈值区间），动作选择器 `selectIdleAnimation(state)`、`selectReaction(event)` 返回动画指令。
- **动画与数值联动数据流**（单向，好测试）：
  ```
  输入事件(点击/喂食/摸头/时间tick)
    → core reducer(更新数值/心情状态)
    → 输出"动画指令"(idle 频率、动作名、情绪表情、特效)
    → 渲染层动画调度器(选动画、调频率、播特效)
    → 反馈(UI 气泡/数值条) → 用户再输入
  ```
  例：心情低 → `selectIdleAnimation` 返回"频繁打哈欠/低头"，走路速度下降；喂食 → 饱腹+，心情+ → 播放进食动画 + 心情气泡。
- 持久化：数值与历史存 userData（JSON/SQLite），重启恢复；衰减 tick 注册进统一调度器（每分钟一次即可）。

### 4.4 推荐功能组合

**MVP（先做这 5 个，工作量小、反馈强）**
1. **抚摸/摸头强化**：点击宠物不同部位（头/肚子）→ 不同反馈动画 + 好感度微涨（已有"抚摸"基础，扩展命中区域与反馈）。
2. **喂食**：拖拽食物道具（面板里选/拖文件）→ 进食动画 + 饱腹/心情变化 + 气泡。
3. **点击连击反馈**：连点出计数 + 粒子特效 + 音效 + 好感连击加成（防抖/冷却，防刷）。
4. **基础心情系统**：心情值 + 情绪状态机，驱动待机动画频率/走路速度变化（4.3 的数据流跑通）。
5. **鼠标追逐（oneko 模式）**：可开关，光标靠近就跑/追，点它则暂停。

**进阶（第二期）**
1. 迷你游戏（接金币/点击消除），面板内嵌，奖励心情/好感。
2. Shimeji 式抓窗口/爬墙/悬挂（主进程窗口枚举 + 吸附）。
3. 多只同屏（每只一个窗口，可独立行为；或同窗口多精灵做简化版）。
4. 心情联动 AI：对话 function calling 传入心情状态，AI 回复语气/表情跟随（如低落时安慰语气）。
5. 养成统计（亲密度成长曲线、投喂记录）。

**设计要点**
- 输入 → 意图 → core 状态机 → 动画指令 → 渲染，**单向数据流**，core 无 DOM/无 Electron 依赖，可单测。
- 动画调度与数值解耦：渲染层只消费"指令流"，不直接读数值。
- 事件总线（`mitt`/`EventEmitter`）在主进程（数值 tick、提醒触发）与渲染层（动画）之间传递，跨进程走 IPC 白名单。
- 性能：透明窗口数量控制、动画节流（低帧率降级）、`setIgnoreMouseEvents` 命中区域只在交互时开启。
- 所有娱乐交互都可被"勿扰模式"一键关闭（用户可能上班摸鱼被看到）。

**开源参考**
- [LorisYounger/VPet（WPF 桌宠模拟器：数值/心情/喂食/对话）](https://github.com/LorisYounger/VPet)
- [DalekCraft2/Shimeji-Desktop（Shimeji-ee 行为引擎移植）](https://github.com/DalekCraft2/Shimeji-Desktop)
- [winebarrel/Neco（macOS 版 oneko）](https://github.com/winebarrel/Neco)
- [zYxDevs/pixi-live2d-display（PixiJS Live2D 插件）](https://github.com/zYxDevs/pixi-live2d-display)
- [2048Nemo/DeskPet（Electron AI 桌宠，架构可参考）](https://github.com/2048Nemo/DeskPet)
- [kirineko/desktop-pet（Electron 像素桌宠）](https://github.com/kirineko/desktop-pet)

---

## 5. 权限与跨平台注意点汇总

| 能力 | macOS | Windows |
|---|---|---|
| 文件搜索（文件名/元数据） | 非沙盒无需权限；读受保护目录内容需"文件与文件夹"TCC/FDA | 无权限（随包 Everything）；首次建索引数秒～分钟 |
| 日程/提醒 | EventKit：macOS 14+ 用 `NSCalendarsFullAccessUsageDescription`/`NSRemindersFullAccessUsageDescription`（或 WriteOnly 变体）动态申请；osascript 需"自动化"权限 | 无系统日历 API；本地 store + toast 无需权限 |
| 通知 | 无需权限（Electron Notification） | 无需权限（toast） |
| 全局鼠标/窗口信息 | `screen.getCursorScreenPoint` 免费；`CGWindowList` 无需权限（应用内可用） | `EnumWindows`/光标 API 免费 |
| 沙盒 | **不建议上 App Sandbox**（mdfind 受限、文件访问麻烦）；按非沙盒签名 | 无对应限制 |

跨平台实现要点：所有系统调用收敛到主进程 service（`FileSearchService`/`CalendarService`/`SchedulerService`），渲染层只面对统一接口；macOS 用 `spawn('mdfind')`、Windows 用 `spawn(esPath, ['-json', ...])` 的分支只在 service 内部出现；权限状态做成可查询的模块（用户可在设置页看到并跳转系统设置）。

---

## 6. 关键链接汇总

**文件搜索**
- mdfind 手册：<https://ss64.com/mac/mdfind.html>
- Apple Spotlight Query 指南：<https://developer.apple.com/library/archive/documentation/Carbon/Conceptual/SpotlightQuery/Concepts/Introduction.html>
- lululau/mfd：<https://github.com/lululau/mfd>
- ainto-app（开源 macOS 启动器）：<https://github.com/ainto-labs/ainto-app>
- Everything CLI：<https://www.voidtools.com/en-uk/support/everything/command_line_interface/>
- Everything SDK：<https://www.voidtools.com/zh-cn/support/everything/sdk/>
- Microsoft DSearch（Windows Search 示例）：<https://github.com/Microsoft/Windows-classic-samples/blob/main/Samples/Win7Samples/winui/WindowsSearch/DSearch/DSearch.cs>
- inket/FullDiskAccess（FDA 引导）：<https://github.com/inket/FullDiskAccess>
- Electron 原生文件拖拽：<https://github.com/electron/electron/blob/main/docs/tutorial/native-file-drag-drop.md>

**日程/提醒**
- Apple TN3152（日历权限迁移）：<https://developer.apple.com/documentation/technotes/tn3152-migrating-to-the-latest-calendar-access-levels>
- Apple Protected resources：<https://developer.apple.com/documentation/bundleresources/protected-resources>
- Electron Swift 原生代码教程：<https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron-swift-macos>
- node-swift：<https://github.com/kabiroberai/node-swift>
- Calendar AppleScript 参考：<https://github.com/ckqbuilds/applescriptskill/blob/main/applescript/references/calendar.md>
- tsdav：<https://tsdav.vercel.app/docs/caldav/import-ical-feed>；node-ical：<https://www.npmjs.com/package/node-ical>；ical.ts：<https://github.com/nponsard/ical.ts>

**番茄钟**
- pomolectron：<https://git-stars.org/blog/summaries/amitmerchant1990/pomolectron>
- tempus：<https://github.com/KeziahMoselle/tempus>
- pomotroid：<https://git-stars.org/blog/summaries/Splode/pomotroid>

**娱乐交互**
- VPet：<https://github.com/LorisYounger/VPet>
- Shimeji-Desktop：<https://github.com/DalekCraft2/Shimeji-Desktop>
- Neco（macOS oneko）：<https://github.com/winebarrel/Neco>
- pixi-live2d-display：<https://github.com/zYxDevs/pixi-live2d-display>
- DeskPet（Electron AI 桌宠）：<https://github.com/2048Nemo/DeskPet>
- kirineko/desktop-pet：<https://github.com/kirineko/desktop-pet>
- Electron 透明窗口点击穿透 issue：<https://github.com/electron/electron/issues/23042>
