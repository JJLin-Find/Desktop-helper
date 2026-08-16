/**
 * 桌宠行为配置与交互辅助（纯逻辑，零平台依赖）
 *
 * 对应 docs/design-pet-interactions.md §3-§6：
 * - PetBehaviorConfig：所有可调参数集中管理（§11 参数表）
 * - PettingController：抚摸连击衰减（§5.2）
 * - IdleChainTimer：待机行为链计时（§6，纯逻辑判定，由宿主轮询触发）
 */

import type { PetPart } from './pet-stats';

// ---------- PetBehaviorConfig ----------

export interface PetBehaviorConfig {
  // 逗猫棒
  /** 兴趣半径 px：光标进入 → watch（注视） */
  rWatch: number;
  /** 追逐半径 px：光标距桌宠 < 此值且移动 → chase */
  rChase: number;
  /** 光标速度阈值 px/s：超过才触发追逐（防静止误触） */
  vChase: number;
  /** 桌宠追逐移动速度 px/s */
  chaseSpeed: number;
  /** 扑击蓄力 ms */
  pounceDelay: number;
  /** 扑击命中半径 px */
  pounceRange: number;
  /** 扑击冷却 ms */
  pounceCooldown: number;
  /** 追逐/扑击最低触发距离 px（防光标贴脸抖动） */
  chaseMinDist: number;
  // 待机链
  /** 无操作多久进入待机链（理毛/打哈欠）ms */
  idleChainAfterMs: number;
  /** 无操作多久入睡 ms */
  sleepAfterMs: number;
  // 抚摸
  /** 连击重置窗口 ms（同一部位超过该间隔视为新的一次抚摸） */
  pettingWindowMs: number;
  // 喂食
  /** 饱腹阈值：≥ 此值拒绝进食 */
  saturationLimit: number;
  /** 饥饿提示阈值：satiety < 此值冒"饿"气泡 */
  hungerHintSatiety: number;
  /** 拖拽悬停多久视为投喂 ms */
  feedHoverMs: number;
}

export const DEFAULT_BEHAVIOR_CONFIG: PetBehaviorConfig = {
  rWatch: 260,
  rChase: 120,
  vChase: 60,
  chaseSpeed: 180,
  pounceDelay: 300,
  pounceRange: 80,
  pounceCooldown: 1500,
  chaseMinDist: 60,
  idleChainAfterMs: 30_000,
  sleepAfterMs: 90_000,
  pettingWindowMs: 5000,
  saturationLimit: 95,
  hungerHintSatiety: 20,
  feedHoverMs: 500
};

// ---------- PettingController（抚摸连击衰减） ----------

/**
 * 同一部位在窗口期内连续抚摸收益衰减：×1 → ×0.5 → ×0.25 → 0
 * 跨部位切换或超过窗口期则重置。纯时间戳逻辑，可单测。
 */
export class PettingController {
  private lastPart: PetPart | null = null;
  private lastTime = 0;
  private streak = 0;

  constructor(private readonly windowMs = DEFAULT_BEHAVIOR_CONFIG.pettingWindowMs) {}

  /** 返回本次抚摸的收益乘数，并更新连击状态 */
  nextMultiplier(part: PetPart, nowMs: number): number {
    if (part === this.lastPart && nowMs - this.lastTime < this.windowMs) {
      this.streak++;
    } else {
      this.streak = 0;
    }
    this.lastPart = part;
    this.lastTime = nowMs;
    const multipliers = [1, 0.5, 0.25, 0];
    return multipliers[this.streak] ?? 0;
  }

  reset(): void {
    this.streak = 0;
    this.lastPart = null;
    this.lastTime = 0;
  }
}

// ---------- IdleChainTimer（待机行为链计时） ----------

export type IdlePhase = 'idle' | 'chain' | 'sleep';

/**
 * 待机行为链计时器（纯逻辑）：
 * 0–idleChainAfterMs → idle；idleChainAfterMs–sleepAfterMs → chain；> sleepAfterMs → sleep。
 * 由宿主定期调用 update(nowMs) 推进；任何用户交互应调用 poke() 重置。
 */
export class IdleChainTimer {
  private lastActivityAt = 0;
  private started = false;

  constructor(private readonly config: PetBehaviorConfig = DEFAULT_BEHAVIOR_CONFIG) {}

  /** 用户交互时调用：重置无操作计时 */
  poke(nowMs = Date.now()): void {
    this.lastActivityAt = nowMs;
    this.started = true;
  }

  /**
   * 返回当前应处的待机阶段；可用 overrides 动态调整阈值（心情联动）。
   * 心情低 → idleChainAfterMs/sleepAfterMs 缩短（更快打哈欠/入睡）；
   * 心情高 → 延长（更有活力）。
   */
  phase(
    nowMs = Date.now(),
    overrides?: { idleChainAfterMs?: number; sleepAfterMs?: number }
  ): IdlePhase {
    if (!this.started) return 'idle';
    const idleMs = nowMs - this.lastActivityAt;
    const idleAfter = overrides?.idleChainAfterMs ?? this.config.idleChainAfterMs;
    const sleepAfter = overrides?.sleepAfterMs ?? this.config.sleepAfterMs;
    if (idleMs >= sleepAfter) return 'sleep';
    if (idleMs >= idleAfter) return 'chain';
    return 'idle';
  }
}
