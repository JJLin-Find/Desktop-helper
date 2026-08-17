#!/usr/bin/env node
/**
 * 生成托盘图标：简约黑色闪电（macOS Template 模板图）。
 *
 * 用户要求：不要 pichu 形象，图标简约明了、轮廓黑色、无其他颜色
 * → 经典 macOS 模板图标：纯黑 + alpha 通道，系统自动适配浅/深色菜单栏。
 * 形状选闪电（⚡）：呼应皮丘元素、AI 灵动感、轮廓极简有识别度。
 *
 * 输出 16x16（@1x 单表示）：菜单栏标准 16pt。
 * 注意：单张 >16px 会被系统按像素当 pt 渲染溢出；多分辨率组合图在 Tray 上
 * 可能被按 @2x 渲染（均踩过坑）→ 只输出 @1x 16x16，尺寸确定。
 *
 * 用法：
 *   node scripts/generate-tray-icon.js          # 单图标 → resources/tray.png
 *   node scripts/generate-tray-icon.js --anim   # 动画帧 → resources/tray-anim/frame-0..3.png
 *                                               # （alpha 脉动呼吸，模板图明暗变化）
 * 无外部依赖：Node 内置 zlib + 手写 PNG 编码 + 多边形光栅化（抗锯齿）。
 */
'use strict'

const { deflateSync } = require('node:zlib')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const RES = join(__dirname, '..', 'apps', 'desktop', 'resources')
const SIZE = 16

// ---------- 闪电粗条路径（中心线，归一化 0..1；粗线段距离场光栅化，腰部焊接连贯） ----------
const SEGMENTS = [
  [0.62, 0.02, 0.30, 0.44], // 顶 → 左上（斜）
  [0.30, 0.44, 0.56, 0.44], // 腰部水平折
  [0.56, 0.44, 0.38, 0.98]  // 腰部 → 底尖（斜）
]
/** 半宽（归一化）：约 1.44px @16px → 条径 2.9px（明显粗于细闪电，又不失形状） */
const HALF_WIDTH = 0.09

/** 动画帧数（呼吸灯：20 帧 × 200ms = 4s 一个完整明暗周期） */
const ANIM_FRAMES = 20

/** 点到线段距离 */
function segDist(px, py, s) {
  const ax = s[0]
  const ay = s[1]
  const bx = s[2]
  const by = s[3]
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * 光栅化黑色闪电粗条（距离场 + 1px 线性抗锯齿，两端圆头，腰部自然焊接）。
 * @param {number} size 输出边长
 * @param {number} alphaMul alpha 倍率（动画帧脉动用，1.0 = 全亮）
 */
function drawBolt(size, alphaMul = 1) {
  const buf = Buffer.alloc(size * size * 4)
  const edge = 1 / size // 抗锯齿过渡带（约 1 像素）
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size
      const y = (py + 0.5) / size
      let minD = Infinity
      for (const s of SEGMENTS) {
        const d = segDist(x, y, s)
        if (d < minD) minD = d
      }
      let alpha = (HALF_WIDTH + edge - minD) / edge
      alpha = Math.max(0, Math.min(1, alpha))
      const i = (py * size + px) * 4
      buf[i] = 0 // 纯黑
      buf[i + 1] = 0
      buf[i + 2] = 0
      buf[i + 3] = Math.round(alpha * 255 * alphaMul)
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
    writeFileSync(p, encodePng(SIZE, SIZE, drawBolt(SIZE, alpha)))
  }
  console.log(`[generate-tray] 呼吸灯动画 ${ANIM_FRAMES} 帧已写入 ${outDir}（4s 周期，alpha 0.72→1.0）`)
} else {
  const p = join(RES, 'tray.png')
  writeFileSync(p, encodePng(SIZE, SIZE, drawBolt(SIZE)))
  console.log(`[generate-tray] wrote tray.png（${SIZE}x${SIZE} 黑色闪电模板图）`)
}
