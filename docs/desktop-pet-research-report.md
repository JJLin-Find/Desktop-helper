# 桌面宠物（Desktop Pet）动画渲染与交互实现方案调研报告

> 目标形态：macOS 优先、Windows 后期兼容的 AI 桌面助手桌宠；需要丰富动画（待机、行走、睡觉、点击反馈）与鼠标交互（拖拽、点击、抚摸、右键菜单、点击穿透模式）。
> 调研时间：基于 2024–2025 年公开资料整理。

---

## 一、动画方案对比

### 1.1 四种方案总览

| 维度 | (a) 序列帧动画（Sprite/GIF/APNG/WebP） | (b) LIVE2D（Cubism SDK） | (c) 骨骼动画（Spine / DragonBones / Rive） | (d) CSS/Canvas/SVG 程序化动画 |
|---|---|---|---|---|
| 渲染原理 | 逐帧贴图，程序按帧率切换 | 网格（Mesh）变形 + 纹理，参数驱动 | 骨骼绑定 + 关键帧插值 | 矢量/即时绘制，代码生成 |
| 表现力 | 手绘质感最好，动作自由度最高 | 面部/上半身/视差一流，全身位移弱 | 关节式动画，换装/换动作方便 | 几何/极简风格为主，复杂角色不现实 |
| 动画文件体积 | GIF 大、APNG 大、WebP 小、Sprite 适中 | 小（几 MB，含纹理） | 最小（矢量或小纹理） | 几乎为零（纯代码） |
| 运行时性能 | GIF/APNG 解码有 CPU 开销；Sprite+Canvas 极快 | WebGL 加速，60fps 轻松 | 运行时极快，业界成熟 | 依赖绘制量，矢量大量路径会慢 |
| 美术成本 | 高：每个状态×每个方向都要逐帧手绘 | 高：需 Live2D Editor 分图层/网格/物理 | 中：需学 Spine/Rive 编辑器做绑定 | 低：无需美术，但动画代码量大 |
| 制作工具成本 | 零（任何绘图软件） | Editor 订阅制（见授权） | Spine 编辑器付费、Rive 订阅、DragonBones 已停更 | 零 |
| 跨平台 | 全平台通吃 | 官方 Web/Native/Unity/UE/Java/Cocos；社区 Godot | Spine 全平台 runtime；Rive 官方多平台；DragonBones 社区维护 | 全平台（取决于宿主） |
| 交互支持 | 命中测试自己做 | 内置 HitArea 命中测试 + 参数控制（眼动、口型） | 有事件/状态机 API | 全自己写 |
| 结论 | **兜底方案 / 像素风首选** | **二次元角色首选** | **游戏化动作首选** | **MVP / UI 层首选** |

### 1.2 各方案细节

**(a) 序列帧动画**

- 格式选择要点：
  - **GIF**：仅 256 色、透明只有 1bit（无半透明边缘、有锯齿），文件大、解码慢——对桌宠这类要叠在桌面上、边缘需要 alpha 的诉求是硬伤，不推荐做主角渲染。
  - **APNG**：全彩 + 8bit alpha，Chromium 与 Safari 均支持（Safari 8+、Chrome 59+），质量好但体积大。
  - **WebP 动图（Animated WebP）**：压缩率比 GIF 高 60–80%，支持 alpha；Chrome 32+、Firefox 65+、Safari 14+ 支持，跨 WebView 兼容性基本够用（[对比参考](https://www.photoformatlab.com/blog/animated-webp-vs-gif-vs-apng-2026)）。
  - **Sprite Sheet（雪碧图）**：把多帧打包成一张 PNG，程序用 `drawImage` 按区域+帧率播放。这是**桌宠最推荐的序列帧形式**：可控帧率、方向帧、单纹理内存友好、无解码抖动。
  - 进阶：**透明视频（WebM VP9 alpha / WebM+MP4）**，体积最小、可复用动捕/视频素材，但有解码开销、要保证解码器支持 alpha 通道。
- 性能注意：GIF/APNG 的逐帧解码是性能杀手（尤其大尺寸）；sprite sheet 每帧只做一次 `drawImage`，配合 `requestAnimationFrame` 即可稳 60fps。
- 成熟项目参考：Shimeji 系（精灵图）、[duzexu/desktop-pet](https://github.com/duzexu/desktop-pet)（同时支持 GIF/WebP/WebM/MP4/MOV/PNG/SVG 与关键帧动画）。

**(b) LIVE2D（Cubism SDK）**

- 官方 SDK 平台：[Web（JavaScript）、Native（C/C++，含 iOS/Android/Windows/macOS）、Unity、Unreal Engine、Java、Cocos Creator](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/platform/)。Web SDK 基于 WebGL 渲染，可嵌入 Electron / Tauri 的 WebView，一次开发两端复用。
- 社区生态（关键优势）：
  - [guansss/pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)：PixiJS 渲染 Live2D 的事实标准库（MIT），内置模型加载、动作切换、HitTest 命中检测、表情控制。
  - [stevenjoezhang/live2d-widget](https://github.com/stevenjoezhang/live2d-widget)：网页看板娘组件，TypeScript，除 Cubism Core 外无依赖，配置化接入。
  - Godot 社区绑定：[virtual-puppet-project/godot-cubism](https://github.com/virtual-puppet-project/godot-cubism)（Godot 3.4）。
- 授权与成本（重要，2024 现状）：
  - SDK 本身**免费下载**（需同意 [Live2D Proprietary Software 许可 + Live2D Open Software 许可](https://help.live2d.com/zh-CHS/sdk/sdk_001/)）。
  - 发布作品时：**年销售额低于 1000 万日元的"普通用户/小型企业"无需签订 SDK 发行许可证合约**；试用/开发阶段也不需要。
  - ⚠️ **注意**：具有"虚拟化身等可扩展性功能"的作品（可扩展性 APP，例如允许用户自由导入模型）**无论规模大小，每个发布的作品都需单独签订合约**——若桌宠做"模型市场/任意模型导入"，请务必评估此条款（[官方说明](https://help.live2d.com/zh-CHS/sdk/sdk_001/)）。
  - 制作端：Cubism Editor 分 FREE / PRO for indie / 企业版；[PRO 版与 FREE 版功能对比](https://www.live2d.com/zh-CHS/cubism/comparison/)。
- 优劣总结：表现力最适合"萌系二次元角色"；**弱点是全身位移类动画（走路、跳跃、翻滚）**，需要配合位移/缩放/旋转做"纸片平移"效果，或与骨骼动画混用。

**(c) 骨骼动画（Spine / DragonBones / Rive）**

- **Spine**：游戏业界最成熟，运行时多语言开源；[编辑器收费](https://en.esotericsoftware.com/spine-purchase)（Essentials 约 $69 起，Pro/企业更贵）。角色换装、方向混合（turn blend）、事件回调、状态机都强。适合"游戏感"桌宠。
- **DragonBones（龙骨）**：Egret 出品，**官方已停止维护/更新**，编辑器停更，仅社区维护运行时；国内存量免费素材（尤其是二次元动作）非常多，拿来用可以，新项目不建议以它为主管线。
- **Rive**：编辑器订阅制（有 [新的 $9/月档位](https://framer.rive.app/blog/rive-s-new-9-mo-plan)，免费版功能受限），**运行时开源（MIT）**；自带 State Machine，适合 UI/图标/交互动画，角色动画能力在成长但不如 Spine/Live2D 成熟。适合做桌宠的"UI 面板、特效、装饰动画"。
- 对比参考：[Spine 与 Live2D 性能对比实战分析](https://my.oschina.net/emacs_8005114/blog/19521140)（200 角色同屏测试，结论是两者都能满足桌宠这种单角色 60fps 需求）。

**(d) CSS/Canvas/SVG 程序化动画**

- 代表项目 [geezmolycos/lizard-pet](https://github.com/geezmolycos/lizard-pet)：用 LÖVE（Love2D）**程序动态生成飞龙动画**，零美术资产、动作自然流畅。
- CSS 动画适合给透明窗口内的简单 UI/装饰做 GPU 合成动画；SVG 矢量桌宠无损缩放、文件极小，适合极简风格。
- 适用场景：快速 MVP 验证交互逻辑、UI 层动效、像素/几何风格桌宠；不适合"高质量二次元角色"诉求。

---

## 二、开源桌宠项目参考（GitHub）

| 项目 | 技术栈 | 亮点 / 可借鉴 | 许可 |
|---|---|---|---|
| [PPet（c332030/PPet，源自 zenghongtu/PPet）](https://github.com/c332030/PPet) | Electron + Live2D（v2/v3） | 跨平台（Mac/Win/Linux）；已实现：导入本地/在线模型、置顶、**忽略点击（穿透）**、拖拽、托盘、开机启动——与需求高度重合，是最直接的"架构抄作业"对象 | MIT |
| [duzexu/desktop-pet](https://github.com/duzexu/desktop-pet) | Electron | 透明无边框窗 + 置顶/缩放/穿透/位置锁定；**Petpack 素材包体系**（导入导出）；支持 GIF/WebP/WebM/MP4/MOV/PNG/SVG；**条件-动作-优先级-冷却的互动规则引擎**（点击/拖拽/悬停/定时） | MIT |
| [VPet（LorisYounger/VPet）](https://github.com/LorisYounger/VPet) | C# / WPF（可 NuGet 嵌入） | Steam 免费虚拟桌宠模拟器；约 32 状态×4 型×3 类动画；摸头/提起/爬墙等丰富交互；**创意工坊**内容生态 | 开源免费 |
| [lizard-pet（geezmolycos）](https://github.com/geezmolycos/lizard-pet) | LÖVE（Love2D） | 程序化生成动画，依赖极简；"自然流畅"的动态生成思路 | MIT |
| [Shimeji-ee（Kilkakon）及其派生](https://github.com/gil/shimeji-ee) | Java + 精灵图 | 经典桌宠姬；可借鉴：多只同屏、抓取窗口、拖拽弹跳、放置行为；[VShimeji](https://github.com/Valkryst/VShimeji)（性能优化分支）、[Shimeji-Desktop](https://github.com/DalekCraft2/Shimeji-Desktop)（JDK25 移植） | GPL/开源 |
| [live2d-widget（stevenjoezhang）](https://github.com/stevenjoezhang/live2d-widget) | TypeScript + Cubism Core | 网页看板娘组件，配置化、轻量；可直接在 Electron 里用 | GPL-3.0（注意：其上游库有 GPL 传染，商用请评估或用 MIT 的 pixi-live2d-display） |
| [winebarrel/Neco](https://github.com/winebarrel/Neco) | Swift / AppKit（macOS 原生） | oneko 风格：**透明点击穿透窗口 + 鼠标追逐 + 待机动画链**（sit→理毛→挠→打哈欠→蜷缩睡觉，鼠标一动惊起）；代码 **CC0**，猫精灵图为公有领域（源自 oneko/xneko，作者已确认可自由使用）——免费的经典"跟随鼠标"素材与状态机范本 | CC0（代码）/ 公有领域（精灵图） |
| [2048Nemo/DeskPet](https://github.com/2048Nemo/DeskPet) | 刘海（Dynamic Island 式）桌宠 | 挂在 macOS 刘海里，形态新颖 | 开源 |
| [DoroPet_V2（waterfeet）](https://github.com/waterfeet/DoroPet_V2) | LLM 聊天桌宠 | 桌宠 + AI 对话结合，可借鉴"AI 助手"交互设计 | 开源 |
| [OpenPet（X-T-E-R）](https://github.com/X-T-E-R/OpenPet) | 透明窗口桌宠运行时 | 面向 Codex 类 AI 伴生体的桌宠运行时 | 开源 |
| [mea-pet-public（suan-11）](https://github.com/suan-11/mea-pet-public) | MeaPet 桌宠 | 桌宠伴随应用 | 开源 |
| [desktop-pet-mitarashi（Sunwood-ai-labs）](https://github.com/Sunwood-ai-labs/desktop-pet-mitarashi) | 托盘猫 | 运行/待机/随机模式，托盘友好 | 开源 |
| [SpacervalLam/Deskpet](https://github.com/SpacervalLam/Deskpet) | Qt + Live2D | 原生 C++/Qt 渲染 Live2D，非 Web 路线的参考 | 开源 |
| [live2d-model-assets（PPet 模型源）](https://github.com/zenghongtu/live2d-model-assets) | 模型合集 | 聚合 xiazeyu/live2d-widget-models、fghrsh/live2d_api、AzurLaneL2DViewer、iCharlesZ/vscode-live2d-models 等仓库的**免费模型** | 各模型自带许可，需逐个确认 |

**免费/可商用素材渠道**：
- [live2d-model-assets](https://github.com/zenghongtu/live2d-model-assets)（PPet 模型源，一次导入即可用）。
- Live2D 官方示例数据集（Hiyori / Haru / Mao 等，官网免费下载，注意示例模型有专门的使用协议条款）。
- [BOOTH（Live2D 官方素材商店）](https://booth.pm/zh-cn/items/7877323) 上有大量免费模型（如"玖无ぬい"等），**每个模型都有独立许可，商用前必须逐个核对（免费 ≠ 可商用）**。
- oneko / xneko 的猫精灵图（公有领域，见 Neco 仓库的授权考证）。
- ⚠️ 注意：很多 B 站/贴吧"免费模型"未标注商用许可，商用产品请走有明确许可的渠道（官方示例、BOOTH 标注可商用的、自己制作）。

---

## 三、交互实现要点（各技术栈）

### 3.1 拖拽移动

- **Electron**：`mousedown` 记录偏移 → `mousemove` 中 `win.setPosition(screenX - dx, screenY - dy)`（rAF 合并节流）；或对整窗启用 CSS `-webkit-app-region: drag`（简单但无法自定义拖拽反馈，不推荐）。**拖拽期间应挂起行走/待机状态机**，松手后播放"落点"动画。
- **Tauri**：`appWindow.setPosition()` 同理；Tauri v2 提供窗口拖拽相关 API，透明窗口 + 自绘内容时仍推荐手动 setPosition。
- **macOS 原生（AppKit）**：`NSWindow.setFrameOrigin` / `setFrame(_:display:)`；用 `nonactivatingPanel` 避免拖拽时抢焦点。
- 通用注意：多显示器坐标（`screenX/screenY` 是逻辑坐标，注意 DPI 缩放比例）；拖拽结束位置持久化（读注册表/UserDefaults/配置文件）。

### 3.2 点击穿透（click-through）切换

- **Electron**：`win.setIgnoreMouseEvents(true, { forward: true })`——`forward: true` 会把鼠标移动事件继续转发给渲染进程，前端据此检测"鼠标回到宠物身上"再恢复交互（经典技巧：穿透模式下仍能 hover 检测，实现"鼠标移回即恢复可点击"）。⚠️ 已知坑：部分 macOS 版本下透明窗口 + 穿透有兼容问题（[Sonoma 下穿透失效的讨论](https://stackoverflow.com/questions/77131354/transparent-window-cant-click-through-in-macos-sonoma)、[Electron issue #48064](https://github.com/electron/electron/issues/48064)）。
- **Tauri**：`window.set_ignore_cursor_events(ignore, true)`（第二参数同样支持转发，见 [Tauri 点击穿透与鼠标事件转发](https://juejin.cn/post/7363101450824155163)）。
- **Windows 原生**：`WS_EX_LAYERED | WS_EX_TRANSPARENT` + `UpdateLayeredWindow`（带每像素 alpha 的 Per-Pixel HitTest）；Electron 下即 `setIgnoreMouseEvents`。
- **精确到像素的穿透**：Electron `win.setShape(rects)` 可把窗口裁剪成任意形状（**Windows/Linux 支持，macOS 不支持**）；macOS 上要么用 `ignoresMouseEvents` 全窗开关，要么前端做"透明像素命中测试"（点击时判断点击点是否在角色 alpha 内，是则触发交互，否则当穿透处理）。
- **右键菜单**：穿透模式开启时右键点击会被透传，需先恢复交互或由前端 JS 命中测试决定是否弹自定义菜单（桌宠菜单建议自绘，避免用系统窗口菜单）。

### 3.3 鼠标跟随 / 避让

- **全局鼠标位置**：
  - Electron：`screen.getCursorScreenPoint()` 轮询（rAF 或 30–60Hz interval），无需权限。
  - macOS 原生：`NSEvent.addGlobalMonitorForEvents(matching: .mouseMoved)`（鼠标类全局监听不需要辅助功能权限；键盘类才需要）。
  - Tauri：通过前端/插件轮询屏幕坐标。
- **oneko 式追逐**：以鼠标位置为引力点，桌宠按速度向目标插值移动（dt 帧率独立）；**状态机切换**：chase（追逐/行走动画 + 按水平速度翻转朝向 `scaleX`）→ 接近后 idle 链（坐下→理毛→打哈欠→睡觉），鼠标一动立即"惊起"。参考 [winebarrel/Neco](https://github.com/winebarrel/Neco) 的实现。
- **避让**：鼠标进入安全半径后，桌宠朝反方向移动（或"让开"到屏幕边缘），速度与距离成反比，平滑缓动（`lerp`/`easeOut`），避免抖动。
- **抚摸/点击反馈**：
  - Live2D：用模型内置 HitArea（`pixi-live2d-display` 的 `hitTest` 或 Cubism SDK 的 Raycasting）判定点击部位（头/身），触发对应动作 + 表情 + 语音。
  - 序列帧/骨骼：前端维护角色矩形/圆形命中区（可含 alpha 判定）。
  - 交互动作要有**优先级与冷却**（如"拖动中不响应抚摸"），参考 duzexu/desktop-pet 的条件-动作-优先级-冷却规则模型与 VPet 的摸头/提起。
- **状态机设计建议**：`idle / walk / chase / sleep / drag / interact / click-through` 等状态 + 优先级仲裁 + 定时器（自动从 idle 转 sleep），这是所有成熟桌宠的核心骨架。

---

## 四、透明窗口 + 60fps 的性能注意点（重点 macOS）

1. **透明窗口的合成成本**：macOS 上透明窗口无法利用窗口遮挡优化，WindowServer 每帧都要合成；窗口**尺寸应尽量贴近精灵包围盒**，减小合成面积。关掉 `hasShadow`、模糊、圆角等额外合成层。
2. **渲染层面**：
   - 用 `requestAnimationFrame` 驱动，**只在内容变化时绘制**（空闲眨眼/呼吸可降到 30fps 或按需，实测感知无差）。
   - 优先 WebGL（Live2D、Rive、PixiJS）而非 Canvas2D 大区域绘制；**避免整窗重绘**，渲染层只占精灵区域。
   - Retina：渲染分辨率与窗口物理像素匹配即可，**避免超采样**（高分屏上不必要的 2x 纹理很浪费）。
3. **Electron 专属坑**：
   - 透明窗口 + 硬件加速在某些版本/机型上有 GPU 占用异常或穿透失效问题（[Electron #48064](https://github.com/electron/electron/issues/48064)、[透明度导致 DWM/GPU 占用升高的修复 PR #39895](https://github.com/electron/electron/pull/39895)——说明这类问题在 Electron 生态真实存在且反复出现）。
   - 后台节流：`win.setBackgroundThrottling(false)` 防止窗口失焦后动画被冻结/降帧。
   - 移动窗口用 `setPosition` 而非频繁创建销毁；与 rAF 合并，避免事件风暴。
4. **原生 macOS（NSWindow）**：`isOpaque = false` + `backgroundColor = .clear`；`styleMask = [.borderless, .nonactivatingPanel]`（不抢焦点）；`level = .floating / .statusBar`；`collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`（全屏空间也显示）；避免在透明窗口上叠加 `NSVisualEffectView` 毛玻璃（会显著增加合成开销）。
5. **功耗与体验**：持续 60fps 合成在笔记本上耗电明显；提供**低功耗模式**（降帧、动画暂停、睡觉状态长驻）；行走/追逐才全速 60fps。
6. **GIF/视频解码**：避免用大 GIF（解码线程占用）；若用透明视频（WebM alpha），注意解码器支持与 CPU 开销，Sprite 仍是最稳的。

---

## 五、最终推荐

### 推荐方案：**Electron（或 Tauri）+ Web 渲染层，Live2D 为主、序列帧/骨骼为辅**

理由：

1. **开发效率与生态**：`pixi-live2d-display`（MIT）+ Cubism Web SDK 直接可在 Electron/Tauri 的 WebView 里跑，一次开发同时覆盖 macOS/Windows；拖拽、穿透（`setIgnoreMouseEvents(_, {forward})` / `set_ignore_cursor_events`）、置顶、托盘等 API 现成，与需求逐条对应。
2. **素材红利**：Live2D 免费模型生态最丰富（[live2d-model-assets](https://github.com/zenghongtu/live2d-model-assets) 等），能快速做出"有表现力"的二次元角色，避免从零画序列帧。
3. **授权可控**：年营收 < 1000 万日元无需 SDK 合约；注意两点——(1) 若做"任意模型导入/模型市场"要评估可扩展性 APP 单独合约；(2) 素材逐个确认可商用。
4. **性能足够**：单角色 WebGL 60fps 在 Mac 上毫无压力，只需做好"窗口最小化 + 按需绘制 + 低功耗模式"。

**取舍说明**：
- 选 **Electron**：透明窗口坑的资料最多、社区方案成熟（PPet/desktop-pet 已验证）；代价是内存占用大（~200MB+）。
- 选 **Tauri**：包体小、内存低（原生 WebView），但透明窗口/穿透的坑需要自己踩（资料少于 Electron），部分 macOS 版本 WebView 渲染行为需实测。
- 若最终目标只有 macOS 且追求极致原生体验：**Swift + AppKit + Live2D Native SDK**（或 Spine）走原生路线，性能最好、最省电，但开发与维护成本高，Windows 侧要另做一套。

### 建议的技术架构（MVP → 演进）

```
┌─ 应用壳：Electron（主进程）
│   ├─ 透明无边框窗口（置顶 / 点击穿透切换 / 多显示器坐标持久化）
│   ├─ 托盘 + 开机启动 + 全局快捷键
│   └─ AI 助手桥接（LLM 调用，事件驱动宠物动作）
└─ 渲染层（Web，渲染进程）
    ├─ 渲染引擎：PixiJS + pixi-live2d-display（Live2D 主角色）
    │            ├─ 备选：Spine runtime（若需要强骨骼动作）/ sprite-sheet 播放器（像素风）
    ├─ 状态机：idle / walk / chase / sleep / drag / interact / click-through（优先级 + 冷却）
    ├─ 交互层：命中测试（Live2D hitArea / 矩形 / alpha）、拖拽、鼠标跟随/避让
    └─ 素材体系：借鉴 desktop-pet 的 Petpack 与 VPet 创意工坊——「素材包 + 配置」解耦，
                用户可换皮肤/模型，AI 事件映射到动作
```

### 落地清单（按优先级）

1. 用 Electron + `live2d-widget`/`pixi-live2d-display` + 一个免费模型，**先跑通透明窗 + 待机/点击反馈**（1–2 天）。
2. 实现状态机（待机/行走/睡觉/拖拽）+ 拖拽与穿透切换（`setIgnoreMouseEvents` + forward）。
3. 加鼠标跟随/避让（oneko 模式）与抚摸判定（hitArea）。
4. 素材体系与 AI 事件映射（对话时口型/表情联动）。
5. 性能收尾：窗口包围盒裁剪、按需绘制、低功耗模式、Retina 分辨率校准。
6. 评估授权边界（营收阈值、可扩展性 APP 合约、素材商用许可）后再商业化。

---

## 六、参考链接汇总

- Live2D 平台支持：[官方文档](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/platform/) ｜ SDK 授权说明（1000 万日元门槛、可扩展性 APP 合约）：[help.live2d.com](https://help.live2d.com/zh-CHS/sdk/sdk_001/) ｜ Editor FREE/PRO 对比：[live2d.com](https://www.live2d.com/zh-CHS/cubism/comparison/)
- pixi-live2d-display：[github.com/guansss/pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) ｜ live2d-widget：[github.com/stevenjoezhang/live2d-widget](https://github.com/stevenjoezhang/live2d-widget)
- PPet：[github.com/c332030/PPet](https://github.com/c332030/PPet) ｜ 模型源：[live2d-model-assets](https://github.com/zenghongtu/live2d-model-assets)
- desktop-pet：[github.com/duzexu/desktop-pet](https://github.com/duzexu/desktop-pet) ｜ VPet：[github.com/LorisYounger/VPet](https://github.com/LorisYounger/VPet)
- lizard-pet：[github.com/geezmolycos/lizard-pet](https://github.com/geezmolycos/lizard-pet) ｜ Neco：[github.com/winebarrel/Neco](https://github.com/winebarrel/Neco) ｜ Shimeji：[VShimeji](https://github.com/Valkryst/VShimeji)、[Shimeji-Desktop](https://github.com/DalekCraft2/Shimeji-Desktop)、[gil/shimeji-ee](https://github.com/gil/shimeji-ee)
- godot-cubism：[github.com/virtual-puppet-project/godot-cubism](https://github.com/virtual-puppet-project/godot-cubism)
- 穿透/交互：Tauri 点击穿透与鼠标事件转发：[juejin.cn](https://juejin.cn/post/7363101450824155163) ｜ Tauri 透明窗口与鼠标穿透：[juejin.cn](https://juejin.cn/post/7277798325645197366) ｜ macOS Sonoma 穿透失效：[stackoverflow](https://stackoverflow.com/questions/77131354/transparent-window-cant-click-through-in-macos-sonoma)
- 性能：Electron 透明窗口 GPU 问题：[issue #48064](https://github.com/electron/electron/issues/48064) ｜ DWM/GPU 占用修复：[PR #39895](https://github.com/electron/electron/pull/39895) ｜ Spine vs Live2D 性能对比：[oschina](https://my.oschina.net/emacs_8005114/blog/19521140)
- Rive 定价：[framer.rive.app](https://framer.rive.app/blog/rive-s-new-9-mo-plan) ｜ Spine 购买：[esotericsoftware.com](https://en.esotericsoftware.com/spine-purchase) ｜ 动图格式对比：[photoformatlab](https://www.photoformatlab.com/blog/animated-webp-vs-gif-vs-apng-2026)
