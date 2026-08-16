/**
 * 番茄钟 / 倒计时服务（MVP，方案见 docs/report-new-features.md §3）。
 *
 * - 调度：复用统一调度器 SchedulerService —— 一个 Job（id=`pomodoro:phase`，一次性），
 *   fireAt = now + minutes*60000，杜绝 setTimeout 漂移；
 * - 到点：发系统通知 + 自动切下一阶段（focus→break→focus…），直至手动 stop；
 * - 统计：专注完成的分钟数记入 `userData/pomodoro.json` 的 sessions（按日期合并）；
 * - 重启恢复：init() 时若上次会话仍在进行（endAt 未到）则重新注册 Job；
 *   若已超时（App 关闭期间走完），按"时间已流逝"记录一次 focus 会话并回到 idle。
 */
import { app, BrowserWindow, Notification } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SchedulerService } from './scheduler.service';

export type PomodoroPhase = 'idle' | 'focus' | 'break';

/** 番茄钟状态（持久化结构） */
export interface PomodoroState {
  phase: PomodoroPhase;
  /** 当前阶段结束时刻（epoch ms；idle 时为 null） */
  endAt: number | null;
  focusMinutes: number;
  breakMinutes: number;
}

/** 专注会话记录（按日期聚合） */
export interface PomodoroSession {
  date: string; // YYYY-MM-DD（本地时区）
  minutes: number;
}

/** 对外状态查询结果 */
export interface PomodoroStatus {
  phase: PomodoroPhase;
  endAt: number | null;
  remainingMs: number;
  focusMinutes: number;
  breakMinutes: number;
}

interface PomodoroFile {
  state: PomodoroState;
  sessions: PomodoroSession[];
}

const FILE = 'pomodoro.json';
/** Job id（全局唯一） */
export const POMO_JOB_ID = 'pomodoro:phase';
/** Job type（调度分发用） */
export const POMO_JOB_TYPE = 'pomodoro:phase';

const DEFAULT_STATE: PomodoroState = {
  phase: 'idle',
  endAt: null,
  focusMinutes: 25,
  breakMinutes: 5
};

export class PomodoroService {
  private readonly file: string;
  private state: PomodoroState;
  private sessions: PomodoroSession[] = [];

  /** 通知回调钩子（PET_CAL_TEST 用计数验证；正常路径也走系统通知） */
  onNotify: ((title: string, body: string) => void) | null = null;

  constructor(private readonly schedulerService: SchedulerService) {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, FILE);
    this.state = { ...DEFAULT_STATE };
    this.load();
  }

  // ---------- 存储 ----------

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<PomodoroFile>;
      if (parsed.state && (parsed.state.phase === 'idle' || parsed.state.phase === 'focus' || parsed.state.phase === 'break')) {
        this.state = {
          focusMinutes: Number(parsed.state.focusMinutes) > 0 ? Number(parsed.state.focusMinutes) : 25,
          breakMinutes: Number(parsed.state.breakMinutes) > 0 ? Number(parsed.state.breakMinutes) : 5,
          phase: parsed.state.phase,
          endAt: typeof parsed.state.endAt === 'number' ? parsed.state.endAt : null
        };
      }
      if (Array.isArray(parsed.sessions)) this.sessions = parsed.sessions;
    } catch (err) {
      console.error('[pomodoro] 读取状态失败，使用默认值:', err);
    }
  }

  /** 原子写盘（tmp + rename） */
  private persist(): void {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ state: this.state, sessions: this.sessions }, null, 2), 'utf8');
      renameSync(tmp, this.file);
    } catch (err) {
      console.error('[pomodoro] 写入状态失败:', err);
    }
  }

  /** 存储文件路径（供调试/验证） */
  get path(): string {
    return this.file;
  }

  // ---------- 调度（复用统一调度器） ----------

  /**
   * 启动时恢复：上次会话若仍在进行（endAt 未到）→ 重新注册 Job；
   * 若已超时（App 关闭期间走完）→ focus 记录一次会话，回到 idle。
   * 必须在 schedulerService.start() 恢复快照之后调用（index.ts bootstrap）。
   */
  init(): void {
    this.schedulerService.removeJob(POMO_JOB_ID);
    if (this.state.phase === 'idle' || this.state.endAt === null) return;
    if (this.state.endAt > Date.now()) {
      this.scheduleJob(
        this.state.phase,
        this.state.endAt,
        this.state.phase === 'focus' ? this.state.focusMinutes : this.state.breakMinutes
      );
      this.broadcastChanged();
    } else {
      if (this.state.phase === 'focus') {
        this.recordSession(this.state.focusMinutes);
      }
      this.state = { ...DEFAULT_STATE, focusMinutes: this.state.focusMinutes, breakMinutes: this.state.breakMinutes };
      this.persist();
      this.broadcastChanged();
    }
  }

  /** 注册/更新番茄钟 Job（先移除旧的，避免 id 冲突；一次性，到点后调度器自动删除） */
  private scheduleJob(phase: PomodoroPhase, endAt: number, minutes: number): void {
    this.schedulerService.removeJob(POMO_JOB_ID);
    this.schedulerService.addJob({
      id: POMO_JOB_ID,
      type: POMO_JOB_TYPE,
      fireAt: endAt,
      payload: { phase, minutes }
    });
  }

  /** 调度器到点回调（由 index.ts 的 onFire 分发器调用）：通知 + 自动切下一阶段 */
  handleFire(job: { payload?: unknown }): void {
    const p = (job.payload ?? {}) as { phase?: PomodoroPhase; minutes?: number };
    const finished = p.phase === 'focus' ? 'focus' : 'break';
    if (finished === 'focus') {
      // 记录专注完成的分钟数（以本阶段实际时长计：支持 start(phase, minutes) 覆盖值）
      this.recordSession(Number.isFinite(Number(p.minutes)) && Number(p.minutes) > 0 ? Number(p.minutes) : this.state.focusMinutes);
      this.notify('🍅 专注结束', '干得漂亮！休息一下吧 ☕');
    } else {
      this.notify('☕ 休息结束', '满血复活，开始下一轮专注吧 🍅');
    }
    // 自动切下一阶段（focus→break→focus…），直到手动 stop
    const next = finished === 'focus' ? 'break' : 'focus';
    const minutes = next === 'focus' ? this.state.focusMinutes : this.state.breakMinutes;
    const endAt = Date.now() + minutes * 60_000;
    this.state.phase = next;
    this.state.endAt = endAt;
    this.persist();
    this.scheduleJob(next, endAt, minutes);
    this.broadcastChanged();
  }

  // ---------- 对外 API ----------

  /**
   * 开始某一阶段。minutes 可选：覆盖本次时长（分钟，支持小数），不改变持久化默认值；
   * 不传则用当前默认值（focusMinutes/breakMinutes）。
   */
  start(phase: PomodoroPhase, minutes?: number): PomodoroStatus {
    if (phase !== 'focus' && phase !== 'break') return this.status();
    const m = Number(minutes);
    const useMinutes = Number.isFinite(m) && m > 0 ? m : phase === 'focus' ? this.state.focusMinutes : this.state.breakMinutes;
    const endAt = Date.now() + useMinutes * 60_000;
    this.state.phase = phase;
    this.state.endAt = endAt;
    this.persist();
    this.scheduleJob(phase, endAt, useMinutes);
    this.broadcastChanged();
    return this.status();
  }

  /** 停止：取消 Job，回到 idle */
  stop(): PomodoroStatus {
    this.schedulerService.removeJob(POMO_JOB_ID);
    this.state.phase = 'idle';
    this.state.endAt = null;
    this.persist();
    this.broadcastChanged();
    return this.status();
  }

  /** 状态查询（含剩余毫秒） */
  status(): PomodoroStatus {
    const remainingMs =
      this.state.phase !== 'idle' && this.state.endAt !== null
        ? Math.max(0, this.state.endAt - Date.now())
        : 0;
    return {
      phase: this.state.phase,
      endAt: this.state.endAt,
      remainingMs,
      focusMinutes: this.state.focusMinutes,
      breakMinutes: this.state.breakMinutes
    };
  }

  /** 今日专注总分钟数 */
  sessionsToday(): number {
    const today = todayStr();
    return this.sessions
      .filter((s) => s.date === today)
      .reduce((sum, s) => sum + s.minutes, 0);
  }

  // ---------- 内部 ----------

  private recordSession(minutes: number): void {
    const date = todayStr();
    const existing = this.sessions.find((s) => s.date === date);
    if (existing) existing.minutes += minutes;
    else this.sessions.push({ date, minutes });
    this.persist();
  }

  private notify(title: string, body: string): void {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    } catch (err) {
      console.error('[pomodoro] 系统通知失败:', err instanceof Error ? err.message : String(err));
    }
    this.onNotify?.(title, body);
  }

  /** 广播状态变化（面板订阅后自动刷新） */
  private broadcastChanged(): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('pet:pomodoro:changed');
    }
  }
}

/** 本地时区日期串 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
