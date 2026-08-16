/**
 * 桌宠状态机（Pet State Machine）
 *
 * 参考 docs/design-pet-interactions.md：11 态 + 优先级仲裁 + 冷却（cooldown）。
 * 状态：idle / walk / watch / chase / pounce / sleep / drag / being-petted / eat / interact / click-through
 *
 * 设计：
 * - 每个状态有优先级（数值越大越"抢占"）；转换时若目标优先级低于当前，
 *   需要 force=true 才允许（防止"待机打断拖拽"之类）；
 * - 冷却：状态退出后进入冷却，冷却期内不允许再次进入（防抖动/刷反馈）；
 * - 纯逻辑、零依赖，可单测。
 */

export type PetState =
  | 'idle'
  | 'walk'
  | 'watch'
  | 'chase'
  | 'pounce'
  | 'sleep'
  | 'drag'
  | 'being-petted'
  | 'eat'
  | 'interact'
  | 'click-through';

export type PetTransitionReason =
  | 'user-drag-start'
  | 'user-drag-end'
  | 'user-click'
  | 'user-touch'
  | 'mouse-chase'
  | 'mouse-watch'
  | 'mouse-pounce'
  | 'mouse-away'
  | 'feed'
  | 'sleep-timer'
  | 'wake'
  | 'click-through-on'
  | 'click-through-off'
  | 'action-triggered'
  | 'init'
  | string;

export interface PetTransition {
  from: PetState;
  to: PetState;
  reason: PetTransitionReason;
  at: number;
}

/** 状态优先级表：数值越大越"抢占" */
export const PET_STATE_PRIORITY: Record<PetState, number> = {
  'click-through': 0,
  idle: 10,
  watch: 20,
  walk: 30,
  sleep: 40,
  eat: 50,
  'being-petted': 55,
  interact: 60,
  chase: 70,
  pounce: 75, // 扑击可打断 chase
  drag: 100 // 拖拽最高：任何动画都不能打断用户拖拽
};

/** 默认冷却表（ms）：状态退出后禁止再次进入的时长 */
export const PET_STATE_COOLDOWNS: Partial<Record<PetState, number>> = {
  watch: 400, // 注视/待机防抖
  eat: 3000, // 进食冷却
  'being-petted': 1200, // 抚摸冷却
  interact: 800, // 互动反馈冷却，防连点刷屏
  pounce: 1500 // 扑击冷却
};

export interface PetStateMachineOptions {
  /** 初始状态，默认 idle */
  initialState?: PetState;
  /** 覆盖默认冷却表 */
  cooldowns?: Partial<Record<PetState, number>>;
  /** 覆盖默认优先级表 */
  priority?: Partial<Record<PetState, number>>;
}

export interface PetStateMachineSnapshot {
  state: PetState;
  lastTransitionAt: number;
  historySize: number;
}

export class PetStateMachine {
  private state: PetState;
  private readonly cooldowns: Record<PetState, number>;
  private readonly priority: Record<PetState, number>;
  private readonly lastExitAt = new Map<PetState, number>();
  private readonly history: PetTransition[] = [];
  private readonly maxHistory: number;

  /** 状态变化回调 */
  onTransition: ((t: PetTransition) => void) | null = null;

  constructor(options: PetStateMachineOptions = {}) {
    this.state = options.initialState ?? 'idle';
    const baseCooldowns: Record<PetState, number> = {
      idle: 0,
      walk: 0,
      watch: 0,
      chase: 0,
      pounce: 0,
      sleep: 0,
      drag: 0,
      'being-petted': 0,
      eat: 0,
      interact: 0,
      'click-through': 0,
      ...PET_STATE_COOLDOWNS,
      ...options.cooldowns
    };
    this.cooldowns = baseCooldowns;
    this.priority = { ...PET_STATE_PRIORITY, ...options.priority };
    this.maxHistory = 50;
  }

  get current(): PetState {
    return this.state;
  }

  /**
   * 请求状态转换。
   * @param to 目标状态
   * @param reason 转换原因
   * @param opts.force 是否允许抢占低优先级状态（默认 false）
   * @returns 是否发生了转换
   */
  transition(to: PetState, reason: PetTransitionReason, opts: { force?: boolean } = {}): boolean {
    if (to === this.state) return false;

    // 冷却检查：目标状态处于冷却期内则拒绝
    const cooldownMs = this.cooldowns[to];
    if (cooldownMs > 0) {
      const lastExit = this.lastExitAt.get(to);
      if (lastExit !== undefined && Date.now() - lastExit < cooldownMs) {
        return false;
      }
    }

    // 优先级仲裁
    if (!opts.force && this.priority[to] < this.priority[this.state]) {
      return false;
    }

    const from = this.state;
    this.state = to;
    this.lastExitAt.set(from, Date.now());

    const t: PetTransition = { from, to, reason, at: Date.now() };
    this.history.push(t);
    if (this.history.length > this.maxHistory) this.history.shift();

    this.onTransition?.(t);
    return true;
  }

  /** 强制转换（跳过优先级仲裁，仍受冷却约束） */
  force(to: PetState, reason: PetTransitionReason): boolean {
    return this.transition(to, reason, { force: true });
  }

  isInCooldown(state: PetState): boolean {
    const ms = this.cooldowns[state];
    if (ms <= 0) return false;
    const lastExit = this.lastExitAt.get(state);
    return lastExit !== undefined && Date.now() - lastExit < ms;
  }

  /** 最近 N 次转换记录（只读） */
  recentTransitions(n = 10): readonly PetTransition[] {
    return this.history.slice(-n);
  }

  snapshot(): PetStateMachineSnapshot {
    return {
      state: this.state,
      lastTransitionAt: this.history.at(-1)?.at ?? 0,
      historySize: this.history.length
    };
  }
}
