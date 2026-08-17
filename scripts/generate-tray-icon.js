#!/usr/bin/env node
/**
 * 生成彩色桌宠托盘图标（pichu 头像）。
 *
 * 背景：原 trayTemplate.png 是 generate-icons.js 画的「黑色实心圆」模板图
 * （macOS Template = 纯黑+alpha，系统自动反色），菜单栏上就是个黑点；且单张
 * 44px PNG 传给 Tray 会被 macOS 当作 44pt 渲染（菜单栏仅 22pt 高）导致溢出。
 *
 * 本脚本从应用彩色图标 icon.png（512x512，pichu 渲染产物）解码 → 居中裁剪
 * 内容区域（icon.png 中 pichu 偏左下，contentBox 校正）→ 双线性缩放输出
 * @1x(22x22) + @2x(44x44) 双尺寸（22pt 显示 + Retina 清晰），彩色非 template。
 *
 * 用法：
 *   node scripts/generate-tray-icon.js                       # 单图标 → resources/tray.png + tray@2x.png
 *   node scripts/generate-tray-icon.js --frames-dir=<dir>    # 动画帧：读 dir/frame-0..N.png
 *                                                           # （PET_TRAY_ANIM=<dir> 生成）→ 统一第一帧
 *                                                           # contentBox 防帧间跳动 → resources/tray-anim/
 *
 * 无外部依赖：Node 内置 zlib + 手写 PNG 解码/编码（与 generate-icons.js 同风格）。
 */
'use strict'

const { deflateSync, inflateSync } = require('node:zlib')
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const RES = join(ROOT, 'apps', 'desktop', 'resources')
const ICON_PNG = join(RES, 'icon.png')
const SIZE1X = 16 // macOS 菜单栏图标标准尺寸（16pt；22pt 会顶满 22pt 高的任务栏，视觉过大）
const SIZE2X = 32 // @2x Retina 清晰

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

// ---------- 内容边界（非透明区域，含 padding，正方形） ----------
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
  let side = Math.max(cw, ch)
  side = Math.round(side * 1.16) // 16% padding：pichu 完整可见且不贴图标边缘
  side = Math.min(side, w, h) // 绝不超帧尺寸（图标模式下模型可能占满帧，padding 自动收缩）
  if (side < 1) side = 1
  const cx = minX + cw / 2
  const cy = minY + ch / 2
  let x0 = Math.round(cx - side / 2)
  let y0 = Math.round(cy - side / 2)
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

// ---------- 输出：裁剪 box → 缩放 @1x/@2x 双尺寸写盘 ----------
function writeTray(outPath, rgba, sw, sh, box) {
  const side = box.side
  const crop = Buffer.alloc(side * side * 4)
  for (let y = 0; y < side; y++) {
    rgba.copy(crop, y * side * 4, ((box.y0 + y) * sw + box.x0) * 4, ((box.y0 + y) * sw + box.x0 + side) * 4)
  }
  writeFileSync(outPath, encodePng(SIZE1X, SIZE1X, resizeBilinear(crop, side, side, SIZE1X, SIZE1X)))
  const retina = outPath.replace(/\.png$/i, '@2x.png')
  writeFileSync(retina, encodePng(SIZE2X, SIZE2X, resizeBilinear(crop, side, side, SIZE2X, SIZE2X)))
  return readFileSync(outPath).length + readFileSync(retina).length
}

// ---------- 主流程 ----------
const args = process.argv.slice(2)
const framesArg = args.find((a) => a.startsWith('--frames-dir='))

if (framesArg) {
  // 动画帧模式：读 dir/frame-0..N.png（PET_TRAY_ANIM 连拍产物），统一第一帧 contentBox 防帧间跳动
  const dir = framesArg.split('=')[1]
  const srcs = []
  for (let i = 0; ; i++) {
    const p = join(dir, `frame-${i}.png`)
    if (!existsSync(p)) break
    srcs.push({ img: decodePng(readFileSync(p)) })
  }
  if (srcs.length < 2) {
    console.error(`[generate-tray] 帧不足：${dir}（需要 frame-0..N.png，≥2 帧）`)
    process.exit(1)
  }
  const box = contentBox(srcs[0].img.w, srcs[0].img.h, srcs[0].img.rgba)
  const outDir = join(RES, 'tray-anim')
  mkdirSync(outDir, { recursive: true })
  console.log(`[generate-tray] 动画 ${srcs.length} 帧，统一裁剪区域 x${box.x0} y${box.y0} ${box.side}x${box.side}`)
  srcs.forEach((s, i) => {
    const bytes = writeTray(join(outDir, `frame-${i}.png`), s.img.rgba, s.img.w, s.img.h, box)
    console.log(`[generate-tray]   frame-${i}.png + @2x（${bytes} bytes）`)
  })
  console.log(`[generate-tray] 托盘动画帧已写入 ${outDir}`)
} else {
  // 单图标模式：icon.png → tray.png + tray@2x.png
  const src = decodePng(readFileSync(ICON_PNG))
  const box = contentBox(src.w, src.h, src.rgba)
  console.log(`[generate-tray] icon.png ${src.w}x${src.h}，内容居中裁剪区域 x${box.x0} y${box.y0} ${box.side}x${box.side}`)
  const bytes = writeTray(join(RES, 'tray.png'), src.rgba, src.w, src.h, box)
  console.log(`[generate-tray] wrote tray.png(${SIZE1X}x${SIZE1X}) + tray@2x.png(${SIZE2X}x${SIZE2X})（${bytes} bytes）`)
}
