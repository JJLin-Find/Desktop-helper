#!/usr/bin/env node
/**
 * 规范化 Live2D model3.json 的动作分组：
 * 把 Motions 从单一 "" 组拆分为按文件名命名的组，便于 model.motion('GroupName') 精确播放。
 *
 * 用法：node scripts/normalize-model-motions.js <model3.json 路径...>
 */
'use strict'

const { readFileSync, writeFileSync } = require('node:fs')

const GROUP_RULES = [
  { group: 'Idle', files: ['idle', 'main_1', 'main_2', 'main_3'] },
  { group: 'TouchHead', files: ['touch_head'] },
  { group: 'TouchBody', files: ['touch_body'] },
  { group: 'TouchSpecial', files: ['touch_special'] },
  { group: 'Complete', files: ['complete', 'mission_complete', 'mission'] },
  { group: 'Wake', files: ['login'] },
  { group: 'Home', files: ['home'] },
  { group: 'Mail', files: ['mail'] },
  { group: 'Wedding', files: ['wedding'] }
]

function normalize(path) {
  const model = JSON.parse(readFileSync(path, 'utf8'))
  const src = model.FileReferences?.Motions
  if (!src) {
    console.error(`[normalize] 无 Motions: ${path}`)
    return
  }
  // 收集所有动作文件（按出现顺序去重）
  const allFiles = []
  for (const group of Object.values(src)) {
    for (const m of group) {
      const name = m.File.replace(/^motions\//, '').replace(/\.motion3\.json$/, '')
      if (!allFiles.includes(name)) allFiles.push(name)
    }
  }
  // 组装命名组（未匹配的落入 Idle 兜底）
  const motions = {}
  for (const rule of GROUP_RULES) {
    const files = rule.files.filter((f) => allFiles.includes(f))
    if (files.length > 0) {
      motions[rule.group] = files.map((f) => ({ File: `motions/${f}.motion3.json` }))
    }
  }
  const unmatched = allFiles.filter((f) => !GROUP_RULES.some((r) => r.files.includes(f)))
  if (unmatched.length > 0) {
    motions.Idle = [...(motions.Idle ?? []), ...unmatched.map((f) => ({ File: `motions/${f}.motion3.json` }))]
  }
  model.FileReferences.Motions = motions
  writeFileSync(path, JSON.stringify(model, null, 1) + '\n')
  console.log(
    `[normalize] ${path}: 组 ${Object.keys(motions).join(', ')}（${allFiles.length} 个动作）`
  )
}

for (const p of process.argv.slice(2)) normalize(p)
