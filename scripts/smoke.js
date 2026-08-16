#!/usr/bin/env node
/**
 * 统一冒烟测试（Smoke Test）
 *
 * 依次启动应用并运行各 PET_* 验证模式，断言关键输出，防止回归：
 *   1. 启动渲染（透明窗口 + Live2D 模型锚定）
 *   2. AI 对话全链路（桌宠/查询/天气/搜索/局域网 mock）
 *   3. 剪贴板历史（去重/pin/粘贴/图片/持久化/常驻轮询）
 *   4. 文件搜索（真实 mdfind）
 *   5. 日程管理（调度器 Job/通知/重复展开）
 *   6. 番茄钟（阶段切换/统计/停止）
 *   7. 存储持久化（写入→重启读回）
 *   8. Markdown 渲染（信息查询助手）
 *
 * 用法：node scripts/smoke.js          （先自行构建；或传 --build 先构建）
 * 退出码：0=全部通过；1=任一失败
 */
'use strict'

const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const APP_DIR = join(ROOT, 'apps/desktop')
const ELECTRON = join(ROOT, 'node_modules', '.bin', 'electron')
const TMP = '/tmp/dsh-smoke'

const args = process.argv.slice(2)
if (args.includes('--build')) {
  console.log('[smoke] 构建 core / platform-api / desktop ...')
  const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (b.status !== 0) {
    console.error('[smoke] ❌ 构建失败')
    process.exit(1)
  }
}

/** 每个验证模式的配置：env 附加变量 + 断言（返回 boolean） */
const CASES = [
  {
    name: '启动渲染（透明窗+模型锚定）',
    env: { PET_SCREENSHOT: `${TMP}/render.png` },
    assert: (out) =>
      out.includes('[main] 桌宠已启动') &&
      out.includes('渲染层状态') &&
      out.includes('锚底期望')
  },
  {
    name: 'AI 对话全链路（桌宠/查询/天气/搜索/局域网）',
    env: {
      PET_AI_MOCK: '1',
      PET_SEARCH_MOCK: '1',
      PET_BOCHA_BASE: 'http://127.0.0.1:18098',
      PET_SCREENSHOT: `${TMP}/ai.png`
    },
    assert: (out) => out.includes('[ai-mock] 回复6(局域网自定义)') && out.includes('局域网无Key鉴权头')
  },
  {
    name: '剪贴板历史（去重/pin/粘贴/图片/持久化/轮询）',
    env: { PET_CLIP_TEST: '1', PET_SCREENSHOT: `${TMP}/clip.png` },
    assert: (out) => out.includes('[clip-test] 全部完成 ✅') && !/\[clip-test\].*FAIL/.test(out)
  },
  {
    name: '文件搜索（真实 mdfind）',
    env: { PET_FS_TEST: '1', PET_SCREENSHOT: `${TMP}/fs.png` },
    assert: (out) => out.includes('[fs-test] 全部完成 ✅')
  },
  {
    name: '日程管理（Job/通知/重复展开）',
    env: { PET_CAL_TEST: '1', PET_SCREENSHOT: `${TMP}/cal.png` },
    assert: (out) => out.includes('[cal-test] 全部完成 ✅') && !/\[cal-test\].*FAIL/.test(out)
  },
  {
    name: '番茄钟（阶段切换/统计/停止）',
    env: { PET_POMO_TEST: '1', PET_SCREENSHOT: `${TMP}/pomo.png` },
    assert: (out) => out.includes('[pomo-test] 全部完成 ✅') && !/\[pomo-test\].*FAIL/.test(out)
  },
  {
    name: '存储持久化（写入→重启读回）',
    env: { PET_STORE_PROBE: '1', PET_SET_NAME: '冒烟测试', PET_SCREENSHOT: `${TMP}/s1.png` },
    assert: (out) => out.includes('[store] pet.name: 冒烟测试'),
    // 该模式会写 userData；用独立目录避免污染
    userData: `${TMP}/persist`
  },
  {
    name: 'Markdown 渲染（信息查询助手）',
    env: { PET_MD_TEST: '1', PET_SCREENSHOT: `${TMP}/md.png` },
    assert: (out) => out.includes('[md-test] 渲染输出') && out.includes('<h1>')
  }
]

let passed = 0
const failures = []

for (const c of CASES) {
  const userData = c.userData ?? `${TMP}/${c.name.replace(/[^\w]/g, '')}`
  const env = { ...process.env, ...c.env }
  process.stdout.write(`[smoke] ▶ ${c.name} ... `)
  const r = spawnSync(ELECTRON, ['.', '--no-sandbox', `--user-data-dir=${userData}`], {
    cwd: APP_DIR,
    env,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 64 * 1024 * 1024
  })
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const ok = r.status === 0 && c.assert(out)
  if (ok) {
    passed++
    console.log('✅')
  } else {
    failures.push(c.name)
    console.log('❌')
    console.log(`   exit=${r.status}, signal=${r.signal}`)
    // 打印关键输出尾部便于定位
    const lines = out.split('\n').filter((l) => l.includes('test') || l.includes('store]') || l.includes('ai-mock') || l.includes('md-test') || l.includes('main]'))
    console.log('   关键输出:', lines.slice(-8).join(' | '))
  }
}

console.log(`\n[smoke] 结果：${passed}/${CASES.length} 通过`)
if (failures.length > 0) {
  console.error('[smoke] ❌ 失败项:', failures.join(', '))
  process.exit(1)
}
console.log('[smoke] ✅ 全部冒烟通过')
