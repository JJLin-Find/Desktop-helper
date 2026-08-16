#!/usr/bin/env node
/**
 * 下载 Live2D 模型（从 GitHub 仓库按目录递归拉取）。
 *
 * 用法：
 *   node scripts/download-live2d-model.js <repo> <dir> <outDir>
 * 示例：
 *   node scripts/download-live2d-model.js zenghongtu/live2d-model-assets assets/moc3/aidang_2 apps/desktop/resources/live2d/aidang_2
 *
 * 通过 GitHub API 列目录，raw.githubusercontent.com 下载文件。
 */
'use strict'

const { mkdirSync, writeFileSync, existsSync } = require('node:fs')
const { join, dirname } = require('node:path')
const { execFileSync } = require('node:child_process')

const [repo, dir, outDir] = process.argv.slice(2)
if (!repo || !dir || !outDir) {
  console.error('用法: node scripts/download-live2d-model.js <repo> <dir> <outDir>')
  process.exit(1)
}

const API = `https://api.github.com/repos/${repo}/contents/${dir}`
const files = []

function curl(args) {
  // GitHub API 需要 User-Agent；失败重试 3 次
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return execFileSync('curl', ['-s', '-m', '40', '-H', 'User-Agent: desktop-helper', ...args], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 32
      })
    } catch (err) {
      if (attempt === 3) throw err
      console.error(`  重试 ${attempt}/3 ...`)
    }
  }
  throw new Error('unreachable')
}

function list(path) {
  const out = curl([path])
  const items = JSON.parse(out)
  for (const item of items) {
    if (item.type === 'dir') {
      list(item.url)
    } else if (item.type === 'file') {
      files.push(item)
    }
  }
}

list(API)

let count = 0
for (const f of files) {
  const url = f.download_url
  const dest = join(outDir, f.path.replace(dir, ''))
  mkdirSync(dirname(dest), { recursive: true })
  // 用 curl 下载（避免 Node fetch 依赖）
  curl(['-sL', '-m', '90', '-o', dest, url])
  count++
  console.log(`  ${f.path.replace(dir, '').replace(/^\//, '')} (${f.size} B)`)
}

console.log(`[download-live2d-model] 完成：${count} 个文件 → ${outDir}`)
void existsSync
void writeFileSync
