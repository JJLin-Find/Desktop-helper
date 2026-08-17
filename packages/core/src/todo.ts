/**
 * 待办清单（TODO）领域模型 —— 纯 TS、零依赖、零平台 API。
 *
 * 设计要点：
 * - 四象限法（重要/紧急）分类 + 固定排序（重要紧急 → 重要不紧急 → 不重要紧急 → 不重要不紧急）；
 * - 按"所属日期 YYYY-MM-DD"分桶，跨天自动结转（carriedTo 幂等防重复复制）；
 * - 完成历史（doneAt）供复盘与 AI 简要分析。
 */

/** 待办任务（持久化结构） */
export interface TodoItem {
  /** 全局唯一 id */
  id: string;
  /** 任务名称 */
  name: string;
  /** 所属日期 'YYYY-MM-DD'（本地时区） */
  date: string;
  /** 开始时间 'HH:mm'（可选） */
  start?: string;
  /** 结束时间 'HH:mm'（可选） */
  end?: string;
  important: boolean;
  urgent: boolean;
  done: boolean;
  /** 创建时间（epoch ms） */
  createdAt: number;
  /** 完成时间（epoch ms） */
  doneAt?: number;
  /** 结转来源任务 id（跨天复制产生） */
  rolloverFrom?: string;
  /** 本任务已结转到的日期 key（幂等防重复复制） */
  carriedTo?: string;
}

/** 四象限分类 */
export type Quadrant = 'urgent-important' | 'important' | 'urgent' | 'neither';

/**
 * 计算任务所在象限：
 * important&&urgent → 'urgent-important'；important&&!urgent → 'important'；
 * !important&&urgent → 'urgent'；否则 → 'neither'。
 */
export function quadrantOf(t: Pick<TodoItem, 'important' | 'urgent'>): Quadrant {
  if (t.important && t.urgent) return 'urgent-important';
  if (t.important && !t.urgent) return 'important';
  if (!t.important && t.urgent) return 'urgent';
  return 'neither';
}

/** 象限展示顺序（重要紧急 → 重要不紧急 → 不重要紧急 → 不重要不紧急） */
export const QUADRANT_ORDER: Quadrant[] = ['urgent-important', 'important', 'urgent', 'neither'];

/**
 * 排序：done 的全部排最后（按完成时间升序）；
 * 未完成按 QUADRANT_ORDER 排序，同象限按 start 字符串升序（无 start 的按 createdAt 升序）。
 * 返回新数组，不修改入参。
 */
export function sortTodos(items: TodoItem[]): TodoItem[] {
  const quadIdx = new Map<Quadrant, number>(QUADRANT_ORDER.map((q, i) => [q, i]));
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return (a.doneAt ?? 0) - (b.doneAt ?? 0);
    const qa = quadIdx.get(quadrantOf(a)) ?? 0;
    const qb = quadIdx.get(quadrantOf(b)) ?? 0;
    if (qa !== qb) return qa - qb;
    // 同象限：有 start 的排前（按 start 升序）；无 start 的按 createdAt 升序
    const hasA = Boolean(a.start);
    const hasB = Boolean(b.start);
    if (hasA !== hasB) return hasA ? -1 : 1;
    if (hasA) return (a.start ?? '').localeCompare(b.start ?? '');
    return a.createdAt - b.createdAt;
  });
}

/** 本地时区 'YYYY-MM-DD' */
export function dateKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 今天的日期 key（本地时区 'YYYY-MM-DD'） */
export function todayKey(): string {
  return dateKeyOf(new Date());
}
