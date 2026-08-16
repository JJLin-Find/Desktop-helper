# 桌面宠物形态 AI 桌面助手 —— 跨平台系统集成方案调研报告

> 范围：macOS 优先开发，预留 Windows。技术栈对比：Electron / Tauri v2 / 原生。
> 调研时间：2025 年（基于公开文档与社区最新实践）。

---

## 0. 结论速览（TL;DR）

| 模块 | 推荐方案 | 关键结论 |
|---|---|---|
| 系统托盘 | Electron `Tray` / Tauri v2 `TrayIcon`（二者都行） | macOS 用**模板图标**（template image），左键/右键菜单行为跨平台不同，须按平台处理 |
| 开机自启 | Electron `app.setLoginItemSettings` / Tauri `tauri-plugin-autostart` | macOS 13+ 走 **SMAppService**，**必须 Developer ID 签名 + 公证**，否则登录项不生效/不显示；Windows 走注册表 `Run` 键 |
| 通知与定时 | 系统通知（`Notification` / `tauri-plugin-notification`）+ **app 内 scheduler** | 桌宠是常驻 app，无需系统级服务；macOS 需请求通知授权（Sequoia 起更严格）；Windows toast 必须有 AppUserModelID |
| 窗口行为 | `alwaysOnTop` + `setVisibleOnAllWorkspaces` + `LSUIElement` + 点击穿透 | 盖过**全屏 app** 需要 NSPanel 级窗口层（Electron/Tauri 默认做不到，需原生胶水）；桌宠强烈建议隐藏 Dock 图标（LSUIElement） |
| 工程/发布 | monorepo：`core`（平台无关）+ `platform-api`（抽象接口）+ `electron|tauri` 壳 + `platform/darwin|win32` | 未签名分发只适合开发期；**Sequoia 起 Gatekeeper 逐步强制公证**，正式版建议 Developer ID + notarization |
| 自动更新 | **electron-updater**（Electron）/ **Tauri updater**（Rust） | 都是签名+公证为前提；electron-updater 支持 Windows 差分更新，Tauri 无内置差分；初期用 GitHub Releases 即可 |

**技术选型一句话**：
- 团队以 Web/JS 为主 → **Electron**：tray / 登录项 / 通知 / 置顶 API 开箱即用，桌宠社区案例（Live2D 桌宠）最多，成本最低。
- 在意常驻内存（桌宠 24h 挂后台，Electron 基线 ~150MB+，Tauri ~20-40MB）且团队有 Rust → **Tauri v2**：官方插件链（autostart/notification/single-instance/window-state/positioner/updater）已覆盖本需求，但 macOS 特殊窗口行为（NSPanel 层级、全屏覆盖）需要更多原生胶水。
- 追求 macOS 极致体验且不在乎双平台成本 → 原生（Swift + NSStatusBar + NSPanel），但 Windows 要重写一套，不推荐作为起点。

---

## 1. 系统托盘（Tray / MenuBar）

### 1.1 Electron

API：`new Tray(icon)` + `tray.setContextMenu()` / `tray.on('click')`。

**macOS 与 Windows 的核心差异**（[Electron 官方 Tray 教程](https://az.electronjs.org/zh/docs/latest/tutorial/tray)、[Electron 跨平台差异清单](https://misakajimmy.github.io/docs/frontend/electron/electron_%E8%B7%A8%E5%B9%B3%E5%8F%B0%E5%B7%AE%E5%BC%82%E4%B8%8E%E5%85%BC%E5%AE%B9%E6%80%A7%E6%B8%85%E5%8D%95_windows_macos%E4%B8%8Elinux/)）：

| 行为 | macOS（菜单栏状态栏） | Windows（系统托盘） |
|---|---|---|
| 图标素材 | 需 **template image**（文件名以 `Template` 结尾或 `icon.setTemplateImage(true)`），纯黑+透明通道，系统自动适配深色模式 | 普通 ico/png 即可，注意多 DPI（16/24/32px） |
| 左键单击 | 设置了 `setContextMenu` 后**左键即弹菜单**；未设置菜单时左键触发 `click` 事件 | 左键**默认不弹菜单**，只触发 `click` 事件；右键弹菜单 |
| 菜单交互 | 菜单点击后自动关闭；状态栏图标有"点击弹回"的毛玻璃反馈 | 菜单与右键一致，无特殊反馈 |
| 退出残留 | 退出前必须 `tray.destroy()`，否则图标残留在菜单栏直到重启 | 进程退出即消失 |
| 可见性 | **全屏 app 会隐藏菜单栏 → 托盘图标不可见**（桌宠的坑，见 §4） | 任务栏托盘常驻可见 |

**坑与要点**：
- macOS 图标尺寸建议 22pt @1x/2x（44px），必须 `Template` 命名，否则深色菜单栏下看不清。
- macOS 上"左键弹出菜单"是 Electron 自动行为；若要左键做"呼出桌宠"、右键才弹菜单，需要自己处理（macOS 上关闭 context menu 的自动弹出行为比较绕，常用做法：不 `setContextMenu`，用 `click` 事件手动 `popUpContextMenu` 或展示窗口）。
- Windows 上托盘图标与通知是绑定的：必须设置 `app.setAppUserModelId(...)`，否则通知和托盘关联异常（详见 §3）。

### 1.2 Tauri v2

Tauri v2 把托盘内置到核心（`tauri::tray::TrayIcon`，JS 侧 `@tauri-apps/api/tray`，[Tauri 托盘 API 文档](https://v2.tauri.org.cn/reference/javascript/api/namespacetray/)）。可在 `tauri.conf.json` 静态声明或在 Rust 运行时用 `TrayIconBuilder` 创建：

```jsonc
// tauri.conf.json（静态声明）
"app": {
  "trayIcon": {
    "icon": "icons/tray.png",
    "iconAsTemplate": true   // macOS 模板图标开关（仅 macOS 生效）
  }
}
```

```rust
// 运行时创建（推荐，便于动态菜单）
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton};
TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .icon_as_template(true)                       // macOS
    .tooltip("桌面宠物")
    .on_menu_event(|app, event| { /* 菜单点击 */ })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
            // Windows 左键默认不弹菜单，需手动处理；macOS 有菜单则自动弹出
        }
    })
    .build(app)?;
```

**坑**：TrayIcon 实例必须**持有引用**（存到 state），否则被 Drop 后图标消失；`iconAsTemplate` 只对 macOS 生效；Windows 左键/右键菜单行为与 Electron 相同，需要自行区分事件。

### 1.3 原生

- macOS：`NSStatusBar.systemStatusBar.statusItem` + `NSStatusItem`，配合 `NSMenu`，图标用 `template` 渲染模式。体验最原汁原味（支持毛玻璃、菜单交互），但只覆盖 macOS。
- Windows：Win32 `Shell_NotifyIcon(NIM_ADD)` + `NOTIFYICONDATA` + 回调消息，配合 `CreatePopupMenu`。代码量大，不推荐手写。

### 1.4 推荐

- Electron：直接用 `Tray`，封装进平台适配层（接口见 §7）。
- Tauri：`TrayIconBuilder` 运行时创建 + 持有引用。
- 桌宠场景额外注意：托盘菜单要提供「显示/隐藏桌宠」「暂停提醒」「开机自启开关」「退出」四项，退出才是真正 `quit`（桌宠常驻，关窗≠退出）。

---

## 2. 开机自启

### 2.1 macOS

**三种机制**：

| 机制 | 说明 | 适用 |
|---|---|---|
| **SMAppService（macOS 13+ 推荐）** | `ServiceManagement` 框架的 `SMAppService.mainApp.register()`，把主 app 注册为登录项；系统在「系统设置 → 通用 → 登录项」中统一管理（macOS 14+ 为「登录项与扩展」） | 现代 macOS，推荐 |
| LaunchAgents plist（旧） | 写 `~/Library/LaunchAgents/com.xxx.plist`（用户级）或 `/Library/LaunchAgents`（需 root）；macOS 13+ 会弹「在后台运行」提示并要求公证 | 兼容旧系统/非 App Store |
| 传统 `kSMLoginItem`（已废弃） | 老 ServiceManagement API，macOS 13+ 已不推荐 | 不建议 |

**[SMAppService 官方文档](https://developer.apple.com/documentation/servicemanagement/smappservice)** 要点：
- `SMAppService.mainApp.register()` 注册主 app 登录项；`unregister()` 注销；`status` 查询状态。
- **关键限制**：要求 app 已签名；**实践上必须 Developer ID 签名 + 公证（notarization）**，否则注册失败或登录项不出现在系统列表中（[Stack Overflow 案例](https://stackoverflow.com/questions/78685859/my-macos-apphelper-is-not-in-the-system-preferences-login-item-allow-backgroun)、[Apple 开发者论坛 SMAppService 讨论](https://developer.apple.com/forums/tags/servicemanagement)）。
- App Store（MAS）分发：`SMAppService.mainApp` 在 MAS 下可用，但 **helper/LaunchDaemon 类服务受限**，且 MAS 审核对"后台常驻 + 自启动"类 app 有额外说明要求。桌宠若走 MAS 需提前在审核备注中说明。
- 用户可随时在系统设置里关闭登录项 —— 你的 UI 要能检测 `status` 与用户开关是否一致（Electron 侧 `getLoginItemSettings` 会反映）。

**Electron 现成方案**：`app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })`。Electron 24+ 在 macOS 13+ 上自动改用 SMAppService（支持 `type: 'mainAppService'`）。**注意已知 bug**：[electron/electron#42376](https://github.com/electron/electron/issues/42376) —— `type: 'loginItemService'` 在部分版本始终失败；建议使用默认的 `mainAppService`，或干脆自己调 `SMAppService`（[社区参考：cryptomator 的 Swift 实现](https://github.com/cryptomator/integrations-mac/pull/45)）。

### 2.2 Windows

- **注册表 Run 键（推荐）**：`HKCU\Software\Microsoft\CurrentVersion\Run`（当前用户，无需管理员）或 `HKLM`（所有用户，需管理员）。
- 启动文件夹：`shell:startup`（用户级），放个 `.lnk` 快捷方式即可。
- Electron 已内置：`app.setLoginItemSettings({ openAtLogin: true, path: process.execPath })` 内部就是写 Run 键；`getLoginItemSettings().executableWillLaunchAtLogin` 可查询是否被用户禁用。
- Tauri：`tauri-plugin-autostart` 的 `MacOSLauncher` 选项之外，Windows 侧直接写注册表（插件内部实现）。

### 2.3 Tauri 现成方案

`tauri-plugin-autostart`（官方）：Rust 侧 `app_handle.plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))`，JS 侧 `enable()/disable()/isEnabled()`。
- `MacosLauncher::LaunchAgent`（写 plist，兼容旧系统）或 `MacosLauncher::SMAppService`（macOS 13+，推荐，但**要求已签名**）。
- 注意 macOS 13+ 用 LaunchAgent 方式会触发「后台项已添加」系统提示，且用户可在「登录项与扩展」中管理 —— 体验不如 SMAppService 干净。

### 2.4 推荐

- Electron：`app.setLoginItemSettings`（macOS 自动走 SMAppService，Windows 走 Run 键），**不要**用 `loginItemService` 类型（有 bug）。
- Tauri：`tauri-plugin-autostart`，macOS 13+ 选 `SMAppService`，macOS 12 及以下回退 `LaunchAgent`（版本判断：`SystemVersion >= 13`）。
- 统一在设置页提供开关，并**回读状态**（用户可能在系统设置里手动关闭）。
- 打包时**必须**配好签名 + 公证，否则 macOS 自启动在真实用户机器上不工作 —— 这是最容易踩的坑。

---

## 3. 通知与定时提醒

### 3.1 系统通知

**macOS（UNUserNotificationCenter）**：
- 需先 `requestAuthorization` 获取授权；首次触发时系统弹「是否允许通知」授权框（[参考：Wails 项目的权限流程说明](https://datasea.cn/go0207468364.html)）。
- **macOS Sequoia（15）起授权更严格**：系统会弹独立的通知权限确认，且**未签名/未公证的 app 可能压根不弹授权框或通知被静默丢弃**（[Macworld 报道](https://www.macworld.com/article/2429205/macos-sequoia-requires-regular-permission-checks-when-using-certain-apps.html)）。再次印证签名/公证是刚需。
- 通知点击回调：实现 `UNUserNotificationCenterDelegate`（Electron 的 `Notification.on('click')` 已封装）。
- 注意：macOS 通知权限拒绝后，需要在「系统设置 → 通知」手动开启；app 内应做「权限被拒」的引导 UI。

**Windows（Toast）**：
- 走 Windows Toast（Action Center），**前置条件：AppUserModelID（AUMID）**。要求安装时在开始菜单/安装目录有带 AUMID 的快捷方式，否则通知不显示（[Electron 官方通知教程](https://github.com/electron/electron/blob/main/docs/tutorial/notifications.md)、[appUserModelId 说明 PR](https://github.com/electron/electron/pull/13259)）。
- Electron：打包前 `app.setAppUserModelId('com.xxx.pet')`；electron-builder 生成的安装包会自动创建带 AUMID 的快捷方式；**开发模式（未安装）时通知可能不显示**，需先跑一次安装包或用 `app.setAppUserModelId(process.execPath)` 兜底。
- 点击通知唤起 app：Electron `Notification` 的 `click` 事件可处理；复杂交互（按钮/输入框）需 [electron-windows-interactive-notifications](https://github.com/felixrieseberg/electron-windows-interactive-notifications)。

**框架封装**：
- Electron：`new Notification({ title, body, icon }).show()`，跨平台统一，权限由框架处理。
- Tauri：`tauri-plugin-notification`，JS 侧 `isPermissionGranted() → requestPermission() → sendNotification()`；Windows 同样受 AUMID 限制（Tauri 的 WiX/NSIS 安装器会注册 AUMID）。

### 3.2 定时提醒：需要系统级服务吗？

**结论：不需要**。桌宠本来就是常驻 app（托盘常驻 + 自启动），app 内 scheduler 足够：

| 方案 | 适用 | 说明 |
|---|---|---|
| **app 内 scheduler（推荐）** | 桌宠常驻场景 | JS：`setTimeout` 对齐到整点/分钟、或 `node-cron`；Rust：`tokio::time` / `std::thread` 定时唤醒 |
| LaunchAgent/daemon（系统级） | app 完全退出后还要提醒 | 桌宠不需要；若要，macOS 用 `SMAppService` 注册 helper，Windows 用 Task Scheduler |
| 服务器推送（APNs/FCM/WNS） | 跨设备/离线提醒 | 与桌面 app 无关，桌宠阶段不必上 |

**两个必须注意的平台细节**：
1. **macOS App Nap**：后台不可见 app 可能被系统节流（定时器不精准）。对策：Info.plist 加 `NSAppSleepDisabled = true`；或 Electron `powerSaveBlocker`（这防的是系统睡眠，不是 App Nap，App Nap 主要靠 `NSAppSleepDisabled`/`NSProcessInfo beginActivity`）。定时提醒要准，建议开启。
2. **本地时区/夏令时**：scheduler 一律按本地时区计算下次触发，不要用 UTC 累加。

### 3.3 推荐

- 通知：优先系统通知（macOS UNUserNotificationCenter / Windows Toast），不要自绘通知浮层（会被用户系统设置拦截、体验差）。
- 定时：app 内 scheduler，秒级对齐用 `setTimeout` 重算，分钟级用 `node-cron`/`tokio`；状态持久化到 store（§5.4），app 重启后恢复未触发的提醒。
- 点击通知 → 呼出桌宠并执行动作（如展示提醒卡片），这是桌宠的核心交互闭环。

---

## 4. 窗口行为细节

### 4.1 始终置顶（alwaysOnTop）

- Electron：`win.setAlwaysOnTop(true, 'floating')`，macOS 上 level 可选 `'floating'`（普通置顶）或 `'screen-saver'`（更高层级）。
- Tauri v2：`window.set_always_on_top(true)` / JS `setAlwaysOnTop(true)`。
- **macOS 全屏空间的坑**：
  - 普通置顶窗口在**其他 app 全屏时会被盖住**（[electron/electron#10078](https://github.com/electron/electron/issues/10078)）。解决：`win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` + `setAlwaysOnTop`。
  - 已知 bug：[electron/electron#36364](https://github.com/electron/electron/issues/36364) —— 组合使用在**窗口未手动聚焦前不生效**；[#24451](https://github.com/electron/electron/issues/24451) 缺少事件通知。做法：创建窗口后立即 `focus()` + 延时再设 `visibleOnFullScreen`，并在每次激活时兜底重设。
  - **真正盖过全屏 app（如全屏播放视频）**需要 NSPanel（`NSPanelStyleNonactivatingPanel` + `NSFloatingWindowLevel`/`NSStatusWindowLevel`/`kCGMaximumWindowLevel`）。Electron/Tauri 默认**不支持** NSPanel 层级，方案：a) 原生模块（N-API/objc2 胶水）创建 NSPanel 承载桌宠；b) 接受局限（全屏时不显示桌宠）。
- 桌宠建议：默认 `floating` 层级 + 所有空间可见；「盖过全屏」做成可选项（牺牲一点兼容性，用原生胶水实现，macOS 优先阶段可后置）。

### 4.2 隐藏 Dock 图标（桌宠的必要性）

**结论：必要**。桌宠是常驻 accessory，不应占 Dock 位置。

- **macOS**：`Info.plist` 设 `LSUIElement = true`（accessory 模式）→ 无 Dock 图标、无菜单栏 app 菜单、Cmd+Tab 默认不显示。
  - Electron 运行时还可 `app.dock.hide()`，但**打包期 `LSUIElement` 才可靠**（[Electron 自定义窗口交互文档](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)）。
  - 需要临时显示 Dock（如打开设置面板时）：`app.dock.show()` + `app.setActivationPolicy('regular')`，关闭后恢复 `accessory`。
  - 坑：LSUIElement 下 app 无菜单栏，快捷键（如 Cmd+Q）需自己注册；`window-all-closed` 不能退出，否则桌宠就没了。
- **Windows**：无 Dock 概念。对应行为是「**最小化到托盘**」：窗口 `hide()` 而非 `close()`，托盘常驻；窗口加 `skipTaskbar: true` 避免任务栏出现。
- **Tauri**：`tauri.conf.json` 的 `app > macOS > privateApi`？不对——正确做法：macOS 侧 `app.set_activation_policy(tauri::ActivationPolicy::Accessory)`（macOS 专属，隐藏 Dock）；Windows 侧窗口 `skip_taskbar(true)`。

### 4.3 多显示器 / 多空间

| 场景 | macOS | Windows |
|---|---|---|
| 多 Space（虚拟桌面） | `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` 让桌宠在所有空间可见；否则只在当前空间 | 无 Spaces；但 Windows 11 有虚拟桌面，Electron/Tauri 无直接 API，默认跟随当前桌面即可 |
| 多显示器 | 记住窗口所在显示器；`screen` API 检测显示器插拔，bounds 越界时 clamp 回主屏 | 同上：`screen.getDisplayMatching` / `window.setBounds` 前校验 |
| 窗口状态保持 | `electron-window-state` / 自存 bounds + `setPosition` | `tauri-plugin-window-state`（跨平台） |

- 桌宠被拖到副屏后，副屏拔掉会导致窗口"消失"——**必须做 bounds 校验 + clamp**（存 `{ x, y, width, height }`，启动时判断是否落在某显示器内）。
- 推荐直接用现成库：Electron → `electron-window-state`；Tauri → `tauri-plugin-window-state`。

### 4.4 桌宠窗口参数要点

```js
// Electron 主进程
const win = new BrowserWindow({
  width: 320, height: 480,
  transparent: true, frame: false, resizable: false,
  alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
  webPreferences: { transparent: true }
});
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
// 点击穿透（非交互区）：win.setIgnoreMouseEvents(true, { forward: true })
// 交互时：win.setIgnoreMouseEvents(false)
```

- macOS：`transparent: true` 的窗口**性能开销大**（Live2D/逐帧动画时注意帧率），建议桌宠本体用透明窗口、弹窗/设置用普通窗口。
- Windows：透明窗口与 `resizable: true` 冲突的老坑依旧存在（保持 `resizable: false`）；注意 DPI 缩放（electron-builder 默认处理 per-monitor DPI manifest）。
- 关闭行为：`window-all-closed` 里**不要 quit**（除非 `process.platform !== 'darwin' && 用户选择退出`）；真正退出走托盘「退出」。
- 点击穿透：`setIgnoreMouseEvents(true, { forward: true })` 可让鼠标事件透传给下层窗口但保留 hover（[Electron 文档](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)；Wayland 侧的修复见 [electron#51144](https://github.com/electron/electron/pull/51144)）。桌宠方案：默认穿透，鼠标悬停（mousemove）时关闭穿透、恢复交互，移出后恢复——Live2D 桌宠标配做法。

---

## 5. 工程与发布

### 5.1 代码组织："一套核心逻辑 + 平台适配层"

**核心原则**：核心逻辑（AI 会话、prompt、提醒状态机、scheduler、数据模型）**零平台依赖**；所有系统能力通过**抽象接口**暴露，按 `process.platform`（Electron）或 `cfg!(target_os)`（Tauri）选择实现。

```
desktop-pet/
├── packages/
│   ├── core/                 # 纯 TS（或纯 Rust）核心：AI client、会话、scheduler、状态机、提醒模型
│   ├── platform-api/         # 平台抽象接口 + 共享类型（ITray/IAutoLaunch/INotifier/IWindow/IUpdater...）
│   └── shared/               # 常量、IPC 协议类型、i18n
├── apps/
│   └── desktop/              # 壳（先 Electron，后可按需加 Tauri 壳）
│       ├── src/main/
│       │   ├── platform/
│       │   │   ├── darwin/   # tray(模板图标)/dock 隐藏/登录项(SMAppService)/置顶层级/AppNap
│       │   │   └── win32/    # 托盘/注册表自启/AUMID/toast 兜底
│       │   ├── services/     # scheduler、notification、updater、store、logging
│       │   └── ipc/          # preload 桥接
│       ├── src/preload/
│       ├── src/renderer/     # 桌宠 UI（Live2D/Spine/canvas）、设置页
│       └── build/            # electron-builder.yml、Info.plist、entitlements
├── scripts/                  # notarize、release、sign 脚本
└── .github/workflows/        # CI/CD
```

**平台接口示例（TypeScript）**：

```ts
// packages/platform-api/src/index.ts
export interface ITray {
  create(opts: TrayOptions): void;
  setTooltip(t: string): void;
  updateMenu(items: MenuItem[]): void;
  destroy(): void;
}
export interface IAutoLaunch {
  isEnabled(): Promise<boolean>;
  enable(): Promise<void>;
  disable(): Promise<void>;
}
export interface INotifier {
  requestPermission(): Promise<'granted' | 'denied'>;
  show(n: PetNotification): Promise<void>;
  onClick(cb: (n: PetNotification) => void): void;
}
export interface IWindowManager {
  showPet(): void; hidePet(): void;
  setAlwaysOnTop(on: boolean): void;
  setClickThrough(on: boolean): void;
}
export interface IPlatform {
  readonly name: 'darwin' | 'win32';
  tray: ITray; autoLaunch: IAutoLaunch; notifier: INotifier; windows: IWindowManager;
}
// 工厂：apps/desktop/src/main/platform/index.ts
export function createPlatform(): IPlatform {
  return process.platform === 'darwin' ? new DarwinPlatform() : new Win32Platform();
}
```

- `core` 只依赖 `platform-api` 的接口类型，**反向依赖禁止**（`core` 不 import 具体平台实现）。
- 单例注入：启动时 `createPlatform()` 一次性组装，传参给 `services`。
- 这种做法让 Windows 适配变成"补一个 `win32/` 目录"，而不是重构。

### 5.2 macOS 未签名应用的分发（Gatekeeper / ad-hoc / 公证）

**背景**：从互联网下载的 app 带 `com.apple.quarantine` 属性，Gatekeeper 会拦截。

| 方式 | 做法 | 效果 | 是否够用 |
|---|---|---|---|
| 右键打开 | 用户右键 app → 打开 → 确认 | 绕过首次拦截，但**每次升级都要再绕一次**（app 更新后签名变化） | 仅开发期内部测试 |
| `xattr -dr com.apple.quarantine` | 终端手动去 quarantine | 一次性；普通用户不会用 | 仅开发机 |
| **ad-hoc 签名** | `codesign -s - --force --deep` | 消除"已损坏，无法打开"报错（因为没签名导致），但**不改变 Gatekeeper 拦截**；**Sequoia 起 ad-hoc 签名被视同未签名，体验更差** | 仅 CI 打测试包 |
| **Developer ID 签名 + 公证（推荐）** | 付费开发者账号（$99/年）→ `codesign`（Developer ID Application）→ `notarytool submit` 公证 → `xcrun stapler` 装订 | 用户双击即可打开，无警告 | **正式分发的唯一正解** |

**必须知道的最新变化**：Apple 2024-08-06 宣布 [macOS Sequoia 运行时保护更新](https://developer.apple.com/news/?id=saqachfa)：Gatekeeper 将**逐步要求所有 macOS 软件必须签名 + 公证**（新签名软件自 2025 年起强制，随后扩展到存量软件）。也就是说"未签名右键打开"这条路正在被封死，**公证从"最好有"变成"必须有"**。

**electron-builder 自动化**（Tauri 对应 `tauri-action` 配置）：
- `mac.notarize: true`（或 afterSign 钩子调 `@electron/notarize`）；
- 环境变量：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`（App 专用密码）、`APPLE_TEAM_ID`；
- 证书：Developer ID Application 证书装进 CI（`CSC_LINK` / `CSC_KEY_PASSWORD`）；
- 公证后务必 `stapler staple`，否则跨机器仍可能被 Gatekeeper 拦（electron-builder 的 notarize 已含 staple）。

参考：[macOS 分发完整踩坑笔记（rsms gist）](https://gist.github.com/rsms/929c9c2fec231f0cf843a1a746a416f5)。

### 5.3 CI/CD（GitHub Actions 双平台）

**结构**：一个 workflow，`matrix: [macos-latest, windows-latest]`，各自构建 + 签名 + 发布到 GitHub Releases（electron-builder 的 `publish: github` / `tauri-action` 原生支持）。

```yaml
# .github/workflows/release.yml（骨架）
name: Release
on:
  push: { tags: ["v*"] }
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest    # macOS 构建
          - os: windows-latest  # Windows 构建
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      # macOS 证书导入 + 公证凭据（secrets: CSC_LINK/CSC_KEY_PASSWORD/APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID）
      - name: Import signing cert (macOS)
        if: runner.os == 'macOS'
        run: |
          echo "${{ secrets.CSC_LINK }}" | base64 --decode > /tmp/cert.p12
          security create-keychain -p temp build.keychain
          security import /tmp/cert.p12 -k build.keychain -P "${{ secrets.CSC_KEY_PASSWORD }}" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k temp build.keychain
      - run: npx electron-builder --publish always   # 或 tauri-action: tauri-action@v0 with args: --publish
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

**要点**：
- Windows 签名：正式分发建议代码签名证书（EV 证书最省心，普通 OV 也可）；无证书时用自签测试证书（会触发 SmartScreen 警告）。
- 产物：`dist/*.dmg|*.zip|*.exe|*.blockmap|latest-mac.yml|latest.yml` 自动发布到 GitHub Releases，更新器直接消费这些文件（§6）。
- 密钥全部走 GitHub Secrets；macOS 证书导入脚本如上（keychain partition list 那步必须有，否则 codesign 静默失败）。
- 参考成熟实践：[electron-react-boilerplate 的发布流水线](https://deepwiki.com/electron-react-boilerplate/electron-react-boilerplate/6.3-publishing)、[Tauri release workflow 示例](https://github.com/alisaitteke/ttt/blob/HEAD/.github/workflows/release.yml)。

### 5.4 配置持久化

| 方案 | 位置 | 说明 |
|---|---|---|
| **Electron**：`electron-store` | `app.getPath('userData')/config.json` | JSON + 原子写入（write-file-atomic），API 极简，[官方文档](https://github.com/sindresorhus/electron-store)；适合设置/状态/草稿 |
| **Tauri**：`tauri-plugin-store` | `app_config_dir` 下 JSON | 官方插件，Rust/JS 双端可用，带变更事件 |
| 敏感数据（API Key） | macOS **Keychain** / Windows **凭据管理器** | Electron 用 `keytar`；Tauri 用 `keyring` crate / 社区 keyring 插件。**不要把 AI API Key 明文写 JSON** |

要点：提醒任务、窗口位置、开机自启开关、托盘状态都要持久化；写操作防并发（序列化写队列）。

### 5.5 日志

| 方案 | 说明 |
|---|---|
| Electron：**log4js**（主进程统一输出） | 文件 appender + 按大小/日期滚动（`log4js` 的 rolling file），renderer 日志经 IPC 转发到主进程统一落盘；`userData/logs/` |
| Tauri/Rust：**tracing + tracing-subscriber + tracing-appender** | `tracing-appender` 滚动文件 + `rolling never|daily`；Rust 生态标准 |
| 错误上报（可选） | Sentry（Electron 有官方 SDK；Rust 有 `sentry` crate），桌宠阶段可后置 |

要点：日志级别可配置（`--verbose`/设置页开关）；**不要**把 AI 对话明文全量落日志（隐私），只落事件摘要与错误。

---

## 6. 自动更新方案对比

| 维度 | **electron-updater**（Electron） | **Tauri updater**（`tauri-plugin-updater`） | 自建 |
|---|---|---|---|
| 集成成本 | 低：electron-builder 一键发布 + `autoUpdater` | 中：`tauri signer generate` 生成密钥，`pubkey` 写配置，每次发布 `tauri signer sign` 签名 | 高：签名、校验、清单、回滚、灰度全自己写 |
| 签名要求 | 不需要额外密钥（靠 macOS/Windows 代码签名） | **必须** minisign/RSA 密钥对，私钥必须保密 | 自定 |
| macOS | 更新包需**签名 + 公证**，否则更新后打不开 | 同左：更新包需公证 | 同左 |
| Windows | **NSIS 支持差分更新**（blockmap，省流量）；MSI 不支持 | 支持 NSIS/MSI 全量替换，**无内置差分** | 差分难做 |
| 发布源 | GitHub Releases / S3 / 任意 HTTP | GitHub / 任意 HTTP（endpoints 配置） | 任意 |
| 灰度/多通道 | 可自搭 staged rollout（stable/beta 通道） | 无内置灰度，需自己按 channel 配 endpoint | 完全可控 |
| 成熟度 | 高（社区主力方案） | 中（v2 起成熟，但坑比 electron-updater 多，如签名链错误难排查） | 低 |

**结论**：
- Electron → **electron-updater**，配合 GitHub Releases，初期零成本；后续灰度再上自建 OSS/多 channel。
- Tauri → **tauri-plugin-updater**，密钥妥善保管（GitHub Secrets），macOS 更新同样绑定公证。
- **自建不推荐起步**（签名校验 + 回滚 + 灰度的工作量远超桌宠本体），除非有强合规/私有分发需求。
- 参考：[三大框架更新策略对比（Electron/Flutter/Tauri）](https://blog.csdn.net/ByteVein/article/details/155440476)、[Tauri 更新指南](https://tauri.org.cn/v1/guides/distribution/updater/)。

---

## 7. "macOS 优先 + 预留 Windows" 落地清单

1. **选壳**：JS 团队 → Electron；Rust 团队且在意常驻内存 → Tauri v2。（本文示例以 Electron 为主，Tauri 差异点已逐条标注。）
2. **先建 `platform-api` 接口**（§5.1），再写 `darwin/` 实现，`win32/` 留 TODO 桩 —— Windows 阶段只加实现不改核心。
3. **macOS 打包红线**（按顺序做）：
   - `Info.plist`：`LSUIElement=true`、`NSAppSleepDisabled=true`、`NSHighResolutionCapable=true`；
   - `electron-builder.yml`：`mac.hardenedRuntime=true`、`entitlements`（含 `com.apple.security.device.audio-input` 等按需）、`notarize`、`extendInfo.LSUIElement`；
   - 注册 Apple Developer 账号 → Developer ID 证书 → 配置 CI 公证三件套（`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`）。
4. **开发期**：`xcode` 之外用 ad-hoc 签名 + 右键打开跑通功能；**内测**：公证过的 Developer ID 包走 GitHub Releases + 自动更新。
5. **Windows 阶段**：补 `win32/` 实现（托盘 AUMID、注册表自启、toast、`skipTaskbar`），CI matrix 加 `windows-latest`，`electron-builder` 配 `win.target: nsis`；代码签名证书按需采购。
6. **验收清单**：托盘图标深浅色适配 ✓；开机自启可被系统设置关闭且 UI 同步 ✓；通知权限被拒的引导 ✓；副屏拔插窗口不丢 ✓；全屏 app 下桌宠层级符合预期 ✓；`Cmd+Q`/关窗不退出、托盘「退出」才退出 ✓。

---

## 参考链接

- Electron Tray：[官方教程](https://az.electronjs.org/zh/docs/latest/tutorial/tray)、[跨平台差异清单](https://misakajimmy.github.io/docs/frontend/electron/electron_%E8%B7%A8%E5%B9%B3%E5%8F%B0%E5%B7%AE%E5%BC%82%E4%B8%8E%E5%85%BC%E5%AE%B9%E6%80%A7%E6%B8%85%E5%8D%95_windows_macos%E4%B8%8Elinux/)
- Tauri v2 Tray：[API 文档](https://v2.tauri.org.cn/reference/javascript/api/namespacetray/)、[CSDN 实战避坑](https://wenku.csdn.net/column/34s6nu519ss)
- 开机自启：[SMAppService（Apple 文档）](https://developer.apple.com/documentation/servicemanagement/smappservice)、[Electron setLoginItemSettings bug #42376](https://github.com/electron/electron/issues/42376)、[登录项不显示问题（SO）](https://stackoverflow.com/questions/78685859/my-macos-apphelper-is-not-in-the-system-preferences-login-item-allow-backgroun)、[cryptomator SMAppService 实现](https://github.com/cryptomator/integrations-mac/pull/45)、[Apple 论坛 ServiceManagement](https://developer.apple.com/forums/tags/servicemanagement)
- 通知：[Electron 通知教程](https://github.com/electron/electron/blob/main/docs/tutorial/notifications.md)、[appUserModelId 要求 PR](https://github.com/electron/electron/pull/13259)、[electron-windows-interactive-notifications](https://github.com/felixrieseberg/electron-windows-interactive-notifications)、[Sequoia 权限变化（Macworld）](https://www.macworld.com/article/2429205/macos-sequoia-requires-regular-permission-checks-when-using-certain-apps.html)
- 窗口：[alwaysOnTop 全屏问题 #10078](https://github.com/electron/electron/issues/10078)、[#36364](https://github.com/electron/electron/issues/36364)、[#24451](https://github.com/electron/electron/issues/24451)、[自定义窗口交互](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)、[Wayland 点击穿透 #51144](https://github.com/electron/electron/pull/51144)
- 分发：[Apple：macOS Sequoia 运行时保护更新](https://developer.apple.com/news/?id=saqachfa)、[macOS 分发踩坑笔记（rsms）](https://gist.github.com/rsms/929c9c2fec231f0cf843a1a746a416f5)
- CI/CD：[electron-react-boilerplate 发布流水线](https://deepwiki.com/electron-react-boilerplate/electron-react-boilerplate/6.3-publishing)、[Tauri release workflow 示例](https://github.com/alisaitteke/ttt/blob/HEAD/.github/workflows/release.yml)
- 持久化/日志：[electron-store](https://github.com/sindresorhus/electron-store)、Tauri 官方插件集（store/autostart/notification/single-instance/window-state/updater）：[plugins-workspace](https://github.com/tauri-apps/plugins-workspace)
- 更新：[三大框架自动更新对比](https://blog.csdn.net/ByteVein/article/details/155440476)、[Tauri 更新指南](https://tauri.org.cn/v1/guides/distribution/updater/)
