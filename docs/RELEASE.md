# 发布打包指南（macOS .app/.dmg + Windows .exe）

> 工程已配置 electron-builder（`apps/desktop/electron-builder.yml`）+ 应用图标（皮丘 Pichu icns/png，由 Live2D 模型渲染生成）+ 公证钩子（`scripts/notarize.js`）。
> 打包命令在 `apps/desktop` 目录执行（`npm run dist` / `dist:dir`）。

---

## 一、macOS 发布（.dmg + .zip）

### 0. 前置
- **Apple Developer 账号**（$99/年）：用于 Developer ID Application 证书 + 公证（**macOS Sequoia 起 Gatekeeper 强制公证，未公证包无法直接分发**）
- 证书装到本机钥匙串（Xcode → Settings → Accounts 或手动导入 .p12）

### 1. 更新版本号
```bash
# apps/desktop/package.json 的 version 改为目标版本（如 0.1.0 → 0.2.0）
```

### 2. 一键打包（含签名+公证）
```bash
cd apps/desktop
# 方式 A：本地测试包（跳过签名公证，仅本机可用）
npm run dist

# 方式 B：正式发布（签名+公证，推荐）
export APPLE_ID="你的AppleID@邮箱"
export APPLE_APP_SPECIFIC_PASSWORD="你的App专用密码"   # appleid.apple.com 生成
export APPLE_TEAM_ID="你的TeamID"
npm run dist
```
- `afterSign` 钩子自动执行 notarize（未设环境变量时跳过并提示）
- 产物：`apps/desktop/release/`
  - `桌面宠物助手-<版本>-arm64.dmg`（安装包，分发用）
  - `桌面宠物助手-<版本>-arm64-mac.zip`（更新/备用）
  - `桌面宠物助手-<版本>-arm64-mac.zip.blockmap`（自动更新差分用）

### 3. 验证
```bash
# 公证校验（应返回 accepted）
spctl --assess --type execute --verbose=4 "release/mac-arm64/桌面宠物助手.app"
# dmg 装订校验
xcrun stapler validate "release/桌面宠物助手-<版本>-arm64.dmg"
```

### 4. 分发
- 把 dmg/zip 传到 **GitHub Releases**（electron-builder `publish: {provider: github}` 已配置，后续可接 electron-updater 自动更新）
- 用户下载 dmg → 拖入 Applications 即可（已公证：无警告直接打开）

---

## 二、Windows 发布（.exe）

### 0. 前置（需在 **Windows 机器** 上构建）
- 安装 **Node.js LTS**（≥20）
- 代码签名证书（推荐 **EV 证书**，免 SmartScreen 拦截；普通 OV 证书会提示"未知发布者"）
- Windows 10/11 自带 **WebView2**（无需额外处理）

### 1. 准备工程
```bash
# 在 Windows 上 clone/拷贝项目（或 git clone 后）
git clone <仓库地址>
cd desktop-helper
npm install        # 注意：需安装全局/本地 electron-builder（package.json 已含）
```

### 2. 配置签名（可选但强烈建议）
```bash
# 方式 A：环境变量（CI 常用）
export CSC_LINK="/path/to/cert.p12"
export CSC_KEY_PASSWORD="证书密码"
# 方式 B：electron-builder.yml win 段加
#   certificateFile: path/to/cert.p12
#   certificatePassword: xxx
```

### 3. 打包
```bash
cd apps/desktop
npm run dist       # 产物：release/桌面宠物助手 Setup <版本>.exe（NSIS 安装器）
# 或只出免安装版
npm run dist:dir   # release/win-unpacked/桌面宠物助手.exe
```

### 4. 分发
- `桌面宠物助手 Setup <版本>.exe` 上传 GitHub Releases
- 用户双击安装（NSIS 向导；`oneClick:false` 可选手动下一步）
- 安装器自动创建开始菜单快捷方式（带 AUMID `com.desktophelper.pet` → toast 通知可用）

---

## 二·五、本地打包给朋友（非商用，推荐路径）

> 目标：不做商用/不上架，只是把桌宠打包发给朋友用。**无需 $99 开发者账号、无需公证**。

### macOS（本机即可完成）
```bash
cd apps/desktop
npm run dist:dir                       # 产出 release/mac-arm64/桌面宠物助手.app（未签名）
# 压缩成 zip 方便传输（朋友无需安装器）
cd release/mac-arm64
zip -r 桌面宠物助手-mac.zip "桌面宠物助手.app"
```
- **推荐 AirDrop 传输**：AirDrop 接收的文件不带 quarantine 属性 → 朋友**双击即可直接打开**，无需任何额外操作
- 走网盘/微信/QQ 传输：朋友首次打开会提示"无法验证开发者"→ **右键 → 打开** 一次即可（以后正常打开）
- 若朋友遇到"应用已损坏"（未签名 + 网盘下载常见）：朋友执行 `xattr -dr com.apple.quarantine 桌面宠物助手.app`（或我提供 ad-hoc 签名版：`codesign --force --deep -s - 桌面宠物助手.app` 可消掉该报错）
- Apple Silicon 机器：产物是 arm64；若朋友是 Intel Mac 需在本机重新打包（x64 架构）或后续配 universal

### Windows（需一台 Windows 机器打包）
```bash
# Windows 机器上：装 Node LTS → 拷贝项目 → 
npm install
cd apps/desktop
npm run dist          # 产出 release/桌面宠物助手 Setup <版本>.exe（NSIS 安装器）
# 或免安装版：npm run dist:dir → release/win-unpacked/桌面宠物助手.exe 整个文件夹发给朋友
```
- 无代码签名时朋友安装/首次运行会看到 **SmartScreen「未知发布者」** → 点「更多信息 → 仍要运行」即可（朋友间传软件常见，可接受）
- 免安装版（win-unpacked 整个目录 zip 发送）可绕开 SmartScreen 的安装拦截，双击 exe 即用

### 注意
- 打包产物默认 arm64（Apple Silicon）；朋友机器架构不同需对应打包
- 版本号在 `apps/desktop/package.json` 改
- 正式商用/公开分发请回到上面 §一/§二（签名+公证）

---

## 三、CI 自动发布（可选，推荐）

GitHub Actions 双平台矩阵，推 tag 自动构建发布：
```yaml
# .github/workflows/release.yml 骨架
name: Release
on: { push: { tags: ["v*"] } }
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
          - os: windows-latest
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      # macOS：导入证书 + 公证三件套（secrets: CSC_LINK/CSC_KEY_PASSWORD/APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID）
      - name: Import cert (macOS)
        if: runner.os == 'macOS'
        run: |
          echo "${{ secrets.CSC_LINK }}" | base64 --decode > /tmp/cert.p12
          security create-keychain -p temp build.keychain
          security import /tmp/cert.p12 -k build.keychain -P "${{ secrets.CSC_KEY_PASSWORD }}" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k temp build.keychain
      - name: Build & publish
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: cd apps/desktop && npm run dist
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with: { name: dist-${{ runner.os }}, path: apps/desktop/release/* }
```

---

## 四、常见问题

| 问题 | 解决 |
|---|---|
| dmg 构建失败（本 DSH 沙盒） | 沙盒禁磁盘挂载；**真实机器直接 npm run dist 正常出 dmg** |
| 未签名包被 Gatekeeper 拦 | 测试期：右键 → 打开；正式必须 Developer ID + 公证 |
| Windows 开发模式 toast 不显示 | 需"开始菜单快捷方式 + AUMID"双条件；**正式安装包自动满足** |
| 打包慢/下载 electron | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` |
| 无证书构建 | `CSC_IDENTITY_AUTO_DISCOVERY=false`（跳过签名，仅测试） |
| 双击 .app 打不开 | 检查是否公证；`xattr -dr com.apple.quarantine <app>`（仅本机测试） |
| Windows SmartScreen 拦截 | 需代码签名（EV 证书最优） |

---

## 五、发布清单（发版前检查）

- [ ] `apps/desktop/package.json` 版本号更新
- [ ] macOS：Developer ID 证书在钥匙串 + APPLE_* 三件套
- [ ] Windows：证书 p12（CSC_LINK/CSC_KEY_PASSWORD）
- [ ] `npm run typecheck` 0 错误 + `npm run build` 通过
- [ ] 打出的 .app/.dmg/.exe 实机双击验证（桌宠启动、托盘、AI 对话、各面板）
- [ ] dmg 公证校验通过（spctl）
- [ ] 产物上传 GitHub Releases
- [ ] （可选）electron-updater 自动更新配置

---

*详细技术背景见 `docs/PROGRESS.md` 与 `docs/report-desktop-pet-cross-platform.md`。*
