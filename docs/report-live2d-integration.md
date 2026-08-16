# Live2D 桌宠集成指南（Electron ≥42 · Vite/TS · pixi-live2d-display）

> 调研时间：2026-08。适用环境：macOS 26，Electron ≥v42，透明无边框置顶窗口，renderer 由 electron-vite（Vite + TypeScript）构建，`nodeIntegration: false`、`contextIsolation: true`。
> 所有版本号、npm peerDependencies、CDN 链接均已在线实测验证（HTTP 状态、registry 元数据、源码 API）。

---

## 0. TL;DR（先看结论）

| 决策点 | 推荐 | 理由 |
|---|---|---|
| PixiJS 版本 | **pixi.js v8（8.x）** | 2026 年主分支；原版已停更 |
| Live2D 插件 | **首选 `untitled-pixi-live2d-engine@^1.3.5`**（Pixi v8 + Cubism 2–5 全覆盖，API 与 pixi-live2d-display 兼容）；坚持原包名则选 `@naari3/pixi-live2d-display@^1.2.5`（v8，仅 Cubism 3/4/5）；要最保守的官方名实现选 0.4.0 + pixi 6.x | 三项候选实测结论见 §1.1"选型结论" |
| Cubism Core | **Cubism 5 core（`live2dcubismcore.min.js`）**，随包分发（放 `public/` 或 `extraResources`） | 向后兼容 Cubism 3/4/4.2 的 `.moc3`；不建议依赖公共 CDN |
| 模型规格 | **Cubism 4/5（`.model3.json`）为主**；若走 untitled engine 可顺带兼容 Cubism 2（`.model.json`） | 官方示例与 zenghongtu `moc3/` 都是 Cubism 4；untitled engine 的 `cubism` 入口只加载 `live2dcubismcore`，`index` 入口才需额外 `live2d.min.js` |
| 模型打包 | 开发走 Vite `public/` + dev server；**生产用自定义 `app://` 协议**（`protocol.handle`） | 插件用 XHR 加载，`file://` 下 XHR 被 Chromium 拦截 |
| 默认模型 | **Hiyori**（官方示例，约 4.7MB，含完整动作/表情/HitArea，可商用需标注） | 体积适中、已验证可加载 |
| 透明窗口 | `transparent + frame:false + backgroundThrottling:false`，Pixi `backgroundAlpha: 0` + `premultipliedAlpha: false` | 见 §6 |

> ⚠️ 关键坑（先记住）：**pixi-live2d-display 原版（guansss）已停更**；Pixi v8 的可用实现是第三方 fork。**v8 fork 不支持 Cubism 2 模型**（`live2d.min.js` / `.model.json`），需要 Cubism 2 就必须退回 Pixi v6/v7。**加载器用 XHR 而非 fetch**，所以 `file://` 直接加载模型会失败。

---

## 1. 依赖与版本

### 1.1 pixi-live2d-display 全家族版本对照表（npm 实测）

| 包名 | 版本 | peer `pixi.js` | Cubism 支持 | 说明 |
|---|---|---|---|---|
| `pixi-live2d-display`（guansss，原版/官方） | 0.4.0（latest） | `@pixi/* ^6`（v6） | 2 + 4 | **已停更**；单文件 UMD；DSH 插件 `dsh-live2d-pets` 实测可用 |
| `pixi-live2d-display`（guansss） | 0.5.0-beta | `pixi.js ^7` | 2 + 4 | v7 beta，未正式发布 |
| `pixi-live2d-display`（guansss，更老） | 0.1.x–0.3.x | `@pixi/* ^5`（v5） | 2/3/4 | 太老，不推荐 |
| **`@naari3/pixi-live2d-display`** | **1.2.5（latest）** | **`pixi.js ^8`** | **3/4/5（不支持 2）** | **推荐**；默认入口即 Cubism 5，内置官方 Cubism Web Framework；维护活跃（有 CHANGELOG、playground、文档站） |
| `@jannchie/pixi-live2d-display` | 1.4.0 | `pixi.js ^8` | 4（Jannchie 是原仓库作者） | v8 备选 fork |
| `pixi-live2d-display-advanced` | 1.1.0 / 2.0.0-beta.2 | `pixi.js ^7` / `pixi.js ^8.13.1` | 4 | 带唇形同步、多动作、末帧保持；1.x 是 ESM + 动态 `import()` chunk，**不能 `<script>` 直引**（需打包器） |
| `pixi-live2d-display-webgal` | 0.5.15 | `@pixi/* ^6` | 2 + 4 | WebGAL 用 fork，v6 |
| `pixi-live2d-display-lipsyncpatch` | 0.5.0-ls-8 | `pixi.js ^7` | 2 + 4（+唇形同步补丁） | 基于 guansss 0.5.0-beta 的小型 fork（RaSan147），仅在"必须 v7 + Cubism 2 + 唇形同步"时考虑 |
| **`untitled-pixi-live2d-engine`** | **1.3.5（latest，2026-07 仍活跃）** | **`pixi.js ^8.13.1`**（依赖 `@pixi/sound ^6`，可选） | **2 + 3/4/5**（`cubism-legacy`/`cubism`/`index` 三入口） | **Pixi v8 全家桶首选候选**：原生 v8 Render Pipe（Filter/RenderTexture/zIndex/blend）、并行动作/末帧保持/唇形同步/纹理 LOD、`Live2DModel.from()` API 与 pixi-live2d-display 兼容（约 66★ 社区项目，[GitHub](https://github.com/Untitled-Story/untitled-pixi-live2d-engine)） |
| `untitled-pixi-live2d-engine` | 1.0.0-rc.1 | pixi v8 | — | 早期预发布版，不用 |

**选型结论（对应交付项①）**——三个候选实测对比如下：

| 候选 | Pixi | Cubism | 维护状态 | 结论 |
|---|---|---|---|---|
| `pixi-live2d-display` 0.4.0 + `pixi.js` 6.x | v6（2021 API） | 2 + 4 | 停更 | 最保守、有 DSH 桌宠实测背书（dsh-live2d-pets）；但 Pixi v6 太老，新功能/新资料少 |
| `pixi-live2d-display-lipsyncpatch` 0.5.0-ls-8 | v7 | 2 + 4 + 唇形同步 | 小型社区 fork | 仅当你锁定 v7 且需要唇形同步时用；社区最小 |
| **`untitled-pixi-live2d-engine` 1.3.5** | **v8** | **2 + 3/4/5 全覆盖** | 活跃（2026-07 仍有提交） | **综合更优**：Pixi v8 主版本 + 原生 v8 渲染管线 + 覆盖老模型（zenghongtu `moc/`、`Girls' Frontline/`）与新模型（官方示例、`moc3/`），API 基本兼容；代价是换包名 |
| `@naari3/pixi-live2d-display` 1.2.5 | v8 | 3/4/5（无 2） | 活跃 | 若坚持 `pixi-live2d-display` 名称 + v8 且只做 Cubism 4/5，选它 |

> 一句话：**要新旧模型通吃 → untitled-pixi-live2d-engine；只做 Cubism 4/5 且想要最广社区资料 → @naari3 fork；想最保守照抄已验证方案 → 0.4.0 + pixi 6.x。**

**结论**：
- 你的技术栈（Vite + TS + electron-vite）自带打包器，ESM 没问题。
- **推荐首选 `untitled-pixi-live2d-engine@^1.3.5` + `pixi.js@^8`**：v8 主版本 + Cubism 2–5 全覆盖（老模型 `moc/`、`Girls' Frontline/` 也能加载），原生 v8 渲染管线，2026 年仍在维护；API（`Live2DModel.from()` / `motion()` / `expression()` / `hit`）与 pixi-live2d-display 基本一致，迁移成本低。
- 若坚持 `pixi-live2d-display` 名称且只做 Cubism 4/5 → **`@naari3/pixi-live2d-display@^1.2.5` + `pixi.js@^8`**（v8，无 Cubism 2）。
- 若必须兼容 Cubism 2 老模型且不想换包 → 退回 **`pixi-live2d-display@0.4.0`（Pixi v6）** 或 **0.5.0-beta（Pixi v7）**（或带唇形同步的 `pixi-live2d-display-lipsyncpatch`），并额外加载 `live2d.min.js`。
- 参考实现：DSH 生态内的 [cyanfish-x/dsh-live2d-pets](https://github.com/cyanfish-x/dsh-live2d-pets)（同为 Live2D 桌宠，实测链为 pixi-live2d-display 0.4.0 + PixiJS 6.5.10 + Cubism Core 4，见其 [ADR-003](https://github.com/cyanfish-x/dsh-live2d-pets/blob/master/docs/adr/003-spike-results-and-rendering-stack.md)）。

### 1.2 Cubism Core（运行时）如何获取

Cubism Core 是 Live2D 的"运行时"（解析 `.moc3`/`.moc`、驱动参数），**不属于插件**，必须先于插件加载。三个时代的 Core 区别：

| | Cubism 2.1 | Cubism 4 | Cubism 5 |
|---|---|---|---|
| 文件名 | `live2d.min.js` | `live2dcubismcore.min.js` | `live2dcubismcore.min.js` |
| 全局对象 | `window.Live2D` | `window.Live2DCubismCore` | `window.Live2DCubismCore`（新增 Cubism 5 API） |
| 模型格式 | `.moc` + `model.json` | `.moc3` + `.model3.json`（兼容 Cubism 3） | `.moc3`（**向后兼容 Cubism 3/4/4.2 模型**，官方迁移文档确认） |
| 官方现状 | 2019-09-04 起官方停止分发 | Cubism 4 SDK 内 `Core/` | Cubism 5 SDK 内 `Core/` |
| 谁需要 | 只加载 Cubism 2 模型时 | 加载 Cubism 3/4 模型时 | 加载 Cubism 4/5（推荐，v8 fork 默认） |

**官方下载流程（正路）**：
1. 打开 [Cubism SDK for Web 下载页](https://www.live2d.com/download/cubism-sdk/download-web/)（总入口 [live2d.com/download/cubism-sdk](https://www.live2d.com/download/cubism-sdk/)）；
2. 勾选同意 SDK License Agreement（SDK 本身**免费、可商用**，需在应用中保留版权声明）；
3. 下载 zip（需注册/登录账号），解压后取 `Core/live2dcubismcore.min.js`（及可选 `live2dcubismcore.js` 非压缩版、`live2dcubismcore.d.ts`）；
4. 把 `live2dcubismcore.min.js` 放进你的应用资源（`public/` 或 electron-builder 的 `extraResources`）随包分发。

> 注意：**Cubism Core 不在 GitHub 开源**（遵循 [Live2D Proprietary Software License Agreement](https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/)），官方只随 SDK 包分发。

**非官方镜像（应急/调研可用，生产不推荐）**：
- 官方直链（不稳定，README 明示勿用于生产）：`https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js`（我实测当前 200，`Access-Control-Allow-Origin: *`）
- npm 包 `live2dcubismcore@1.0.2`（2022 年的非官方包，内含 `live2dcubismcore.min.js`（约 150KB，Cubism 4 时代）、`live2d.min.js`（129KB，Cubism 2）、`pixi.min.js`（老 pixi v4）及一堆模型素材；**许可不明，仅调研**）：
  - `https://cdn.jsdelivr.net/npm/live2dcubismcore@1.0.2/live2dcubismcore.min.js`（实测 200）
- Cubism 2 core 镜像（官方已停止分发）：`https://cdn.jsdelivr.net/gh/dylanNew/live2d@master/webgl/Live2D/lib/live2d.min.js`（实测 200；源仓库 [dylanNew/live2d](https://github.com/dylanNew/live2d)）

### 1.3 Electron renderer 兼容性

- **纯浏览器环境**：pixi-live2d-display（含 v8 fork）只依赖 DOM、XHR、WebGL、ES6 —— 与 `nodeIntegration: false` / `contextIsolation: true` 完全兼容，**无需任何 Node API**。electron-vite 下正常 `import` 即可。
- **Ticker 关联**：插件默认找 `window.PIXI.Ticker` 自动更新模型。ESM 导入时没有全局 `PIXI`，两种做法（任选其一）：
  1. `window.PIXI = PIXI`（文档默认写法）；
  2. 显式传 `{ ticker: Ticker.shared }`（v8 fork 的 playground 实测写法，更干净，推荐）。
- **加载机制**：模型 JSON/动作/表情用 **XMLHttpRequest**（`factory/XHRLoader`），纹理在 v8 用 `PIXI.Assets.load`。XHR 对 `file://` 是拦截的 → 生产环境必须走 http(s)/data:/自定义标准协议（见 §3.3）。
- **CSP**：如果 renderer 配了严格 CSP，Core 若用 `<script>` 标签引入需放行；推荐把 `live2dcubismcore.min.js` 当普通静态资源/`import` 处理（它设置全局，放 `public/` 即可）。

---

## 2. 分步集成指南（Pixi v8 + naari3 fork，推荐路径）

### 2.1 安装依赖

```sh
npm i pixi.js@^8 @naari3/pixi-live2d-display@^1.2.5
```

### 2.2 放置 Cubism Core

把官方下载的 `live2dcubismcore.min.js` 放到 `src/renderer/public/scripts/live2dcubismcore.min.js`（electron-vite 的 renderer `public` 目录；开发时由 dev server 以 `/scripts/live2dcubismcore.min.js` 提供，构建时拷贝进 `out/renderer/scripts/`），并在 `src/renderer/index.html` 里最先引入：

```html
<script src="/scripts/live2dcubismcore.min.js"></script>
```

（若想全走 bundler：`import '/scripts/live2dcubismcore.min.js'` 或直接 `import './scripts/live2dcubismcore.min.js'` 也行，只要保证在插件代码**执行前** `window.Live2DCubismCore` 已就绪。）

### 2.3 最小渲染代码

```ts
import { Application, Ticker } from 'pixi.js';
import { Live2DModel } from '@naari3/pixi-live2d-display';

const app = new Application();
await app.init({
  resizeTo: window,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  backgroundAlpha: 0,                 // 透明背景（v7/v8 用 backgroundAlpha，不是 transparent）
  premultipliedAlpha: false,          // Live2D 渲染推荐（fork playground 实测）
  powerPreference: 'high-performance',
});

document.body.appendChild(app.canvas);

const model = await Live2DModel.from('/models/Hiyori/Hiyori.model3.json', {
  ticker: Ticker.shared,              // 显式绑定 ticker，不依赖 window.PIXI
});
model.setRenderer(app.renderer);      // v8 fork：把 renderer 交给 Live2D 内部渲染器

// 变换（Pixi 风格）
model.anchor.set(0.5, 0.5);
model.x = window.innerWidth / 2;
model.y = window.innerHeight;
model.scale.set(1.5);

app.stage.addChild(model);
```

> Pixi v8 注意：`new Application()` 后必须 `await app.init({...})`；画布选项是 `canvas`（不是 v7 的 `view`）。

### 2.4 加载模型：Cubism 4/5 vs Cubism 2

**Cubism 4/5（推荐，`.model3.json`）**：

```ts
const model = await Live2DModel.from('https://example.com/models/xxx.model3.json');
// 或传 settings JSON 对象 / ModelSettings 实例
```

模型目录结构（Cubism 4/5 标准，实测 zenghongtu `moc3/xuefeng/` 与官方 CubismWebSamples 均如此）：

```
Hiyori/
├── Hiyori.model3.json        # 入口：指向 moc3 / textures / motions / expressions / physics
├── Hiyori.moc3               # 模型本体（二进制）
├── Hiyori.physics3.json      # 物理（可选）
├── Hiyori.cdi3.json          # 显示信息（可选）
├── Hiyori.pose3.json         # 姿势组（可选）
├── Hiyori.userdata3.json     # 自定义数据（可选）
├── textures/texture_00.png
├── motions/*.motion3.json    # 动作（model3.json 里按 group 分组：Idle/TapBody/...）
└── expressions/*.exp3.json   # 表情（可选）
```

`model3.json` 关键字段：`Version`（3.0/4.0/5.0，对应 Cubism 3/4/5 模型规格）、`FileReferences`（`Moc`/`Textures`/`Physics`/`Motions`/`Expressions` 的相对路径）、`HitAreas`（点击区域，如 `{ "Id": "Body", "Name": "Body" }`）。

**Cubism 2（`.model.json`，仅当退回 v6/v7 路径时）**：

```ts
import { Live2DModel } from 'pixi-live2d-display'; // guansss 0.4.0/0.5.0-beta 的默认入口
const model = await Live2DModel.from('xxx.model.json');
```

目录结构：`model.json` + `model.moc` + `textures/texture_00.png`（+ 可选 `motions/*.motion.json`、`expressions/*.exp.json`、`physics.json`）。此时页面必须额外引入 `live2d.min.js`，且**不要**同时 import `cubism2.js` 与 `cubism4.js`（要么用合一的 `index` 入口，要么只用一个）。

**同步加载（v8 fork 新增）**：`Live2DModel.fromSync(url)` 立即返回实例，`once('load')` 后再操作，适合骨架屏/预加载。

### 2.5 模型随 Electron 打包/引用的三种方式

| 方式 | 开发 | 生产 | 评价 |
|---|---|---|---|
| **自定义 `app://` 协议（推荐）** | ✅ | ✅ | 唯一标准做法；相对路径解析正确（`standard: true`） |
| Vite `public/` + dev server | ✅ | ❌（`file://` 下 XHR 被拦） | 只覆盖开发 |
| Vite assets `import ...?url` | ✅ | 部分 | 文件名会带 hash，破坏 model3.json 内部相对引用，**不推荐**用于整套模型 |
| 本地小 HTTP 服务器 | ✅ | ✅ | 可行但多一个进程，需处理端口/CORS |
| `webSecurity: false`（PPet 做法） | ✅ | ✅ | 能跑（PPet 就是这么干的），但关安全开关，不推荐 |

**推荐：自定义标准协议 `app://`**（main 进程）：

```ts
// main/index.ts —— 必须在 app ready 之前
import { app, protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,          // 关键：让相对 URL 能基于 model3.json 的 URL 解析
      secure: true,
      supportFetchAPI: true,   // 让 fetch/XHR 能访问
      corsEnabled: true,       // 开 CORS
      stream: true,
    },
  },
]);

app.whenReady().then(() => {
  const rendererRoot = app.isPackaged
    ? join(process.resourcesPath, 'app.asar', 'out', 'renderer') // electron-builder 实际路径按你的配置
    : join(app.getAppPath(), 'out', 'renderer');

  protocol.handle('app', (request) => {
    const url = new URL(request.url);            // 形如 app://models/Hiyori/Hiyori.model3.json
    const filePath = join(rendererRoot, decodeURIComponent(url.pathname));
    return net.fetch(pathToFileURL(filePath).toString());
  });
});
```

renderer 侧用法不变：`Live2DModel.from('app://models/Hiyori/Hiyori.model3.json')`，model3.json 里相对引用的 textures/motions 会自动基于 `app://models/Hiyori/` 解析。同时给 electron-vite 的 renderer 配 `base: './'`，并在 `public/` 下放模型（开发时也可直接用 `/models/...` 路径）。

### 2.6 透明窗口下 WebGL 渲染

- `backgroundAlpha: 0` + `premultipliedAlpha: false`（见 §2.3）是透明合成的关键。
- 若 canvas 上有 CSS 背景，务必 `canvas { background: transparent; }`，避免把不透明底色带进窗口。
- 渲染层面没有已知"透明窗口导致 WebGL 失败"的问题——透明是 BrowserWindow 的合成行为，WebGL 正常（PPet、dsh-live2d-pets 均实证）。

### 2.7 备选方案：untitled-pixi-live2d-engine 最小接入（Pixi v8 + Cubism 2–5）

若按 §1.1 选型结论走 `untitled-pixi-live2d-engine`，最小代码（官方 README 快速开始）：

```ts
import { Application, extensions } from 'pixi.js';
import { configureCubismSDK, Live2DModel, Live2DPlugin } from 'untitled-pixi-live2d-engine';

// 注册 v8 渲染管线（必须在创建 renderer 之前）
extensions.add(Live2DPlugin);

const app = new Application();
await app.init({
  resizeTo: window,
  preference: 'webgl',
  autoDensity: true,
  resolution: window.devicePixelRatio,
  backgroundAlpha: 0,          // 透明窗口
  premultipliedAlpha: false,   // Live2D 推荐
});
document.body.appendChild(app.canvas);

// 仅加载 Cubism 3/4/5 模型 → import ... from 'untitled-pixi-live2d-engine/cubism'，只需 live2dcubismcore.min.js
// 需要 Cubism 2 老模型 → import ... from 'untitled-pixi-live2d-engine'（index 入口），需再引入 live2d.min.js
const model = await Live2DModel.from('app://models/Hiyori/Hiyori.model3.json');
model.anchor.set(0.5);
model.position.set(app.screen.width / 2, app.screen.height / 2);
app.stage.addChild(model);

// 常用 API 与 pixi-live2d-display 一致：motion(group, index?) / expression(id) / model.on('hit', ...)
// 额外：model.parallelMotion([...])、model.motionLastFrame(group, index)、model.speak(url)（需 @pixi/sound）
```

> 备注：该引擎 `index` 入口 = Cubism Legacy（`live2d.min.js`）+ Modern（`live2dcubismcore.min.js`）双运行时；只用新模型时走 `/cubism` 入口省一个文件。多模型同时加载若卡住，先试 `configureCubismSDK({ memorySizeMB: 32 })`（官方 FAQ）。

---

## 3. 免费可商用模型资源（重点）

### 3.1 Live2D 官方示例模型（免费、可商用需标注，首选）

Live2D 官方 GitHub [Live2D/CubismWebSamples](https://github.com/Live2D/CubismWebSamples)（`develop` 分支）的 `Samples/Resources/` 下有 8 个 Cubism 4 模型：**Haru、Hiyori、Mao、Mark、Natori、Ren、Rice、Wanko**。可直接用 jsDelivr 直链加载（**以下 URL 全部实测 HTTP 200，CORS 全开**）：

| 模型 | model3.json 直链 | 体积 | 备注 |
|---|---|---|---|
| Hiyori（百瀬ひより） | `https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Hiyori/Hiyori.model3.json` | ≈4.7 MB | **桌宠首选**：完整 motions（10 个）/expressions/HitArea，社区使用最广 |
| Haru | `https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Haru/Haru.model3.json` | 中 | 动作最多（含配音 wav） |
| Mao | `https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Mao/Mao.model3.json` | 中 | 可爱系 |
| Mark | `https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Mark/Mark.model3.json` | 小 | 吉祥物风，体积小 |
| Natori | `https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Natori/Natori.model3.json` | 中 | |
| Ren / Rice / Wanko | 同上路径模式 `.../Resources/Ren|Rice|Wanko/<同名>.model3.json` | 中 | 后两者较小 |

**许可（重要）**：
- 适用 [Live2D Sample Model Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)（中文：[live2d-sample-model-terms_cn](https://www.live2d.com/eula/live2d-sample-model-terms_cn.html)）+ [Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)。
- **"Live2D Original Characters"（Hiyori、Haru、Mao、Mark、Natori、Shizuku、Ren、Rice、Wankoromochi 等）允许商用，但必须标注著作权**，标注文案：
  > "This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author's sole discretion."（空间不足时可缩写为 "This content uses sample data owned and copyrighted by Live2D Inc."）
- 特殊条款：**Hiyori / Miara 禁止任何形式的设计改动**；Shizuku 不得改名改设定；Mark 不得画成帅哥/写实风；Wankoromochi 须保留"年糕"主题。不符合条款的用法需先咨询 Live2D 官方。
- "Collaboration Characters"（合作角色）**禁止商用、禁止改、禁止再分发** —— 注意区分。

> 注意 jsDelivr 的 GitHub 文件大小上限（20MB/文件，且仓库超 500MB 会用镜像快照），桌宠模型普遍远小于此，安全。

### 3.2 zenghongtu/live2d-model-assets（PPet 模型源）——⚠️ 仅供个人使用

仓库：[zenghongtu/live2d-model-assets](https://github.com/zenghongtu/live2d-model-assets)（约 587MB，**无 LICENSE**，2022 年后未更新）。它是 PPet（[zenghongtu/PPet](https://github.com/zenghongtu/PPet)，MIT）的模型源。

**能做直接用的 Cubism 4/5 模型**：`assets/moc3/` 下 **67 个 Cubism 4 模型**（实测全仓共 67 个 `.model3.json`），全部是 Azur Lane / Girls' Frontline 风格的舰娘/枪娘。示例路径（`<名字>_<皮肤号>` 命名）：

```
assets/moc3/xuefeng/xuefeng.model3.json              # 雪风
assets/moc3/xuefeng_3/xuefeng_3.model3.json
assets/moc3/lafei/lafei.model3.json                  # 拉菲
assets/moc3/lingbo/lingbo.model3.json                # 绫波
assets/moc3/aidang_2/aidang_2.model3.json
assets/moc3/aierdeliqi_4/aierdeliqi_4.model3.json    # 爱宕
assets/moc3/chuixue_3/chuixue_3.model3.json          # 吹雪
assets/moc3/dafeng_2|dafeng_4/dafeng_2.model3.json   # 大凤
assets/moc3/ninghai_4/ninghai_4.model3.json          # 宁海
assets/moc3/pinghai_4|pinghai_6/...                  # 平海
assets/moc3/taiyuan_2/taiyuan_2.model3.json          # 太原
...（共 67 个，完整清单可用 GitHub API 拉取，见下）
```

直链模板：`https://raw.githubusercontent.com/zenghongtu/live2d-model-assets/master/assets/moc3/<name>/<name>.model3.json`（raw 域 `Access-Control-Allow-Origin: *`，可被 renderer XHR 直接加载；也可以 `https://cdn.jsdelivr.net/gh/zenghongtu/live2d-model-assets@master/assets/moc3/<name>/<name>.model3.json`）。

目录结构（以 `moc3/xuefeng/` 实测为例）——标准 Cubism 4 结构：

```
xuefeng/
├── xuefeng.model3.json      (1.4 KB)
├── xuefeng.moc3             (575 KB)
├── xuefeng.physics3.json    (1.7 KB)
├── motions/*.motion3.json   (15 个：idle/home/login/mail/touch_head/touch_body/touch_special/wedding...)
└── textures/texture_00..05.png
```

**Cubism 2 模型**（`assets/moc/`、`assets/Girls' Frontline/`、`assets/HyperdimensionNeptunia/` 等，入口是 `.model.json`）：
- 例：`assets/moc/22/model.json`（22 娘，仅 `model.moc` + 一张贴图，极小）；
- `assets/Girls' Frontline/` 下 40+ 个枪娘（`aa12_2403.model.json`、`hk416_3401.model.json`、`wa2000_6.model.json` 等）；
- `assets/HyperdimensionNeptunia/` 下 20+ 个（`neptune_classic/model.json` 等）。
- ⚠️ 这些是 Cubism 2，v8 fork 不支持，只能走 v6/v7 路径 + `live2d.min.js`。

**许可警告（务必写进产品）**：
- 该仓库**无 LICENSE**，且模型是**商业游戏（Azur Lane / Girls' Frontline / Neptunia）的拆包素材** → 版权归原游戏公司/角色版权方。
- 结论：**仅限个人学习/自用，禁止商用、禁止再分发、禁止随应用打包发布**。桌宠产品若面向用户分发，绝不能默认内置这些模型（可作为"用户自选、自己负责"的联网加载项，但即便这样也建议明确风险提示）。
- 完整模型清单获取：`curl https://api.github.com/repos/zenghongtu/live2d-model-assets/git/trees/master?recursive=1`，过滤 `*.model3.json`（67 个）或 `*.model.json`。

### 3.3 其他 Cubism 2 社区模型源（个人使用）

- [xiazeyu/live2d-widget-models](https://github.com/xiazeyu/live2d-widget-models)：看板娘模型库，Cubism 2，无明确许可；
- [fghrsh/live2d_api](https://github.com/fghrsh/live2d_api)：fghrsh 看板娘后端模型 API，Cubism 2；
- [summerscar/live2dDemo](https://github.com/summerscar/live2dDemo)、[Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model)、[iCharlesZ/vscode-live2d-models](https://github.com/iCharlesZ/vscode-live2d-models)、[luanshizhimei/live2d_models_collect](https://github.com/luanshizhimei/live2d_models_collect) 等。
- 以上均以游戏拆包为主，**许可不明 → 个人使用，商用需逐模型核实**。

### 3.4 桌宠体积/许可选择建议

1. **首选内置**：Hiyori（官方、4.7MB、可商用需标注、有完整 HitArea 与动作）；
2. 想更小：Mark（吉祥物风，体积最小档）；或用官方"simple model"（示例条款列出的极简模型，适合测试）；
3. 想要更多花样：Haru（动作最多）、Mao；
4. 用户自带模型：支持任意 `.model3.json` 的 http(s) URL（dsh-live2d-pets 就是这么做的：模型一律 URL 直载、不随包分发，清单只收录"许可可标注"的条目，NC 模型标注"仅限非商用"）；
5. 许可核对清单：① 是否允许商用（commercial use）② 是否要求署名/标注 ③ 是否禁止改设计 ④ 是否禁止再分发（随 app 打包 = 再分发）。官方示例是少数三条都清楚的材料。

---

## 4. 动作播放与控制 API

### 4.1 动作（Motion）

```ts
// 按 group 名播放；index 不传则在该组内随机
const ok: Promise<boolean> = model.motion('TapBody');            // 名字是 model3.json Motions 里的 group 名
model.motion('Idle', 0);                                          // 指定组内第 0 个
model.motion('TapBody', undefined, MotionPriority.FORCE);        // 优先级：NONE=0 < IDLE=1 < NORMAL=2 < FORCE=3

import { MotionPriority } from '@naari3/pixi-live2d-display';

// 动作结束回调（v8 fork 的 Live2DModel 不再透传 motionFinish，需监听 motionManager）
model.internalModel.motionManager.on('motionFinish', () => {
  // 播完一个动作
  model.motion('Idle');  // 回到待机
});
model.internalModel.motionManager.on('motionStart', (group, index, audio) => {
  // 动作开始；audio 为 SoundManager 音频句柄（如果模型带音）
});
```

- `model.motion()` 返回的 Promise 在动作**开始**时 resolve（`false` 表示因优先级/预约被拒），不是播完。
- 动作名以 `model3.json` 的 `Motions` 分组为准（Cubism 4 常为 `Idle` / `TapBody` / `TapHead`；Cubism 2 常为 `tap_body` / `tap_head`），加载后用 `model.internalModel.motionManager.groups` 可查。
- 播放策略比官方框架更好：同一优先级的动作会**排队（reserve）**而不是打断。

### 4.2 命中检测（HitArea）

```ts
// 事件式（推荐）：内部调用 hitTest 后 emit
model.on('hit', (hitAreas: string[]) => {
  if (hitAreas.includes('Body')) model.motion('TapBody');
  if (hitAreas.includes('Head')) model.motion('TapHead');
});

// 命令式：传画布世界坐标，返回命中的区域名数组
const names: string[] = model.hitTest(pointerX, pointerY);

// 手动触发一次点击判定（等价于上面事件）
model.tap(pointerX, pointerY);
```

- HitArea 由模型文件定义（`model3.json` 的 `HitAreas` / Cubism 2 的 `hit_areas_custom`）。**没有 HitArea 的模型（如很多老模型）`hitTest` 恒空**——dsh-live2d-pets 的做法是回退到"包围盒五矩形分区"（头/身/腿/左右臂按比例切分），可参考其 [spec](https://github.com/cyanfish-x/dsh-live2d-pets/blob/master/docs/spec/live2d-pet-v01.md)。
- v8 fork 默认 `autoInteract: true` 时鼠标移动会自动驱动眼睛/头部跟随（focus）。

### 4.3 表情与参数控制

```ts
// 表情：按 id 播放 / 随机
model.expression('Smile');                 // model3.json Expressions 里的 id（如 Haru 的 F01.exp3.json）
model.expression();                        // 随机表情

// 参数级控制（v8 fork：coreModel 是 CubismWebFramework 的 CubismModel）
model.internalModel.coreModel.setParameterValueById('ParamAngleX', 30);   // 头部左右 -30~30
model.internalModel.coreModel.setParameterValueById('ParamAngleY', 20);   // 抬头低头
model.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', 1);  // 左眼睁合 0~1
model.internalModel.coreModel.setParameterValueById('ParamEyeROpen', 1);
model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0.5); // 嘴

// 叠加式（避免被动作每帧覆盖）：add 是在当前值上累加
model.internalModel.coreModel.addParameterValueById('ParamAngleX', 10);
```

> 坑：正在播放的 motion/表情每帧会**覆盖**参数值。想长期保持某个参数（如眨眼控制），要么用 `addParameterValueById`（叠加量），要么在你的 ticker 里每帧 `setParameterValueById`，要么在 `motionFinish` 后设置。

其他可玩项：`model.focus(x, y, instant?)`（眼睛/头看向屏幕某点）、`model.internalModel.eyeBlink`（眨眼）、`model.internalModel.breath`（呼吸）、`model.internalModel.physics`（物理，`physicsLoaded` 后可用）。

### 4.4 模型事件汇总（v8 fork）

`settingsJSONLoaded` → `settingsLoaded` → `textureLoaded` → `modelLoaded` → `poseLoaded`/`physicsLoaded` → `ready` → `load`，外加 `hit`。加载失败可用 `Live2DModel.from(url, { onError })` 或在 promise 上 catch。

---

## 5. 透明窗口 + WebGL：已知坑与对策

### 5.1 BrowserWindow 配置（参考 PPet 生产代码）

```ts
const win = new BrowserWindow({
  transparent: true,             // 透明窗口
  frame: false,                  // 无边框（macOS 透明必需）
  hasShadow: false,              // 桌宠不需要窗口阴影
  roundedCorners: false,         // macOS：关圆角，避免四周露出圆角外的颜色
  alwaysOnTop: true,
  skipTaskbar: true,
  minimizable: false,
  maximizable: false,
  resizable: false,
  webPreferences: {
    preload: join(__dirname, '../preload/index.cjs'),
    backgroundThrottling: false, // ★ 关键：防止窗口失焦/隐藏时 rAF 被节流导致 Live2D 冻结
  },
});
win.setAlwaysOnTop(true, 'floating');      // macOS 层级：floating / screen-saver
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
```

主进程补充（PPet 实测）：`app.commandLine.appendSwitch('disable-renderer-backgrounding')`、`app.commandLine.appendSwitch('disable-background-timer-throttling')`、`app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')`（如果模型动作带音频）。

**点击穿透与拖动**（桌宠必备）：
```ts
// 需要穿透时（如让鼠标点到桌面）
win.setIgnoreMouseEvents(true, { forward: true });
// 恢复交互
win.setIgnoreMouseEvents(false);
```
画布可拖动的另一条路：CSS `-webkit-app-region: drag`（配合 `no-drag` 处理点击区域）。

### 5.2 Pixi 侧 alpha 合成

- v6 及更早用 `transparent: true`；**v7 起移除该选项，一律 `backgroundAlpha: 0`**（v8 同样）。
- `premultipliedAlpha: false` 对 Live2D 更稳（fork playground 注释即"Better for Live2D rendering"）。
- `canvas { background: transparent; }`；`app.renderer.clearBeforeRender` 保持默认即可。
- 别把 `resizeTo: window` 与 `autoDensity` 组合在透明窗口里造成毛边——`resolution: window.devicePixelRatio` 已由 playground 验证。

### 5.3 GPU 加速关闭时能否软渲染

- Chromium 在无 GPU 时会退回 **SwiftShader（软件 WebGL）**，pixi-live2d-display 仍能跑，但大模型/多模型掉帧明显（Live2D 每帧重算网格+软光栅）。
- macOS 上透明窗口**不需要**关 GPU 加速（`app.disableHardwareAcceleration()` 是 Windows 老问题的做法）。
- ⚠️ Windows 历史方案：用 `app.disableHardwareAcceleration()` 或 `--disable-gpu-compositing` 让透明窗口支持点击穿透——**在 Electron 38+（Chromium 139）已失效**（[electron#48064](https://github.com/electron/electron/issues/48064)），macOS 无此依赖，但团队若跨平台需知。
- 若真要软渲染，Pixi 可选 `new Application({ context })` 自建 WebGL1 上下文；不推荐主动关 GPU。

### 5.4 capturePage 能否捕获 WebGL 内容

- **能**。`webContents.capturePage()` 捕获的是**合成后的帧**（含 WebGL 内容与透明 alpha），不是 DOM 截图。
- 已知坑与对策：
  1. **黑图**：常见于窗口尚未完成首次绘制就 capture → 等 `ready-to-show`/`did-finish-load` 后再截，或监听 `'paint'` 事件后截；
  2. **禁用 GPU 时黑图**：软渲染下某些版本 capture 为空 → 保留 GPU；
  3. **窗口隐藏/最小化时**：`backgroundThrottling: false` 可保证 rAF 持续；若仍取不到帧，改用 `webContents.beginFrameSubscription` 或 `offscreen: true`（离屏渲染模式）；
  4. 透明窗口截出来是带 alpha 的 `NativeImage`，缩略图（托盘预览）要 `image.resize({ quality: 'best' })` 或自己合成底色。

### 5.5 性能与节流

- 隐藏窗口/标签页失焦时 rAF 会暂停（桌面宠物"睡着"是特性；想保持动画就 `backgroundThrottling: false`）。
- 限帧：桌宠 30fps 足够（dsh-live2d-pets 默认 30，可配 60/不限）。
- 多显示器/Retina：`autoDensity` + `resolution` 已处理 DPR；拖到不同缩放屏时监听 `display-metrics-changed` 重建。

---

## 6. 参考链接汇总

**库与文档**
- guansss 原版：[pixi-live2d-display（npm 0.4.0）](https://www.npmjs.com/package/pixi-live2d-display)、[GitHub + README.zh.md](https://github.com/guansss/pixi-live2d-display)、[文档站](https://guansss.github.io/pixi-live2d-display)、[DeepWiki 安装/入门](https://deepwiki.com/guansss/pixi-live2d-display/2.1-installation)
- v8 fork：[@naari3/pixi-live2d-display（npm 1.2.5）](https://www.npmjs.com/package/@naari3/pixi-live2d-display)、[GitHub](https://github.com/naari3/pixi-live2d-display)、[文档站](https://naari3.github.io/pixi-live2d-display)
- 其他 fork：[@jannchie/pixi-live2d-display](https://www.npmjs.com/package/@jannchie/pixi-live2d-display)、[pixi-live2d-display-advanced](https://www.npmjs.com/package/pixi-live2d-display-advanced)、[pixi-live2d-display-webgal](https://www.npmjs.com/package/pixi-live2d-display-webgal)
- **Pixi v8 全家桶候选**：[untitled-pixi-live2d-engine（npm 1.3.5）](https://www.npmjs.com/package/untitled-pixi-live2d-engine)、[GitHub](https://github.com/Untitled-Story/untitled-pixi-live2d-engine)（Cubism 2–5、原生 v8 渲染管线）
- v7 唇形同步 fork：[pixi-live2d-display-lipsyncpatch（npm 0.5.0-ls-8）](https://www.npmjs.com/package/pixi-live2d-display-lipsyncpatch)

**Cubism / Live2D 官方**
- [Cubism SDK for Web 下载页](https://www.live2d.com/download/cubism-sdk/download-web/)（Core 从这里拿）
- [Cubism Core 手册](https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/)、[SDK for Web 手册](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/)（Core 不在 GitHub）
- [Migrating to Cubism 5 SDK（兼容性）](https://docs.live2d.com/en/cubism-sdk-manual/update-sdk-to-cubism5/)
- [示例模型条款（EN）](https://www.live2d.com/eula/live2d-sample-model-terms_en.html) / [（中文）](https://www.live2d.com/eula/live2d-sample-model-terms_cn.html)、[Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)
- [Live2D/CubismWebSamples（官方示例模型仓库）](https://github.com/Live2D/CubismWebSamples)

**模型资源**
- [zenghongtu/live2d-model-assets（PPet 模型源，个人使用）](https://github.com/zenghongtu/live2d-model-assets)、[zenghongtu/PPet](https://github.com/zenghongtu/PPet)
- [dsh-live2d-pets（同生态参考实现 + 模型清单）](https://github.com/cyanfish-x/dsh-live2d-pets)
- Cubism 2 社区源：xiazeyu/live2d-widget-models、fghrsh/live2d_api、Eikanya/Live2d-model

**Electron 透明窗口 / WebGL**
- [electron#48064：disableHardwareAcceleration 透明穿透失效（v38+）](https://github.com/electron/electron/issues/48064)
- [Electron 离屏渲染文档](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)
- PPet main 进程实测配置：https://github.com/zenghongtu/PPet/blob/dev/src/main/index.ts

---

## 附录：验证日期与实测记录

- npm registry 元数据（peerDependencies、dist-tags）抓取于 2026-08-16；
- 官方示例模型 5 条 jsDelivr 直链全部 HTTP 200；
- `cdn.jsdelivr.net/npm/live2dcubismcore@1.0.2/live2dcubismcore.min.js`、`cdn.jsdelivr.net/gh/dylanNew/live2d@master/.../live2d.min.js`、`cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js` 均 HTTP 200（CORS 全开）；
- zenghongtu 仓库全树 7659 个文件，`.model3.json` 共 67 个（`assets/moc3/`）；
- v8 fork 源码核验：`Live2DModel.from/fromSync`、`motion()`、`expression()`、`focus()`、`tap()`、`hitTest()`、`MotionPriority`、`motionFinish` 事件、`Assets.load` 纹理加载、`premultipliedAlpha: false` playground 配置；
- 收尾补充核验（同一日）：`pixi-live2d-display-lipsyncpatch@0.5.0-ls-8` peer `pixi.js ^7`（cubism2/cubism4/extra 四入口）；`untitled-pixi-live2d-engine@1.3.5` peer `pixi.js ^8.13.1` + 依赖 `@pixi/sound ^6`（入口 `.`/`cubism-legacy`/`cubism`/`extra`，README 声称 Cubism 2–5、原生 v8 Render Pipe、并行动作/末帧保持/唇形同步，仓库 2026-07 仍有提交）。
