/**
 * 日程管理 / 提醒服务（MVP，方案见 docs/report-new-features.md §2）。
 *
 * - 存储：JSON 文件 `userData/calendar.json`，原子写（tmp + rename，仿 JsonStore/clipboard.service）。
 * - 调度：复用统一调度器 SchedulerService —— 每个"即将到期"的事件注册一个一次性 Job
 *   （id=`calendar:evt:<eventId>`，fireAt = startAt - remindBeforeMs），到点发系统通知。
 * - 重复规则：none/daily/weekly/monthly 在每次触发后自动重排下一次 occurrence（触发式展开）。
 * - 丢失补偿：App 关闭期间错过的提醒，若仍在宽限期（15 分钟）内，启动时立即补发一次。
 * - 重启恢复：启动时 init() 从事件表重建 Job（调度器快照虽持久化，但事件表需自行重建）。
 */
import { app, BrowserWindow, Notification } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SchedulerService } from './scheduler.service';

export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly';

/** 日历事件（持久化结构） */
export interface CalendarEvent {
  id: string;
  title: string;
  startAt: number;
  endAt?: number;
  allDay?: boolean;
  repeatRule?: RepeatRule;
  notes?: string;
  remindBeforeMs?: number;
  /** 一次性事件：是否已提醒 */
  reminded?: boolean;
  /** 重复事件：最近一次已提醒的 occurrence 的 startAt */
  lastFiredStartAt?: number;
}

/** 面板展示视图（追加提醒状态） */
export interface CalendarEventView extends CalendarEvent {
  reminded: boolean;
  /** 下一个待提醒的 occurrence startAt（无可排则为 null） */
  nextStartAt: number | null;
}

/** 新增事件的入参（无 id，由服务生成） */
export type CalendarEventInput = Omit<CalendarEvent, 'id'>;

/** 错过提醒的宽限期（App 关闭期间错过的，此窗口内启动时补发一次） */
const GRACE_MS = 15 * 60_000;
/** 存储文件名（userData 下） */
const FILE = 'calendar.json';
/** Job id 前缀（全局唯一：calendar:evt:<eventId>） */
export const CAL_JOB_PREFIX = 'calendar:evt:';
/** Job type（调度分发用） */
export const CAL_JOB_TYPE = 'calendar:reminder';

/** 重复规则有效性校验 */
function isValidRepeat(v: unknown): v is RepeatRule {
  return v === 'none' || v === 'daily' || v === 'weekly' || v === 'monthly';
}

/** 计算某事件在 after 之后的下一个 occurrence startAt（none 则只有 startAt 本身） */
function nextOccurrenceAfter(evt: CalendarEvent, after: number): number | null {
  const rule = evt.repeatRule ?? 'none';
  if (rule === 'none') {
    return evt.startAt > after ? evt.startAt : null;
  }
  const d = new Date(evt.startAt);
  let occ = evt.startAt;
  while (occ <= after) {
    if (rule === 'daily') d.setDate(d.getDate() + 1);
    else if (rule === 'weekly') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1); // monthly：跨月溢出由 Date 处理（月末进位，MVP 可接受）
    occ = d.getTime();
    // 防御：极端循环保护（不可能走到，但避免死循环）
    if (!Number.isFinite(occ) || occ - evt.startAt > 366 * 86400_000 * 10) return null;
  }
  return occ;
}

export class CalendarService {
  private readonly file: string;
  private events: CalendarEvent[] = [];
  /** 本服务在调度器中注册过的 Job id 集合（用于重建时清理） */
  private readonly jobIds = new Set<string>();

  /** 通知回调钩子（PET_CAL_TEST 用计数验证；正常路径也走系统通知） */
  onNotify: ((title: string, body: string) => void) | null = null;

  constructor(private readonly schedulerService: SchedulerService) {
    const dir = appDataDir();
    this.file = join(dir, FILE);
    this.load();
  }

  // ---------- 存储 ----------

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as { events?: CalendarEvent[] };
      if (Array.isArray(parsed.events)) this.events = parsed.events;
    } catch (err) {
      console.error('[calendar] 读取事件失败，使用空列表:', err);
    }
  }

  /** 原子写盘（tmp + rename） */
  private persist(): void {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ events: this.events }, null, 2), 'utf8');
      renameSync(tmp, this.file);
    } catch (err) {
      console.error('[calendar] 写入事件失败:', err);
    }
  }

  /** 存储文件路径（供调试/验证） */
  get path(): string {
    return this.file;
  }

  // ---------- 调度（复用统一调度器） ----------

  /**
   * 启动时重建 Job：清空本服务注册过的所有 Job，再按事件表重新注册
   * （必须在 schedulerService.start() 恢复快照之后调用，见 index.ts bootstrap）。
   */
  init(): void {
    this.rebuildJobs();
  }

  /** 全量重排：清掉本服务已知 Job id → 为每个事件注册下一个待提醒 Job */
  private rebuildJobs(): void {
    for (const id of this.jobIds) this.schedulerService.removeJob(id);
    this.jobIds.clear();
    for (const evt of this.events) this.scheduleEvent(evt);
  }

  /** 为单个事件注册"下一个待提醒 occurrence"的 Job；无则跳过 */
  private scheduleEvent(evt: CalendarEvent): void {
    const rule = evt.repeatRule ?? 'none';
    const after = rule === 'none' ? (evt.reminded ? evt.startAt : 0) : (evt.lastFiredStartAt ?? 0);
    const next = this.findNextSchedulable(evt, after);
    if (!next) return;
    const id = CAL_JOB_PREFIX + evt.id;
    // 先移除再注册（幂等 upsert）：既能覆盖"调度器快照恢复出的同名旧 Job"（重启重建场景），
    // 也能在 handleFire 重排时安全复用同一 id（core addJob 对重复 id 会抛错）。
    this.schedulerService.removeJob(id);
    this.schedulerService.addJob({
      id,
      type: CAL_JOB_TYPE,
      fireAt: next.fireAt,
      payload: { eventId: evt.id, occurrenceStartAt: next.occ }
    });
    this.jobIds.add(id);
  }

  /**
   * 从 from 之后找第一个"仍应提醒"的 occurrence。
   * - 提醒时刻未到 → 按 fireAt = occ - remindBeforeMs 注册；
   * - 提醒时刻已过但仍在宽限期内 → 立即触发（fireAt = now，丢失补偿）；
   * - 超出宽限期 → 跳过该 occurrence（一次性则返回 null；重复则看下一个）。
   */
  private findNextSchedulable(
    evt: CalendarEvent,
    from: number
  ): { occ: number; fireAt: number } | null {
    const rule = evt.repeatRule ?? 'none';
    let occ = nextOccurrenceAfter(evt, from);
    const now = Date.now();
    while (occ !== null) {
      const remindBefore = Math.max(0, evt.remindBeforeMs ?? 0);
      let fireAt = occ - remindBefore;
      if (fireAt <= now) {
        if (now - fireAt > GRACE_MS) {
          if (rule === 'none') return null;
          occ = nextOccurrenceAfter(evt, occ); // 跳过这次，看下一个 occurrence
          continue;
        }
        fireAt = now; // 宽限期内 → 立即补发
      }
      return { occ, fireAt };
    }
    return null;
  }

  /** 调度器到点回调（由 index.ts 的 onFire 分发器调用） */
  handleFire(job: { payload?: unknown }): void {
    const p = (job.payload ?? {}) as { eventId?: string; occurrenceStartAt?: number };
    const evt = this.events.find((e) => e.id === p.eventId);
    if (!evt) return;
    const rule = evt.repeatRule ?? 'none';
    const occ = typeof p.occurrenceStartAt === 'number' ? p.occurrenceStartAt : evt.startAt;
    if (rule === 'none') evt.reminded = true;
    else evt.lastFiredStartAt = occ;
    this.persist();

    // 系统通知（沙盒/无通知中心环境可能失败，try/catch 兜底；回调钩子照常触发供测试）
    this.notify(`📅 ${evt.title}`, buildReminderBody(evt, occ));

    // 重复事件：触发后重排下一次 occurrence
    if (rule !== 'none') {
      const next = this.findNextSchedulable(evt, occ);
      this.schedulerService.removeJob(CAL_JOB_PREFIX + evt.id);
      this.jobIds.delete(CAL_JOB_PREFIX + evt.id);
      if (next) this.scheduleEvent(evt);
    }
    this.broadcastChanged();
  }

  private notify(title: string, body: string): void {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    } catch (err) {
      console.error('[calendar] 系统通知失败:', err instanceof Error ? err.message : String(err));
    }
    this.onNotify?.(title, body);
  }

  /** 广播事件表变化（面板订阅后自动刷新） */
  private broadcastChanged(): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('pet:calendar:changed');
    }
  }

  // ---------- CRUD ----------

  /** 事件列表（面板视图，按下一个提醒时间排序） */
  list(): CalendarEventView[] {
    return [...this.events]
      .map((e) => this.toView(e))
      .sort((a, b) => (a.nextStartAt ?? a.startAt) - (b.nextStartAt ?? b.startAt));
  }

  private toView(evt: CalendarEvent): CalendarEventView {
    const rule = evt.repeatRule ?? 'none';
    if (rule === 'none') {
      const reminded = !!evt.reminded;
      return { ...evt, reminded, nextStartAt: reminded ? null : evt.startAt };
    }
    const reminded = evt.lastFiredStartAt != null;
    return { ...evt, reminded, nextStartAt: nextOccurrenceAfter(evt, evt.lastFiredStartAt ?? 0) };
  }

  /** 添加事件（校验 + 落盘 + 重排调度器） */
  add(input: CalendarEventInput): CalendarEventView | { error: string } {
    const title = String(input.title ?? '').trim();
    const startAt = Number(input.startAt);
    if (!title) return { error: '标题不能为空' };
    if (!Number.isFinite(startAt)) return { error: '开始时间无效' };
    const evt: CalendarEvent = {
      id: randomUUID(),
      title,
      startAt,
      endAt: Number.isFinite(Number(input.endAt)) ? Number(input.endAt) : undefined,
      allDay: Boolean(input.allDay),
      repeatRule: isValidRepeat(input.repeatRule) ? input.repeatRule : 'none',
      notes: input.notes ? String(input.notes).slice(0, 500) : undefined,
      remindBeforeMs: Math.max(0, Number(input.remindBeforeMs) || 0)
    };
    this.events.push(evt);
    this.persist();
    this.rebuildJobs();
    this.broadcastChanged();
    return this.toView(evt);
  }

  /** 删除事件（落盘 + 重排调度器） */
  remove(id: string): boolean {
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    this.events.splice(idx, 1);
    this.persist();
    this.rebuildJobs();
    this.broadcastChanged();
    return true;
  }

  /** 清空全部事件（落盘 + 重排调度器） */
  clear(): boolean {
    this.events = [];
    this.persist();
    this.rebuildJobs();
    this.broadcastChanged();
    return true;
  }
}

/** userData 目录（构造时确保存在） */
function appDataDir(): string {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 提醒通知正文 */
function buildReminderBody(evt: CalendarEvent, occ: number): string {
  const time = new Date(occ).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const rule = evt.repeatRule ?? 'none';
  const repeatLabel = rule === 'none' ? '' : rule === 'daily' ? '（每天）' : rule === 'weekly' ? '（每周）' : '（每月）';
  const notes = evt.notes ? `\n${evt.notes}` : '';
  return `${time}${repeatLabel}${notes}`;
}
