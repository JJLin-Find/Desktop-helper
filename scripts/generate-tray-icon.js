#!/usr/bin/env node
/**
 * 生成彩色桌宠托盘图标（tray.png，44x44 = 22pt @2x，Retina 菜单栏清晰）。
 *
 * 背景：原 trayTemplate.png 是 generate-icons.js 画的「黑色实心圆」模板图
 * （macOS Template = 纯黑+alpha，系统自动反色），菜单栏上就是个黑点。
 * 本脚本从应用彩色图标 icon.png（512x512，pichu 渲染产物）解码 → 居中裁剪
 * 内容区域（icon.png 中 pichu 偏左下）→ 双线性缩放到 44x44 → 输出彩色 PNG。
 * 彩色非 template：浅色/深色菜单栏均可见（pichu 黄+黑描边）。
 *
 * 用法：node scripts/generate-tray-icon.js
 * 依赖：apps/desktop/resources/icon.png 存在（仓库已含）。
 * 无外部依赖：Node 内置 zlib + 手写 PNG 解码/编码（与 generate-icons.js 同风格）。
 */
'use strict'

const { deflateSync, inflateSync } = require('node:zlib')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const ICON_PNG = join(ROOT, 'apps', 'desktop', 'resources', 'icon.png')
const OUT_PNG = join(ROOT, 'apps', 'desktop', 'resources', 'tray.png')
const TARGET = 44 // 22pt @2x

// ---------- PNG 解码（RGBA） ----------
function decodePng(buf) {
  let off = 8
  let w = 0, h = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    off += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`不支持的 PNG 格式: colorType=${colorType} bitDepth=${bitDepth}`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const stride = w * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = row[x]
      if (f === 1) v = (v + a) & 0xff
      else if (f === 2) v = (v + b) & 0xff
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      out[y * stride + x] = v
    }
  }
  return { w, h, rgba: out, hasAlpha: colorType === 6 }
}

// ---------- 内容边界（非透明区域，含 padding） ----------
function contentBox(w, h, rgba) {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = rgba[(y * w + x) * 4 + 3]
      if (a > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const cw = maxX - minX + 1
  const ch = maxY - minY + 1
  // 取正方形：边长 = max(宽,高) + 12% padding
  let side = Math.max(cw, ch)
  side = Math.round(side * 1.12)
  const cx = minX + cw / 2
  const cy = minY + ch / 2
  let x0 = Math.round(cx - side / 2)
  let y0 = Math.round(cy - side / 2)
  // clamp 到画布
  x0 = Math.max(0, Math.min(x0, w - side))
  y0 = Math.max(0, Math.min(y0, h - side))
  return { x0, y0, side }
}

// ---------- 双线性缩放 ----------
function resizeBilinear(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4)
  const sx = sw / dw
  const sy = sh / dh
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * sy - 0.5
    const y0 = Math.max(0, Math.floor(fy))
    const y1 = Math.min(sh - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < dw; x++) {
      const fx = (x + 0.5) * sx - 0.5
      const x0 = Math.max(0, Math.floor(fx))
      const x1 = Math.min(sw - 1, x0 + 1)
      const wx = fx - x0
      const oi = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) {
        const v00 = src[(y0 * sw + x0) * 4 + c]
        const v01 = src[(y0 * sw + x1) * 4 + c]
        const v10 = src[(y1 * sw + x0) * 4 + c]
        const v11 = src[(y1 * sw + x1) * 4 + c]
        const top = v00 * (1 - wx) + v01 * wx
        const bot = v10 * (1 - wx) + v11 * wx
        out[oi + c] = Math.round(top * (1 - wy) + bot * wy)
      }
    }
  }
  return out
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
const src = decodePng(readFileSync(ICON_PNG))
const { x0, y0, side } = contentBox(src.w, src.h, src.rgba)
console.log(`[generate-tray] icon.png ${src.w}x${src.h}，内容居中裁剪区域 x${x0} y${y0} ${side}x${side}`)

// 裁剪到方形
const crop = Buffer.alloc(side * side * 4)
for (let y = 0; y < side; y++) {
  src.rgba.copy(crop, y * side * 4, ((y0 + y) * src.w + x0) * 4, ((y0 + y) * src.w + x0 + side) * 4)
}

const tray = resizeBilinear(crop, side, side, TARGET, TARGET)
writeFileSync(OUT_PNG, encodePng(TARGET, TARGET, tray))
console.log(`[generate-tray] wrote ${OUT_PNG} (${TARGET}x${TARGET}, ${readFileSync(OUT_PNG).length} bytes)`)
