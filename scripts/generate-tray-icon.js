#!/usr/bin/env node
/**
 * 生成托盘图标：简约黑色爪印（macOS Template 模板图）。
 *
 * 用户定稿：不要 pichu、不要闪电 → 爪印（🐾：主肉垫 + 4 脚趾弧形排列），
 * 纯黑 + alpha 通道，系统自动适配浅/深色菜单栏，无其他颜色。
 *
 * 输出 16x16（@1x 单表示）：菜单栏标准 16pt。
 * 注意：单张 >16px 会被系统按像素当 pt 渲染溢出；多分辨率组合图在 Tray 上
 * 可能被按 @2x 渲染（均踩过坑）→ 只输出 @1x 16x16，尺寸确定。
 *
 * 用法：
 *   node scripts/generate-tray-icon.js          # 单图标 → resources/tray.png
 *   node scripts/generate-tray-icon.js --anim   # 动画帧 → resources/tray-anim/frame-0..N.png
 *                                               # （20 帧余弦 alpha 呼吸灯，4s 周期）
 * 无外部依赖：Node 内置 zlib + 手写 PNG 编码 + 椭圆超采样光栅化（抗锯齿）。
 */
'use strict'

const { deflateSync } = require('node:zlib')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const RES = join(__dirname, '..', 'apps', 'desktop', 'resources')
const SIZE = 16

/** 动画帧数（呼吸灯：20 帧 × 200ms = 4s 一个完整明暗周期） */
const ANIM_FRAMES = 20

// ---------- 爪印形状（归一化 0..1 椭圆 [cx, cy, rx, ry]） ----------
// 🐾 样式：两个爪印斜排（左上 + 右下，emoji 观感）；每只 = 主垫 + 3 趾弧形
// （16px 里 4 趾会糊成斑点，3 趾清晰）
const PAW_SHAPES = [
  // 爪印 A（左上）
  [0.28, 0.55, 0.11, 0.125], // 主垫
  [0.14, 0.38, 0.045, 0.06], // 趾 1
  [0.28, 0.31, 0.045, 0.06], // 趾 2
  [0.42, 0.38, 0.045, 0.06], // 趾 3
  // 爪印 B（右下）
  [0.74, 0.74, 0.11, 0.125], // 主垫
  [0.6, 0.57, 0.045, 0.06], // 趾 1
  [0.74, 0.5, 0.045, 0.06], // 趾 2
  [0.88, 0.57, 0.045, 0.06] // 趾 3
]

/**
 * 光栅化黑色爪印（椭圆内部判定 + 3x3 超采样抗锯齿）。
 * @param {number} size 输出边长
 * @param {number} alphaMul alpha 倍率（动画帧脉动用，1.0 = 全亮）
 */
function drawPaw(size, alphaMul = 1) {
  const buf = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const x = (px + (sx + 0.5) / 3) / size
          const y = (py + (sy + 0.5) / 3) / size
          for (const [cx, cy, rx, ry] of PAW_SHAPES) {
            const dx = (x - cx) / rx
            const dy = (y - cy) / ry
            if (dx * dx + dy * dy <= 1) {
              hits++
              break
            }
          }
        }
      }
      const alpha = Math.round((hits / 9) * 255 * alphaMul)
      const i = (py * size + px) * 4
      buf[i] = 0 // 纯黑
      buf[i + 1] = 0
      buf[i + 2] = 0
      buf[i + 3] = alpha
    }
  }
  return buf
}

// ---------- PNG 编码（RGBA → PNG） ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// ---------- 主流程 ----------
mkdirSync(RES, { recursive: true })
const args = process.argv.slice(2)

if (args.includes('--anim')) {
  // 呼吸灯动画帧：alpha 按余弦曲线 0.72→1.0→0.72 平滑渐变（明暗呼吸，非硬切换）
  // 生成 20 帧，配合 startTrayAnimation 200ms/帧 → 4s 一个周期（呼吸灯频率）
  const outDir = join(RES, 'tray-anim')
  mkdirSync(outDir, { recursive: true })
  // 清掉旧帧（帧数变化后避免残留旧帧被循环加载）
  for (let i = 0; i < 64; i++) {
    try {
      require('node:fs').unlinkSync(join(outDir, `frame-${i}.png`))
    } catch {
      break
    }
  }
  for (let i = 0; i < ANIM_FRAMES; i++) {
    // 余弦渐变：i=0 最暗(0.72)，i=10 最亮(1.0)，端点到端点斜率≈0 → 无突跳
    const alpha = 0.72 + 0.28 * (1 - Math.cos((2 * Math.PI * i) / ANIM_FRAMES)) / 2
    const p = join(outDir, `frame-${i}.png`)
    writeFileSync(p, encodePng(SIZE, SIZE, drawPaw(SIZE, alpha)))
  }
  console.log(`[generate-tray] 呼吸灯动画 ${ANIM_FRAMES} 帧已写入 ${outDir}（4s 周期，alpha 0.72→1.0）`)
} else {
  const p = join(RES, 'tray.png')
  writeFileSync(p, encodePng(SIZE, SIZE, drawPaw(SIZE)))
  console.log(`[generate-tray] wrote tray.png（${SIZE}x${SIZE} 黑色爪印模板图）`)
}
