#!/usr/bin/env node
/**
 * 生成桌宠托盘图标（macOS Template 风格：纯黑 + alpha 通道）。
 * 无外部依赖：Node 内置 zlib + 手写 PNG chunk（CRC32）。
 * 输出：apps/desktop/resources/trayTemplate.png（32x32）
 */
'use strict'

const { deflateSync } = require('node:zlib')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const OUT_DIR = join(__dirname, '..', 'apps', 'desktop', 'resources')
const SIZE = 32

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ---------- PNG 组装 ----------
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba /* Buffer */) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // 每行前加 filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw, { level: 9 })

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- 绘制：黑色实心圆（居中，半径 12，边缘 2px 抗锯齿） ----------
function drawCircle(size) {
  const buf = Buffer.alloc(size * size * 4)
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2
  const r = size * 0.375
  const aa = 1.5 // 抗锯齿带宽（像素）

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - cx, y - cy)
      let alpha = 0
      if (dist <= r - aa) alpha = 1
      else if (dist <= r) alpha = (r - dist) / aa
      const i = (y * size + x) * 4
      // Template 图标：黑色主体 + alpha（系统按 alpha 着色）
      buf[i] = 0
      buf[i + 1] = 0
      buf[i + 2] = 0
      buf[i + 3] = Math.round(alpha * 255)
    }
  }
  return buf
}

mkdirSync(OUT_DIR, { recursive: true })
const png = encodePng(SIZE, SIZE, drawCircle(SIZE))
writeFileSync(join(OUT_DIR, 'trayTemplate.png'), png)
console.log(`[generate-icons] wrote ${join(OUT_DIR, 'trayTemplate.png')} (${png.length} bytes)`)
