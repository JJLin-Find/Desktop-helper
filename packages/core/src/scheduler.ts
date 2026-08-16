/**
 * 统一调度器（Scheduler Service）
 *
 * 设计要点（来自调研结论）：
 * - 基于"绝对时间戳 + 定时检查"而非 setTimeout 累加，避免漂移；
 * - 番茄钟、定时提醒、心情衰减 tick 等统一注册为 Job；
 * - 支持持久化快照（snapshot/restore），重启/休眠唤醒后恢复并补发过期任务。
 *
 * 零平台依赖：可在 Electron 主进程、Node 或纯测试环境运行。
 */

export interface SchedulerJob {
  /** 全局唯一 id */
  id: string;
  /** 任务类型，便于宿主按类型分发 */
  type: string;
  /** 下次触发时间（epoch ms） */
  fireAt: number;
  /** 任意负载（必须可 JSON 序列化以便持久化） */
  payload?: unknown;
  /** 可选：固定间隔重复（ms）。触发后自动重排 fireAt = now + intervalMs */
  repeatIntervalMs?: number;
  /** 可选：触发后是否保留但暂停（用于一次性任务标记） */
  oneShot?: boolean;
}

export interface SchedulerSnapshot {
  jobs: SchedulerJob[];
  paused: boolean;
}

export interface SchedulerOptions {
  /** 内部检查周期（ms），默认 250 */
  tickIntervalMs?: number;
  /** 每个 tick 至多触发多少个 Job，防止事件风暴，默认 50 */
  maxFirePerTick?: number;
}

export class Scheduler {
  private readonly jobs = new Map<string, SchedulerJob>();
  private readonly options: Required<SchedulerOptions>;
  private timer: NodeJS.Timeout | null = null;
  private paused = false;

  /** 有 Job 到点时触发（在宿主进程中回调；可跨进程转发） */
  onFire: ((job: SchedulerJob) => void) | null = null;
  /** 调度器启动/停止事件（用于日志） */
  onStateChange: ((state: 'started' | 'stopped' | 'paused' | 'resumed') => void) | null = null;

  constructor(options: SchedulerOptions = {}) {
    this.options = {
      tickIntervalMs: options.tickIntervalMs ?? 250,
      maxFirePerTick: options.maxFirePerTick ?? 50,
    };
  }

  addJob(job: SchedulerJob): void {
    if (this.jobs.has(job.id)) {
      throw new Error(`[Scheduler] Job id 重复: ${job.id}`);
    }
    this.jobs.set(job.id, job);
  }

  upsertJob(job: SchedulerJob): void {
    this.jobs.set(job.id, job);
  }

  removeJob(id: string): boolean {
    return this.jobs.delete(id);
  }

  hasJob(id: string): boolean {
    return this.jobs.has(id);
  }

  /** 重排某个 Job 的触发时间 */
  reschedule(id: string, fireAt: number): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.fireAt = fireAt;
    return true;
  }

  get size(): number {
    return this.jobs.size;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.options.tickIntervalMs);
    // 避免 Node 事件循环在仅有调度器时被计时器阻塞退出（Electron 主进程无影响，测试环境有用）
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.onStateChange?.('started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onStateChange?.('stopped');
  }

  pause(): void {
    this.paused = true;
    this.onStateChange?.('paused');
  }

  resume(): void {
    this.paused = false;
    this.onStateChange?.('resumed');
  }

  /** 处理到期的 Job：触发 + 重排/移除。返回本次触发的 Job 列表 */
  private tick(): SchedulerJob[] {
    if (this.paused) return [];
    const now = Date.now();
    const due: SchedulerJob[] = [];

    for (const job of this.jobs.values()) {
      if (job.fireAt <= now) {
        due.push(job);
        if (due.length >= this.options.maxFirePerTick) break;
      }
    }

    if (due.length === 0) return [];

    for (const job of due) {
      if (job.repeatIntervalMs !== undefined && !job.oneShot) {
        // 重复任务：以"应触发时间"为基准重排，追赶错过的周期（防漂移且不堆积）
        let next = job.fireAt + job.repeatIntervalMs;
        while (next <= now) next += job.repeatIntervalMs;
        job.fireAt = next;
      } else {
        this.jobs.delete(job.id);
      }
      this.onFire?.(job);
    }
    return due;
  }

  /** 持久化快照 */
  snapshot(): SchedulerSnapshot {
    return {
      jobs: [...this.jobs.values()].map((j) => ({ ...j })),
      paused: this.paused,
    };
  }

  /** 从快照恢复；可选补发逻辑由宿主在 onFire 中自行实现 */
  restore(snapshot: SchedulerSnapshot): void {
    this.jobs.clear();
    for (const job of snapshot.jobs) {
      this.jobs.set(job.id, { ...job });
    }
    this.paused = snapshot.paused;
  }

  /** 休眠唤醒后的追赶：将所有过期任务统一前移一个周期（供宿主按需调用） */
  catchUpExpired(now = Date.now()): SchedulerJob[] {
    const due: SchedulerJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.repeatIntervalMs !== undefined && !job.oneShot && job.fireAt <= now) {
        let next = job.fireAt + job.repeatIntervalMs;
        while (next <= now) next += job.repeatIntervalMs;
        job.fireAt = next;
      }
    }
    return due;
  }
}
