/**
 * 桌宠行为控制器（PetBehaviorController）
 *
 * 实现 docs/design-pet-interactions.md 的行为规则引擎（逗猫棒/抚摸/喂食/待机链/心情联动）。
 * 职责：轮询鼠标 → 驱动状态机转换 + 数值 reducer → 输出动画指令（经 IPC 推给渲染层）。
 * 本模块不依赖渲染实现（Live2D/Canvas 均可），只消费/产出指令。
 */
import {
  PetStateMachine,
  PetStats,
  IdleChainTimer,
  PettingController,
  DEFAULT_BEHAVIOR_CONFIG,
  moodOf,
  type PetBehaviorConfig,
  type PetPart,
  type FoodId,
  type Stats
} from '@desktop-helper/core';

/** 推送给渲染层的动画指令 */
export interface PetActionCommand {
  action: string;
  oneShot?: boolean;
  durationMs?: number;
  bubble?: string;
  mood?: ReturnType<typeof moodOf>;
}

export interface PetClickInput {
  x: number;
  y: number;
  /** 渲染层命中判定结果（Live2D HitArea）；未命中透明区则为 null */
  hitPart: PetPart | null;
}

export interface PetBehaviorControllerDeps {
  stateMachine: PetStateMachine;
  stats: PetStats;
  config?: Partial<PetBehaviorConfig>;
  /** 获取桌宠窗口位置（像素） */
  getWindowPosition: () => { x: number; y: number };
  /** 移动桌宠窗口（用于追逐/扑击位移） */
  moveBy: (dx: number, dy: number) => void;
  /** 获取光标位置（像素，屏幕坐标） */
  getCursor: () => { x: number; y: number };
  /** 输出动画指令（宿主转发给渲染层） */
  emitCommand: (cmd: PetActionCommand) => void;
}

export class PetBehaviorController {
  private readonly config: PetBehaviorConfig;
  private readonly stateMachine: PetStateMachine;
  private readonly stats: PetStats;
  private readonly idleTimer: IdleChainTimer;
  private readonly petting: PettingController;

  private cursorLast: { x: number; y: number } | null = null;
  private cursorStillSince = 0;
  private lastPounceAt = 0;
  private consecutiveMisses = 0;
  private lastChainAction = '';
  private timer: NodeJS.Timeout | null = null;
  private lastTick = 0;
  /** 逗猫棒模式开关（可设置） */
  playModeEnabled = true;
  /**
   * 自动移动开关（默认 false）：
   * false = 桌宠静止，仅保留"注视"反应（watch），不追逐/不扑击/不移动窗口；
   * true = 启用追逐（chase）与扑击（pounce），桌宠会跟随鼠标移动。
   */
  autoMove = false;

  constructor(private readonly deps: PetBehaviorControllerDeps) {
    this.config = { ...DEFAULT_BEHAVIOR_CONFIG, ...deps.config };
    this.stateMachine = deps.stateMachine;
    this.stats = deps.stats;
    this.idleTimer = new IdleChainTimer(this.config);
    this.petting = new PettingController(this.config.pettingWindowMs);
  }

  // ---------- 生命周期 ----------

  start(): void {
    this.idleTimer.poke();
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), 1000 / 30); // ~30Hz 行为判定
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---------- 主循环 ----------

  private tick(): void {
    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 1); // 秒，防大间隔跳变
    this.lastTick = now;

    // 1) 逗猫棒（鼠标追逐/扑击）
    if (this.playModeEnabled) {
      this.tickPlayMode(now, dt);
    }

    // 2) 待机链（无操作计时）
    this.tickIdleChain(now);
  }

  private tickPlayMode(now: number, dt: number): void {
    const cursor = this.deps.getCursor();
    const win = this.deps.getWindowPosition();
    // 桌宠中心（窗口中心）
    const centerX = win.x + 130;
    const centerY = win.y + 130;
    const dist = Math.hypot(cursor.x - centerX, cursor.y - centerY);

    // 光标速度（px/s）
    let speed = 0;
    if (this.cursorLast) {
      const moved = Math.hypot(cursor.x - this.cursorLast.x, cursor.y - this.cursorLast.y);
      speed = moved / Math.max(dt, 0.001);
    }
    this.cursorLast = { x: cursor.x, y: cursor.y };

    const { rWatch, rChase, vChase, chaseMinDist } = this.config;

    if (dist > rWatch) {
      // 光标太远：回到待机（若在 watch/chase）
      if (this.stateMachine.current === 'watch' || this.stateMachine.current === 'chase') {
        this.stateMachine.transition('idle', 'mouse-away');
      }
      return;
    }

    if (this.stateMachine.current === 'drag') return; // 拖拽中不干预
    if (this.stateMachine.current === 'eat' || this.stateMachine.current === 'being-petted') return;

    // 自动移动关闭：桌宠静止，仅注视（不追逐/不扑击/不移动窗口）
    if (!this.autoMove) {
      if (dist <= rWatch) {
        this.stateMachine.transition('watch', 'mouse-watch');
        this.emit('watch');
      }
      return;
    }

    if (dist <= rChase && dist >= chaseMinDist && speed > vChase) {
      // 追逐：向光标移动
      this.stateMachine.transition('chase', 'mouse-chase');
      const step = this.config.chaseSpeed * dt;
      const nx = centerX + ((cursor.x - centerX) / dist) * step;
      const ny = centerY + ((cursor.y - centerY) / dist) * step;
      this.deps.moveBy(Math.round(nx - centerX), Math.round(ny - centerY));
      this.emit('chase', { oneShot: false });
      return;
    }

    if (dist <= rChase && dist < chaseMinDist && speed > vChase) {
      // 贴脸快速移动 → 注视不追（防抖动）
      this.stateMachine.transition('watch', 'mouse-watch');
      this.emit('watch');
      return;
    }

    if (speed <= vChase) {
      // 光标静止/缓慢
      if (this.cursorStillSince === 0) this.cursorStillSince = now;
      if (dist <= rChase && now - this.cursorStillSince >= this.config.pounceDelay) {
        this.tryPounce(now, cursor);
      } else if (dist <= rWatch) {
        this.stateMachine.transition('watch', 'mouse-watch');
        this.emit('watch');
      }
    } else {
      this.cursorStillSince = 0;
    }
  }

  /** 尝试扑击（受冷却与精力限制） */
  private tryPounce(now: number, cursor: { x: number; y: number }): void {
    if (now - this.lastPounceAt < this.config.pounceCooldown) return;
    if (this.stats.value.energy < 20) return; // 精力不足不扑

    const stats = this.stats.apply({ kind: 'pounce', hit: false }); // 先耗精力
    const hit = this.pounceHit(cursor);
    if (hit) {
      this.stats.apply({ kind: 'pounce', hit: true }); // 命中奖励
      this.consecutiveMisses = 0;
      this.emit('pounce', { oneShot: true, bubble: '抓到啦！' });
    } else {
      this.consecutiveMisses++;
      if (this.consecutiveMisses >= 3) {
        this.stats.apply({ kind: 'time', dtMs: 0 }); // 无操作（保持占位）
        this.stats.apply({ kind: 'click' }); // 不引入负向事件，交由 mood 衰减自然处理
        this.consecutiveMisses = 0;
      }
      this.emit('pounce', { oneShot: true, bubble: '扑空啦…' });
    }
    this.lastPounceAt = now;
    this.cursorStillSince = 0;
    this.idleTimer.poke(now);
    void stats;
  }

  /** 扑击命中判定：桌宠窗口朝光标方向跳动一段距离，落点距光标 ≤ pounceRange 算命中 */
  private pounceHit(cursor: { x: number; y: number }): boolean {
    const win = this.deps.getWindowPosition();
    const centerX = win.x + 130;
    const centerY = win.y + 130;
    const dx = cursor.x - centerX;
    const dy = cursor.y - centerY;
    const dist = Math.hypot(dx, dy) || 1;
    const jump = 60; // 扑击位移 px
    this.deps.moveBy(Math.round((dx / dist) * jump), Math.round((dy / dist) * jump));
    const newCenterX = centerX + ((dx / dist) * jump);
    const newCenterY = centerY + ((dy / dist) * jump);
    return Math.hypot(cursor.x - newCenterX, cursor.y - newCenterY) <= this.config.pounceRange;
  }

  // ---------- 待机链 ----------

  private tickIdleChain(now: number): void {
    if (this.stateMachine.current === 'drag') return;
    // 心情联动：低落 → 更快打哈欠/入睡（×0.5）；开心 → 更活跃（×1.5）；精力低 → 早睡
    const mood = this.stats.value.mood;
    const energy = this.stats.value.energy;
    const moodFactor = mood < 30 ? 0.5 : mood >= 75 ? 1.5 : 1;
    const energyFactor = energy < 20 ? 0.6 : 1;
    const factor = Math.min(moodFactor, energyFactor);
    const phase = this.idleTimer.phase(now, {
      idleChainAfterMs: Math.round(this.config.idleChainAfterMs * factor),
      sleepAfterMs: Math.round(this.config.sleepAfterMs * factor)
    });

    if (phase === 'sleep' && this.stateMachine.current !== 'sleep') {
      this.stateMachine.transition('sleep', 'sleep-timer');
      this.emit('sleep', { oneShot: false });
      return;
    }

    if (phase === 'chain' && this.stateMachine.current === 'idle') {
      // 随机待机动作，避免重复
      const actions = ['idle_yawn', 'idle_groom', 'idle_stretch'];
      let action = this.lastChainAction;
      while (action === this.lastChainAction) {
        action = actions[Math.floor(Math.random() * actions.length)] ?? 'idle_yawn';
      }
      this.lastChainAction = action;
      this.emit(action, { oneShot: true });
    }
  }

  // ---------- 用户交互入口 ----------

  /** 用户点击（渲染层上报命中部位） */
  onClick(input: PetClickInput): void {
    this.idleTimer.poke();
    this.onUserActivity(); // sleep → idle + wake 动作

    if (!input.hitPart) return; // 透明区点击不响应

    // 抚摸（连击衰减）：基础增量 × 连击乘数
    const multiplier = this.petting.nextMultiplier(input.hitPart, Date.now());
    if (multiplier <= 0) {
      this.emit('pet_head', { oneShot: true, bubble: '痒痒的~' });
      return;
    }
    const baseDelta =
      input.hitPart === 'head' ? { affection: 6, mood: 5 } : { affection: 3, mood: 2 };
    this.stats.applyDelta({
      affection: Math.round((baseDelta.affection ?? 0) * multiplier),
      mood: Math.round((baseDelta.mood ?? 0) * multiplier)
    });

    this.stateMachine.transition('being-petted', 'user-touch');
    this.emit(input.hitPart === 'head' ? 'pet_head' : 'pet_body', {
      oneShot: true,
      bubble: input.hitPart === 'head' ? '呼噜呼噜~' : '好舒服~'
    });
  }

  /** 用户唤醒（鼠标进入/任意交互由宿主调用） */
  onUserActivity(): void {
    this.idleTimer.poke();
    if (this.stateMachine.current === 'sleep') {
      this.stateMachine.transition('idle', 'wake');
      this.emit('wake', { oneShot: true });
    }
  }

  /** 投喂（食物 id；由渲染层 drop / 菜单触发） */
  onFeed(food: FoodId): void {
    this.idleTimer.poke();
    const satiety = this.stats.value.satiety;
    if (satiety >= this.config.saturationLimit) {
      this.emit('eat', { oneShot: false, durationMs: 1200, bubble: '吃不下了~' });
      return;
    }
    this.stateMachine.transition('eat', 'feed');
    this.stats.apply({ kind: 'feed-food', food });
    this.emit('eat', { oneShot: false, durationMs: 3000, bubble: '好吃！' });
    // 进食结束后回待机（由指令时长回调触发 onEatEnd）
    setTimeout(() => {
      if (this.stateMachine.current === 'eat') {
        this.stateMachine.transition('idle', 'action-triggered');
      }
    }, 3000);
  }

  /** 拖拽开始/结束 */
  onDragStart(): void {
    this.idleTimer.poke();
    this.stateMachine.transition('drag', 'user-drag-start');
  }

  onDragEnd(): void {
    if (this.stateMachine.current === 'drag') {
      this.stateMachine.transition('idle', 'user-drag-end');
    }
  }

  /** 当前心情（供宿主/渲染层展示） */
  get mood(): ReturnType<typeof moodOf> {
    return moodOf(this.stats.value);
  }

  get statsSnapshot(): Readonly<Stats> {
    return this.stats.value;
  }

  private emit(action: string, extra: Partial<PetActionCommand> = {}): void {
    this.deps.emitCommand({ action, mood: this.mood, ...extra });
  }
}
