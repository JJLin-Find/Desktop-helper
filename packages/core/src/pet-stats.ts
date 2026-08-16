/**
 * 桌宠数值系统（心情/好感/饱腹/精力）
 *
 * 参考 docs/design-pet-interactions.md：
 * 单向数据流：输入事件 → reducer 更新数值 → 输出动画指令 → 渲染层消费。
 * 纯函数 reducer + 可选持有者（PetStats），可单测、可持久化。
 */

export type StatKey = 'mood' | 'satiety' | 'affection' | 'energy';

export type Stats = Record<StatKey, number>;

export type MoodState = 'happy' | 'calm' | 'sad' | 'angry';

export interface StatDelta {
  mood?: number;
  satiety?: number;
  affection?: number;
  energy?: number;
}

/** 抚摸部位 */
export type PetPart = 'head' | 'body';

/** 食物 id */
export type FoodId = 'fish' | 'can' | 'cookie' | 'milk' | 'random-file';

export interface Food {
  id: FoodId;
  label: string;
  delta: StatDelta;
}

/** 食物表（可配置/扩展） */
export const FOOD_TABLE: Record<FoodId, Food> = {
  fish: { id: 'fish', label: '鱼', delta: { satiety: 18, mood: 10, affection: 4, energy: 2 } },
  can: { id: 'can', label: '罐头', delta: { satiety: 14, mood: 8, affection: 3, energy: 1 } },
  cookie: { id: 'cookie', label: '饼干', delta: { satiety: 10, mood: 5, affection: 2 } },
  milk: { id: 'milk', label: '牛奶', delta: { satiety: 8, mood: 6, affection: 3, energy: 1 } },
  'random-file': { id: 'random-file', label: '随便喂点', delta: { satiety: 7, mood: 3, affection: 1 } }
};

export type PetActionInput =
  | { kind: 'feed' } // 兼容：等价 feed-food fish 减半
  | { kind: 'feed-food'; food: FoodId }
  | { kind: 'pet' } // 兼容：等价 pet-part head
  | { kind: 'pet-part'; part: PetPart }
  | { kind: 'pounce'; hit: boolean }
  | { kind: 'click' }
  | { kind: 'play-game'; result: 'win' | 'lose' }
  | { kind: 'time'; dtMs: number }
  | { kind: 'sleep' }
  | { kind: 'wake' };

export const INITIAL_STATS: Stats = { mood: 60, satiety: 70, affection: 10, energy: 80 };

const clamp = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

/** 情绪映射：由 mood 值 + 其他维度微调 */
export function moodOf(stats: Stats): MoodState {
  if (stats.mood >= 80) return 'happy';
  if (stats.mood >= 45) return 'calm';
  if (stats.satiety < 15) return 'angry'; // 饥饿优先触发"生气"
  return 'sad';
}

/** 纯函数 reducer：输入事件 → 新的 Stats（不修改原对象） */
export function applyStatChange(stats: Stats, delta: StatDelta): Stats {
  return {
    mood: clamp(stats.mood + (delta.mood ?? 0)),
    satiety: clamp(stats.satiety + (delta.satiety ?? 0)),
    affection: clamp(stats.affection + (delta.affection ?? 0)),
    energy: clamp(stats.energy + (delta.energy ?? 0))
  };
}

/**
 * 处理桌宠输入事件，返回更新后的 Stats。
 * 纯函数：不持有状态，方便测试与持久化。
 */
export function reducePetInput(stats: Stats, input: PetActionInput): Stats {
  switch (input.kind) {
    case 'feed':
      // 兼容旧事件：按"随便喂点"处理
      return applyStatChange(stats, FOOD_TABLE['random-file'].delta);
    case 'feed-food': {
      const food = FOOD_TABLE[input.food];
      return applyStatChange(stats, food.delta);
    }
    case 'pet':
      return applyStatChange(stats, { affection: 5, mood: 4, energy: -1 });
    case 'pet-part':
      // 抚摸收益（连击衰减由 PettingController 以乘数叠加，见 pet-behavior.ts）
      return input.part === 'head'
        ? applyStatChange(stats, { affection: 6, mood: 5 })
        : applyStatChange(stats, { affection: 3, mood: 2 });
    case 'pounce':
      // 扑击：命中 → 兴奋；未命中仅耗精力（连续失败的情绪惩罚由行为控制器累计）
      return input.hit
        ? applyStatChange(stats, { mood: 6, energy: -8 })
        : applyStatChange(stats, { energy: -8 });
    case 'click':
      return applyStatChange(stats, { affection: 1, mood: 1 });
    case 'play-game':
      return input.result === 'win'
        ? applyStatChange(stats, { mood: 10, affection: 4, energy: -6 })
        : applyStatChange(stats, { mood: 2, energy: -4 });
    case 'sleep':
      return applyStatChange(stats, { energy: 40, mood: 5 });
    case 'wake':
      return applyStatChange(stats, { mood: -2 });
    case 'time': {
      // 随时间缓慢衰减：心情、饱腹、精力缓慢下降
      const minutes = input.dtMs / 60_000;
      return applyStatChange(stats, {
        mood: -0.08 * minutes,
        satiety: -0.12 * minutes,
        energy: -0.05 * minutes
      });
    }
    default:
      return stats;
  }
}

/**
 * 数值状态持有者（含 tick 衰减），供主进程常驻使用。
 * 使用 reducer 保持逻辑唯一来源。
 */
export class PetStats {
  private stats: Stats = { ...INITIAL_STATS };
  /** 数值变化回调 */
  onChange: ((stats: Stats, mood: MoodState) => void) | null = null;

  constructor(initial?: Partial<Stats>) {
    if (initial) this.stats = { ...INITIAL_STATS, ...initial };
  }

  get value(): Readonly<Stats> {
    return this.stats;
  }

  get mood(): MoodState {
    return moodOf(this.stats);
  }

  apply(input: PetActionInput): Stats {
    this.stats = reducePetInput(this.stats, input);
    this.onChange?.(this.stats, this.mood);
    return this.stats;
  }

  /** 直接应用增量（供连击衰减等需要自定义倍数的场景） */
  applyDelta(delta: StatDelta): Stats {
    this.stats = applyStatChange(this.stats, delta);
    this.onChange?.(this.stats, this.mood);
    return this.stats;
  }

  /** 每次调度 tick（建议注册进统一 Scheduler，如每分钟一次） */
  tick(dtMs: number): Stats {
    return this.apply({ kind: 'time', dtMs });
  }

  snapshot(): Stats {
    return { ...this.stats };
  }

  restore(snapshot: Stats): void {
    this.stats = { ...snapshot };
  }
}
