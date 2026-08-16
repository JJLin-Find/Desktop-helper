#!/usr/bin/env node
/**
 * electron-builder afterSign 钩子：macOS 公证（notarize）骨架。
 *
 * 用法：
 *   - 正式发布前安装依赖：`npm i -D @electron/notarize`（当前未安装，未设置环境变量时本脚本直接跳过）
 *   - 环境变量三件套（GitHub Actions Secrets 或本机 export）：
 *       APPLE_ID                        Apple 开发者账号邮箱
 *       APPLE_APP_SPECIFIC_PASSWORD     App 专用密码（appleid.apple.com 生成，勿用账号密码）
 *       APPLE_TEAM_ID                   开发者团队 ID（如 ABCDE12345）
 *   - 证书：Developer ID Application 证书装入钥匙串（CI 用 CSC_LINK / CSC_KEY_PASSWORD）
 *
 * 行为：
 *   - 非 darwin 平台 → 跳过
 *   - 环境变量未齐 → 打印提示并跳过（本地 --dir / 未配账号时安全通过）
 *   - 环境变量齐但 @electron/notarize 未安装 → 报错并提示先安装
 *   - 公证成功后 electron-builder 会自动执行 stapler 装订（无需额外步骤）
 */
'use strict'

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') {
    console.log('[notarize] 非 macOS 平台，跳过公证')
    return
  }

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID
  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      '[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 未全部设置，跳过公证（开发/内测包）'
    )
    return
  }

  let notarize
  try {
    // 延迟 require：未安装 @electron/notarize 时不阻塞普通构建
    ;({ notarize } = require('@electron/notarize'))
  } catch (e) {
    throw new Error(
      '[notarize] 缺少 @electron/notarize，请先执行：npm i -D @electron/notarize（在 apps/desktop 下）'
    )
  }

  const appName = context.packager.appInfo.productFilename
  const appBundleId = context.packager.appInfo.appId
  const appPath = `${appOutDir}/${appName}.app`

  console.log(`[notarize] 开始公证 ${appPath} (bundleId=${appBundleId})`)
  await notarize({
    appBundleId,
    appPath,
    appleId,
    appleIdPassword,
    teamId
  })
  console.log('[notarize] 公证提交成功（electron-builder 将继续 stapler 装订）')
}
