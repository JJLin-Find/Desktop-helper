/**
 * 剪贴板历史服务（MVP 简化实现，方案见 docs/report-clipboard-history.md §8）。
 *
 * - 存储：JSON 文件 `userData/clipboard-history.json`，原子写（tmp + rename，仿 JsonStore）。
 *   刻意不用 better-sqlite3（避免原生编译），MVP 数据量（≤500 条）完全够用。
 * - 去重：SHA-256 内容哈希，同内容只更新时间戳，不新增条目。
 * - 容量：上限 MAX_ITEMS=500 条，pinned 条目永不淘汰。
 * - 图片：PNG 存 `userData/clipboard-images/<hash>.png`，条目只记路径。
 * - 监听：内容比对轮询（0.5s）。**常驻监听默认关**（macOS 26 剪贴板隐私：无用户交互读剪贴板会触发系统警告），
 *   默认策略是「打开面板时同步一次」；用户显式打开常驻开关后才开始轮询（见 setConstantMode）。
 */
import { app, clipboard, nativeImage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 剪贴板历史条目（与 preload 共享类型；字段对应需求：id/kind/text/imagePath/hash/copiedAt/isPinned） */
export interface ClipboardHistoryItem {
  id: string;
  kind: 'text' | 'image';
  text?: string;
  imagePath?: string;
  hash: string;
  copiedAt: number;
  isPinned: boolean;
}

/** 监听/同步时从系统剪贴板捕获的原始内容（未入库） */
interface CapturedItem {
  kind: 'text' | 'image';
  text?: string;
  imagePath?: string;
  hash: string;
}

/** 轮询间隔（业界事实标准 0.5s，见调研报告 §1.2） */
const POLL_INTERVAL_MS = 500;
/** 历史上限（不含 pinned） */
const MAX_ITEMS = 500;
/** 图片目录名（userData 下） */
const IMAGE_DIR = 'clipboard-images';

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export class ClipboardHistoryService {
  private readonly file: string;
  private readonly imageDir: string;
  private items: ClipboardHistoryItem[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** 常驻监听开关（默认关；macOS 26 隐私策略：交互时同步为主） */
  private constantMode = false;
  /** 上次轮询快照（内容比对） */
  private lastSnapshot = { text: '', hasImage: false };

  constructor() {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'clipboard-history.json');
    this.imageDir = join(dir, IMAGE_DIR);
    mkdirSync(this.imageDir, { recursive: true });
    this.load();
  }

  // ---------- 存储 ----------

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as { items?: ClipboardHistoryItem[] };
      if (Array.isArray(parsed.items)) this.items = parsed.items;
    } catch (err) {
      console.error('[clipboard] 读取历史失败，使用空历史:', err);
    }
  }

  /** 原子写盘（tmp + rename） */
  private persist(): void {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ items: this.items }, null, 2), 'utf8');
      renameSync(tmp, this.file);
    } catch (err) {
      console.error('[clipboard] 写入历史失败:', err);
    }
  }

  /** 存储文件路径（供调试/验证） */
  get path(): string {
    return this.file;
  }

  get imageDirPath(): string {
    return this.imageDir;
  }

  // ---------- 读取剪贴板 ----------

  /** 探测当前剪贴板：文本 + 是否有图片（内容比对轮询的快照值） */
  private detect(): { text: string; hasImage: boolean } {
    let text = '';
    let hasImage = false;
    try {
      text = clipboard.readText() ?? '';
      const formats = clipboard.availableFormats();
      hasImage =
        formats.some((f) => /image|png|tiff|jpeg|jpg|bmp|gif/i.test(f)) &&
        !clipboard.readImage().isEmpty();
    } catch (err) {
      // 读取失败（如其他 app 正在写剪贴板）→ 按无变化处理
      console.error('[clipboard] 读取剪贴板失败:', err);
    }
    return { text, hasImage };
  }

  /** 根据探测结果捕获内容（图片落盘；文本优先——MVP 以文本为主） */
  private capture(d: { text: string; hasImage: boolean }): CapturedItem | null {
    if (d.text.trim()) {
      return { kind: 'text', text: d.text, hash: sha256(d.text) };
    }
    if (d.hasImage) {
      try {
        const img = clipboard.readImage();
        if (!img.isEmpty()) {
          const png = img.toPNG();
          const hash = sha256(png);
          const imagePath = join(this.imageDir, `${hash}.png`);
          if (!existsSync(imagePath)) {
            try {
              writeFileSync(imagePath, png);
            } catch (err) {
              console.error('[clipboard] 保存图片失败:', err);
            }
          }
          return { kind: 'image', imagePath, hash };
        }
      } catch (err) {
        console.error('[clipboard] 读取剪贴板图片失败:', err);
      }
    }
    return null;
  }

  // ---------- 入库 ----------

  private add(c: CapturedItem): ClipboardHistoryItem {
    const now = Date.now();
    // SHA-256 去重：同内容只更新时间戳
    const existing = this.items.find((i) => i.hash === c.hash);
    if (existing) {
      existing.copiedAt = now;
      this.persist();
      return existing;
    }
    const item: ClipboardHistoryItem = {
      id: randomUUID(),
      kind: c.kind,
      hash: c.hash,
      copiedAt: now,
      isPinned: false
    };
    if (c.kind === 'text') item.text = c.text;
    else item.imagePath = c.imagePath;
    this.items.push(item);
    this.trim();
    this.persist();
    return item;
  }

  /** 容量裁剪：超过上限淘汰最旧的未固定条目（pinned 永不淘汰） */
  private trim(): void {
    if (this.items.length <= MAX_ITEMS) return;
    const pinned = this.items.filter((i) => i.isPinned);
    const unpinned = this.items
      .filter((i) => !i.isPinned)
      .sort((a, b) => b.copiedAt - a.copiedAt);
    const keep = unpinned.slice(0, Math.max(0, MAX_ITEMS - pinned.length));
    const removed = unpinned.slice(keep.length);
    for (const r of removed) this.deleteImageFile(r);
    this.items = [...pinned, ...keep];
  }

  private deleteImageFile(item: ClipboardHistoryItem): void {
    if (item.kind === 'image' && item.imagePath) {
      try {
        rmSync(item.imagePath, { force: true });
      } catch {
        /* 忽略删除失败 */
      }
    }
  }

  // ---------- 对外 API ----------

  /** 立即同步当前剪贴板入库（交互时同步：面板打开/用户在场时调用） */
  syncNow(): ClipboardHistoryItem | null {
    const d = this.detect();
    this.lastSnapshot = d;
    const captured = this.capture(d);
    return captured ? this.add(captured) : null;
  }

  /** 全量列表（固定置顶，其余按时间倒序） */
  list(): ClipboardHistoryItem[] {
    return [...this.items].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return b.copiedAt - a.copiedAt;
    });
  }

  /** 按关键字搜索（文本大小写不敏感子串匹配；图片条目按文件名 hash 也参与，便于兜底） */
  search(keyword: string): ClipboardHistoryItem[] {
    const kw = String(keyword ?? '').trim().toLowerCase();
    if (!kw) return this.list();
    return this.list().filter((i) => {
      if (i.kind === 'text' && i.text) return i.text.toLowerCase().includes(kw);
      if (i.kind === 'image' && i.imagePath) return i.imagePath.toLowerCase().includes(kw);
      return false;
    });
  }

  /** 固定/取消固定（toggle），返回新状态 */
  pin(id: string): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    item.isPinned = !item.isPinned;
    this.persist();
    return item.isPinned;
  }

  /** 删除条目（顺带清理图片文件） */
  remove(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0) return false;
    const [removed] = this.items.splice(idx, 1);
    if (removed) this.deleteImageFile(removed);
    this.persist();
    return true;
  }

  /** 写回系统剪贴板（方案 A：写回后由用户 Cmd+V，零权限零风险，见调研报告 §5.3） */
  paste(id: string): { ok: boolean; error?: string } {
    const item = this.items.find((i) => i.id === id);
    if (!item) return { ok: false, error: '条目不存在' };
    try {
      if (item.kind === 'image' && item.imagePath) {
        if (!existsSync(item.imagePath)) return { ok: false, error: '图片文件已不存在' };
        const img = nativeImage.createFromPath(item.imagePath);
        if (img.isEmpty()) return { ok: false, error: '图片读取失败' };
        clipboard.writeImage(img);
        return { ok: true };
      }
      if (item.text !== undefined) {
        clipboard.writeText(item.text);
        return { ok: true };
      }
      return { ok: false, error: '条目无内容' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 常驻监听开关（默认关）。开：内容比对轮询 0.5s；关：停止轮询。 */
  setConstantMode(on: boolean): boolean {
    this.constantMode = Boolean(on);
    if (this.constantMode) {
      if (!this.timer) {
        // 先对齐当前快照，避免启动瞬间把已存在内容当"新变化"重复入库（去重兜底）
        this.lastSnapshot = this.detect();
        this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
      }
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.constantMode;
  }

  get isConstantMode(): boolean {
    return this.constantMode;
  }

  /** 停止监听（应用退出时调用） */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---------- 轮询 ----------

  private tick(): void {
    const d = this.detect();
    if (d.text === this.lastSnapshot.text && d.hasImage === this.lastSnapshot.hasImage) return;
    this.lastSnapshot = d;
    const captured = this.capture(d);
    if (captured) this.add(captured);
  }
}
