# 桌面宠物 AI 助手 · 项目进度记录（2026-08 快照）

> 本文档是项目的**权威进度快照**：上下文被压缩/新会话接手时，以此为准。
> 目标：macOS 优先的桌宠形态 AI 桌面助手，后期兼容 Windows。
> **AI 接续开发请先读根目录 `AGENTS.md`**（工程操作手册：命令/结构/铁律/标准流程/许可红线），本文档为进度与坑的权威记录。

---

## 1. 技术栈与定位（已定案，勿轻易更改）

| 项 | 结论 |
|---|---|
| 框架 | **Electron ≥ v42**（当前 42.9.1），理由：开箱即用、窗口 API 最全、桌宠案例最多 |
| 语言 | TypeScript 全栈；monorepo（npm workspaces，依赖用 `"*"` 不是 `workspace:*`） |
| 渲染 | PixiJS v6.5 + `pixi-live2d-display@0.4.0`（cubism4 bundle）+ **官方 Cubism Core 5.1** |
| AI | OpenAI 兼容协议（baseURL+apiKey+model 三要素）；主推**智谱 GLM-4-Flash 完全免费** |
| 形象 | **皮丘 Pichu**（宝可梦皮卡丘家族 Q 版，BOOTH 作者 Raddleii 免费发布，可个人使用，不可商用） |
| 运行 | `./scripts/start.sh`（一键：自动装依赖/构建/启动；沙盒环境自动降级 --no-sandbox） |

**工程结构**：
```
packages/core/          # 纯 TS 零依赖：调度器/事件总线/状态机11态/数值系统/行为配置/AI client
packages/platform-api/  # 接口：ITray/INotifier/IClipboardWatcher 等 + PetActionCommand 类型
apps/desktop/
  src/main/
    index.ts            # 入口：IPC 全部白名单、服务组装、验证模式
    window/pet-window.ts    # 桌宠窗（透明/置顶/穿透/移动事件）
    window/bubble-window.ts # 回复气泡窗（透明圆角+尾巴，跟随桌宠）
    window/chat-window.ts   # 信息查询助手窗（加载 resources/chat-window.html）
    window/settings-window.ts # AI/搜索/桌宠名称设置（data URL HTML）
    services/ai.service.ts  # AI 双模式（pet 闲聊/assistant 查询）+ 实时检索注入
    services/web-tools.ts   # 天气(Open-Meteo)+搜索(博查)+fetch 超时
    services/pet-behavior.service.ts # 行为控制器（逗猫棒/抚摸/喂食/待机链）
  src/preload/index.ts   # contextBridge 白名单 window.pet.*
  src/renderer/          # Live2D 渲染 + 交互 + 右键菜单 + 气泡 overlay
  resources/chat-window.html  # 聊天窗独立 HTML（含轻量 Markdown 渲染器）
scripts/start.sh         # 一键启动
docs/                    # 全部调研报告 + 决策文档
```

---

## 2. 已完成功能（全部经验证）

### 桌宠本体
- 透明无边框置顶窗口（260×260）+ 点击穿透（移入恢复/移出穿透）+ 全屏空间可见
- **拖动移动**（仅按住拖拽才移动；`autoMove=false` 无自动移动）
- Live2D 皮丘渲染 + 官方 Cubism Core 5.1 + 命中掩码（alpha 网格，非方形点击判定）
- 待机/表情/物理效果；WebGL 失败自动回退 Canvas 橘猫（RENDER_MODE 常量）
- 行为：注视(watch)/抚摸(头身+连击衰减)/喂食(食物表+饱和)/待机链/心情数值（数值在跑，动画映射受模型单动作限制）

### AI 对话（双模式）
- **双击桌宠** → 桌宠闲聊（皮丘人设，俏皮短句）→ **圆润气泡窗口**流式呈现（透明+尾巴+高度自适应+**跟随桌宠移动**，8s 自动关）
- **右键 → 聊天框** → **信息查询助手**（专业人设，长文详尽）→ 独立聊天窗，**支持 Markdown 渲染**（标题/加粗/代码块/列表/表格），标题="{桌宠名称}自习室"
- 两模式人设/历史**完全隔离**
- 提供商预设：GLM(免费)/豆包/DeepSeek/硅基流动/Ollama/**自定义(局域网)**（无 Key 可用，不发送鉴权头）
- 设置窗口（托盘→"AI 对话设置"）：桌宠名称/AI 服务商+Key+模型+自定义 baseURL/联网搜索；**保存后自动关闭**

### 联网实时查询
- **天气**：Open-Meteo（免费无 key、国内直连、中文地理编码）——"北京天气"返回实时温度/天气/风速
- **网页搜索**：博查 BochaAPI（国内直连、免费额度；Bing API 2025-08 已停服勿用）
- 流程：意图检测 → 检索（天气/搜索）→ 注入 LLM 上下文（【实时信息】优先据此回答）→ 综合回答
- **超时保护**：天气 5/6s、搜索 8s、检索整体 8s 兜底、LLM 30s——任何网络问题最多等 8s 必有回复

### 剪贴板历史（✅ 已完成，subagent e7441eb7）
- 右键菜单「📋 剪贴板历史」→ 面板窗口（搜索/列表/📌pin/🗑删除/常驻监听开关）
- 监听：内容比对轮询 0.5s；**常驻默认关**（macOS 26 隐私），面板打开时同步一次；开关显式授权后才轮询
- 存储：JSON `userData/clipboard-history.json`（原子写）+ 图片 PNG `clipboard-images/<hash>.png`；SHA-256 去重；上限 500 条 pinned 不淘汰
- IPC：pet:clipboard:open/list/search/pin/remove/paste/sync/set-constant（8 个）
- 验证：PET_CLIP_TEST=1 全 PASS（去重/搜索/pin/paste/图片/面板E2E/常驻轮询）
- 限制：无 changeCount（轮询读内容，macOS26 常驻可能警告，默认交互式缓解）；图片仅 PNG 文本优先；常驻开关不持久化

### 文件搜索（✅ 已完成，subagent）
- 右键菜单「🔍 文件搜索」→ 独立面板窗口（resources/file-search-panel.html）
- 搜索：mdfind（`kMDItemFSName == '*xxx*'c` + 类型 `kMDItemContentTypeTree` + 时间 `$time.now(-Nm)` 组合），
  `-0` NUL 分隔解析路径 + fs.stat 补 size/mtime；**本机 macOS 26.3 的 mdfind 不支持 `-limit`**
  （探测一次：支持则交给 mdfind 截断，否则进程内截断，maxBuffer 8MB 兜底）；子进程超时 5s
- 面板：300ms 渲染层去抖 + 类型/时间过滤下拉 + 结果列表（名称/路径/大小/时间，点击 `shell.showItemInFolder` 在 Finder 显示）
- IPC：pet:file-search:open / search / reveal（3 个，preload 白名单 window.pet.fileSearch*）
- Windows：预留 es.exe（Everything）分支（本机不验证）
- 验证：PET_FS_TEST=1 全 PASS（真实 mdfind 搜索/类型+时间组合/limit 截断/面板 E2E/IPC 全链路）
- 限制：面板图标为扩展名 emoji 兜底（未接 app.getFileIcon）；无 -onlyin 限定目录入口（服务层已预留）

### 待办清单（✅ 已完成，subagent：数据层+服务+IPC+preload+验证）
- 右键菜单「✅ 待办清单」→ 独立面板窗口（resources/todo-panel.html，window/todo-panel.ts）
- 四象限（重要/紧急）：core `packages/core/src/todo.ts`（TodoItem/quadrantOf/QUADRANT_ORDER/sortTodos/todayKey/dateKeyOf，纯 TS 零依赖）
- 排序：done 置底；未完成按 重要紧急→重要不紧急→不重要紧急→不重要不紧急，同象限按 start 升序（无 start 按 createdAt）
- **跨天自动结转**：ensureToday() 把历史日期未完成且未结转任务复制到今天（新 id + rolloverFrom，原任务 carriedTo 幂等防重复）
- 服务 `services/todo.service.ts`：JsonStore 原子写 `userData/todo-data.json`（`{ days: Record<'YYYY-MM-DD', TodoItem[]> }`）；list/add/setDone/remove/update/history/analyze
- AI 简要分析：assistant 模式聚合文本；**不污染对话历史**（AIService 新增 popHistory 清理本次调用条目，另临时包装 onChunk 收集回复）
- IPC 8 个：pet:todo:open/list/add/set-done/remove/update/history/analyze；preload 白名单 window.pet.todo*（扁平命名）
- 验证：PET_TODO_TEST=1 全 PASS（四象限排序/完成置底/取消恢复/结转幂等/历史升序/AI 分析 mock/持久化读回）
- 坑：smoke 用例名中文被 strip 后 userData 目录可能与其他用例撞车（如 case 9 与 case 2 同为 /tmp/dsh-smoke/AI）→ 已修复：smoke.js 默认改用 `case${序号}` 目录彻底隔离（case 7 保留显式 persist 目录）

### 托盘图标（✅ 已完成：彩色 pichu 头像 + 呼吸动画）
- 原 trayTemplate.png 是 generate-icons.js 画的**黑色实心圆**（macOS Template=纯黑+alpha），菜单栏显示为黑点 → 弃用
- `scripts/generate-tray-icon.js`：解码 `resources/icon.png`（512 彩色 pichu）→ 居中裁剪内容区（原图 pichu 偏左下，contentBox 校正，side 会 clamp 到 min(w,h) 防越界）→ 双线性缩放 → **`resources/tray.png`(16×16 @1x 单表示)**
- **尺寸红线（踩坑三次）**：macOS 菜单栏高 22pt，图标用系统标准 **16pt**。两个坑：① 单张 44px PNG 会被系统当 44pt 渲染直接溢出；② **多分辨率 `addRepresentation`(@1x+@2x) 组合图在 Tray 上可能被系统按 @2x 表示渲染**（32px→32pt 溢出菜单栏，用户实测"明显溢出"）→ 最终方案：**只提供 @1x 16×16 单表示**（createFromPath），尺寸确定；Retina 代价是轻微模糊，优先保证尺寸正确
- **动态托盘**：渲染层 `__captureFrames(count, ms)` 图标模式连拍（Live2D 呼吸动画相位差）→ `PET_TRAY_ANIM=<dir>` 生成帧 PNG → `generate-tray-icon.js --frames-dir=<dir>` 统一第一帧 contentBox 缩放 → `resources/tray-anim/frame-0..3.png`（16×16，帧间有差异，呼吸可见）
- **单实例锁**：`app.requestSingleInstanceLock()`（残留旧实例会继续显示旧版本图标，造成"图标没改"的假象；二次启动聚焦现有桌宠）
- 运行时：`base.ts startTrayAnimation(framesDir)` setInterval 300ms 循环 `setImage`（IPlatform 可选方法）；index.ts 托盘创建后探测 tray-anim/ 存在即启动
- 彩色非 template：`darwin.ts`/`win32.ts` trayIconPath 指向 tray.png；`iconAsTemplate: false`；浅/深色菜单栏均可见
- 重新生成：改 icon.png 后跑 `node scripts/generate-tray-icon.js`；动画帧先 `PET_TRAY_ANIM=/tmp/f 跑 electron` 再 `--frames-dir=/tmp/f`

### 右键菜单（渲染层自绘，可扩展）
- 💬 聊天框 ｜ 📋 剪贴板历史 ｜ 🔍 文件搜索 ｜ 📅 日程管理 ｜ 🍅 番茄钟 ｜ ✅ 待办清单 ｜ 🙈 隐藏桌宠（CONTEXT_MENU_ITEMS 数组扩展）

---

## 3. 关键实现细节与坑（重要，勿重蹈覆辙）

1. **npm workspace 依赖**：用 `"*"` 而非 `workspace:*`（npm 不支持）
2. **npm 缓存 EPERM**：`~/.npm` 有 root 文件 → 用 `--cache /tmp/npm-cache-desktop-helper`；Electron 二进制用镜像 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` + `electron_config_cache`
3. **CSP 禁 eval**：PixiJS v6 需要 eval → `@pixi/unsafe-eval` 的 `install(PIXI)`
4. **file:// 下资源路径**：renderer 必须 `base: './'` + 相对路径（绝对 `/live2d/...` 会 404）
5. **pixi extract.pixels 坑**：不带 region 返回模型原始坐标巨大缓冲（120M），带 region 有 `_rawPixels` bug → **手动离屏渲染到受控 RenderTexture** 再提取
6. **模型锚定**：用**固定高度**（加载时取一次），勿用动画中实时 getBounds（会跳动）；窗口扩展保持**底部不动**（向上生长）
7. **气泡用独立窗口**（勿改桌宠窗口尺寸——曾引发抖动/模型被挤出）
8. **流式广播**：AI 流式回调需 `BrowserWindow.getAllWindows()` 广播 `pet:ai:chunk`（聊天窗订阅）；气泡窗由主进程直写（appendBubbleText）
9. **聊天窗 HTML 用独立文件**（resources/chat-window.html）：内嵌字符串里正则 `\[`/`\s`/反引号会被模板转义破坏（曾引发 SyntaxError）
10. **Key 已改明文存储**：safeStorage 在未签名开发模式重启后解密不可靠（Keychain 密钥不稳定）→ AI Key/搜索 Key 改为明文存 JSON（可靠性优先；正式签名打包后再加密）。兼容旧 enc:/b64: 数据尝试解密读取
11. **fetch 必须带超时**（AbortController/AbortSignal.timeout），否则网络挂起卡死对话
12. **bash 3.2 兼容**：start.sh 变量后用 `${VAR}` 花括号（全角字符会误并入变量名）；不用空数组 `"${arr[@]}"`
13. **验证模式**（index.ts 内）：`PET_SCREENSHOT=<path>` 截图退出；`PET_DEMO=1` 模拟喂食/抚摸；`PET_AI_MOCK=1` 内置 mock OpenAI 服务器全链路自测；`PET_SEARCH_MOCK=1` mock 博查；`PET_BUBBLE_SHOT=<path>` 截气泡窗；`PET_STORE_PROBE=1` 存储探测；`PET_MD_TEST=1` Markdown 渲染测试；`PET_FS_TEST=1` 文件搜索自测（真实 mdfind，独立于截图）；`PET_TODO_TEST=1` 待办清单自测（四象限/结转/历史/AI 分析 mock/持久化，独立于截图）；`PET_TRAY_ANIM=<dir>` 托盘动画帧连拍（图标模式 4 帧）；`PET_DEBUG=1` 渲染层调试面板
14. **沙盒环境**：Electron 需 `--no-sandbox --user-data-dir`（start.sh 自动降级）；正常终端不需要
15b. **WebGL toDataURL 需 preserveDrawingBuffer:true**（否则空白）；capturePage 对透明 WebGL 窗口在 resize 后可能返回不透明背景 → 图标用 canvas.toDataURL 而非 capturePage；Pixi renderer.resize 在图标模式会致背景蓝（勿在图标模式调 resize，正常窗口 resize 用 applyWindowSize 内已同步）
15. **根 package.json 曾被子包内容覆盖**（打包 subagent 误写导致 monorepo workspaces/scripts 丢失，typecheck 全失效）——已恢复。⚠️ 任何 npm 相关操作后跑一次 `npm run typecheck` 自查；打包配置只应改 `apps/desktop/package.json` + `electron-builder.yml`，严禁覆盖根 package.json

---

## 4. 许可红线

- 皮丘 Pichu 模型（BOOTH raddleii）：免费个人使用，不可商用/倒卖/改贴图/用于周边，使用需署名
- 旧 aidang_2（游戏拆包素材）：已移除，仅限个人
- Live2D：年营收 <1000 万日元免 SDK 合约；Hiyori 官方模型可商用需标注（已备用于替换）
- 搜索：博查需 key；Bing 已停服

---

## 4·5、统一冒烟测试（✅）
- `npm run smoke`（或 `node scripts/smoke.js`）：构建后依次跑 **9 项验证**，自动断言 + 汇总退出码（0 全过 / 1 有失败）：
  ① 启动渲染（透明窗+模型锚定）② AI 全链路（桌宠/查询/天气/搜索/局域网 mock）③ 剪贴板历史 ④ 文件搜索（真实 mdfind）⑤ 日程 ⑥ 番茄钟 ⑦ 存储持久化 ⑧ Markdown 渲染 ⑨ 待办清单（四象限/排序/结转/历史/AI分析）
- 其他开发者推代码前跑一次即可防回归；当前 9/9 通过
- 每项独立 `--user-data-dir=/tmp/dsh-smoke/*` 隔离；单模式超时 180s

## 5. 待办 / 下一步（按价值）

### 代码已完成、需真实环境/账号
- [ ] **Windows 实机验证（9 项）**：toast（AUMID+快捷方式）、托盘图标清晰度（可补 .ico）、左键/右键托盘、自启 Run 键、透明窗+穿透+DPI、es.exe 文件搜索（需随包分发 Everything 便携版）、剪贴板图片格式、虚拟桌面、NSIS 实际构建产物
- [ ] **macOS 正式签名+公证**：需 Apple Developer 账号（$99/年）→ Developer ID 证书 + APPLE_* 三件套；流程见 `docs/RELEASE.md`
- [ ] **electron-updater 自动更新**：已配 publish(provider:github)，需装 electron-updater 并接 autoUpdater 逻辑

### 可选优化（非阻塞）
- [ ] 文件搜索面板图标接 `app.getFileIcon`（当前 emoji 兜底）
- [ ] 剪贴板：native addon 暴露 changeCount（消除轮询读内容，macOS 26 隐私更优）、富文本/文件类型
- [ ] 日程：.ics 导出 / 系统日历同步（EventKit）、"稍后提醒"
- [ ] 自定义右键菜单更多项（AI 设置、投喂等）
- [ ] 桌宠心情→更多行为联动（如开心时走路速度提升——当前已接待机链/入睡阈值）


## 6. 运行/验证速查

```bash
./scripts/start.sh                        # 一键启动
./scripts/start.sh --dev                  # 开发模式 HMR
PET_DEBUG=1 ./scripts/start.sh            # 显示调试面板
# 验证模式（构建后直接跑 electron）：
cd apps/desktop
PET_AI_MOCK=1 PET_SEARCH_MOCK=1 PET_BOCHA_BASE=http://127.0.0.1:18098 \
  PET_SCREENSHOT=/tmp/x.png PET_BUBBLE_SHOT=/tmp/bubble.png \
  ../../node_modules/.bin/electron . --no-sandbox --user-data-dir=/tmp/electron-userdata
```

**配置入口**：托盘图标 → "AI 对话设置"（桌宠名称/AI/联网搜索）+ "显示/隐藏桌宠" + "退出"（关窗≠退出）
