/**
 * 待办清单（TODO）服务 —— 四象限 + 跨天自动结转 + 完成历史 + AI 简要分析。
 *
 * - 存储：userData/todo-data.json，结构 `{ days: Record<string, TodoItem[]> }`
 *   （key 为 'YYYY-MM-DD'，本地时区），复用 JsonStore 原子写（tmp + rename）。
 * - 结转：ensureToday() 把历史日期中"未完成且未结转"的任务复制到今天
 *   （新 id、rolloverFrom=原任务 id、carriedTo=today 幂等防重复复制）。
 * - 分析：analyze() 收集 [fromKey, toKey] 区间已完成任务，调 AI 服务 assistant 模式
 *   做简要分析；用 popHistory 清理本次调用写入的对话历史，不污染正式对话。
 */
import { randomUUID } from 'node:crypto';
import {
  sortTodos,
  todayKey,
  quadrantOf,
  type TodoItem,
  type Quadrant
} from '@desktop-helper/core';
import type { JsonStore } from './store.service';
import type { AIService } from './ai.service';

/** 待办持久化结构（JsonStore shape） */
export interface TodoStoreShape {
  days: Record<string, TodoItem[]>;
}

/** 新增任务的入参（无 id/date/createdAt，由服务补全） */
export interface TodoAddInput {
  name: string;
  start?: string;
  end?: string;
  important: boolean;
  urgent: boolean;
}

/** 可更新字段 */
export type TodoPatch = Partial<Pick<TodoItem, 'name' | 'start' | 'end' | 'important' | 'urgent'>>;

/** 象限中文标签（分析 prompt 用） */
const QUADRANT_LABEL: Record<Quadrant, string> = {
  'urgent-important': '重要紧急',
  important: '重要不紧急',
  urgent: '不重要紧急',
  neither: '不重要不紧急'
};

/** 清洗可选时间字段：空串/空白 → undefined */
function cleanTime(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

export class TodoService {
  constructor(
    private readonly store: JsonStore<TodoStoreShape>,
    private readonly aiService: AIService
  ) {}

  /** 存储文件路径（供调试/验证） */
  get path(): string {
    return this.store.path;
  }

  private days(): Record<string, TodoItem[]> {
    return this.store.get('days');
  }

  private persist(): void {
    this.store.set('days', this.days());
  }

  /**
   * 跨天结转（幂等）：确保 days[today] 存在；把历史日期（dateKey < today）中
   * 每条 `!done && !carriedTo` 的任务复制一份追加到 days[today]（新 id、date=today、
   * rolloverFrom=原任务 id，保留 name/start/end/important/urgent），并给原任务写
   * carriedTo = today。有变更才写盘一次。返回 today 的排序列表。
   */
  ensureToday(): TodoItem[] {
    const today = todayKey();
    const days = this.days();
    if (!days[today]) days[today] = [];
    let changed = false;
    for (const [dateKey, items] of Object.entries(days)) {
      if (dateKey >= today) continue; // 只处理历史日期（字符串比较，YYYY-MM-DD 字典序即时间序）
      for (const item of items) {
        if (item.done || item.carriedTo) continue;
        days[today].push({
          id: randomUUID(),
          name: item.name,
          date: today,
          start: item.start,
          end: item.end,
          important: item.important,
          urgent: item.urgent,
          done: false,
          createdAt: Date.now(),
          rolloverFrom: item.id
        });
        item.carriedTo = today;
        changed = true;
      }
    }
    if (changed) this.persist();
    return sortTodos(days[today]);
  }

  /** 某日待办列表：默认今天；先 ensureToday() 处理结转，再返回该日期排序列表 */
  list(dateKey?: string): TodoItem[] {
    const key = dateKey ?? todayKey();
    this.ensureToday();
    return sortTodos(this.days()[key] ?? []);
  }

  /** 新增待办（name 非空校验），返回该日期排序列表 */
  add(input: TodoAddInput, dateKey?: string): TodoItem[] {
    const key = dateKey ?? todayKey();
    const name = String(input?.name ?? '').trim();
    if (!name) throw new Error('任务名称不能为空');
    const days = this.days();
    if (!days[key]) days[key] = [];
    const item: TodoItem = {
      id: randomUUID(),
      name,
      date: key,
      start: cleanTime(input?.start),
      end: cleanTime(input?.end),
      important: Boolean(input?.important),
      urgent: Boolean(input?.urgent),
      done: false,
      createdAt: Date.now()
    };
    days[key].push(item);
    this.persist();
    return sortTodos(days[key]);
  }

  /** 标记完成/未完成：done=true 记 doneAt=Date.now()，取消时清除 doneAt；返回该日期排序列表 */
  setDone(id: string, done: boolean, dateKey?: string): TodoItem[] {
    const key = dateKey ?? todayKey();
    const days = this.days();
    const list = days[key];
    const item = list?.find((t) => t.id === id);
    if (!list || !item) return sortTodos(list ?? []);
    item.done = Boolean(done);
    if (item.done) item.doneAt = Date.now();
    else delete item.doneAt;
    this.persist();
    return sortTodos(list);
  }

  /** 删除待办，返回该日期排序列表 */
  remove(id: string, dateKey?: string): TodoItem[] {
    const key = dateKey ?? todayKey();
    const days = this.days();
    const list = days[key];
    if (!list) return [];
    const next = list.filter((t) => t.id !== id);
    if (next.length !== list.length) {
      days[key] = next;
      this.persist();
    }
    return sortTodos(next);
  }

  /** 更新待办字段（name 非空校验），返回该日期排序列表 */
  update(id: string, patch: TodoPatch, dateKey?: string): TodoItem[] {
    const key = dateKey ?? todayKey();
    const days = this.days();
    const list = days[key];
    const item = list?.find((t) => t.id === id);
    if (!list || !item) return sortTodos(list ?? []);
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw new Error('任务名称不能为空');
      item.name = name;
    }
    if (patch.start !== undefined) item.start = cleanTime(patch.start);
    if (patch.end !== undefined) item.end = cleanTime(patch.end);
    if (patch.important !== undefined) item.important = Boolean(patch.important);
    if (patch.urgent !== undefined) item.urgent = Boolean(patch.urgent);
    this.persist();
    return sortTodos(list);
  }

  /** 历史完成记录：遍历 [fromKey, toKey] 区间（含端点，字符串比较）所有日期，收集 done=true，按 doneAt 升序 */
  history(fromKey: string, toKey: string): TodoItem[] {
    const from = String(fromKey ?? '');
    const to = String(toKey ?? '');
    const out: TodoItem[] = [];
    for (const [dateKey, items] of Object.entries(this.days())) {
      if (dateKey < from || dateKey > to) continue;
      for (const item of items) {
        if (item.done) out.push(item);
      }
    }
    out.sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
    return out;
  }

  /**
   * AI 简要分析某区间完成情况（工作重心/时间分布/建议）。
   * - 未配置 AI 服务 → { ok:false, text:'请先在「AI 对话设置」中配置 AI 服务' }；
   * - 区间内无完成任务 → { ok:false, text:'该时间范围内没有已完成的任务' }；
   * - 调 assistant 模式做一次流式分析，完成后清理本次写入的对话历史（不污染正式对话）。
   */
  async analyze(fromKey: string, toKey: string): Promise<{ ok: boolean; text: string }> {
    if (!this.aiService.isReady()) {
      return { ok: false, text: '请先在「AI 对话设置」中配置 AI 服务' };
    }
    const done = this.history(fromKey, toKey);
    if (done.length === 0) {
      return { ok: false, text: '该时间范围内没有已完成的任务' };
    }
    const lines = done.map((t, i) => {
      const quad = QUADRANT_LABEL[quadrantOf(t)];
      const span = [t.start, t.end].filter(Boolean).join('-');
      const doneAt = t.doneAt
        ? new Date(t.doneAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : '';
      return `${i + 1}. ${t.name}（日期 ${t.date}${span ? `，时段 ${span}` : ''}，${quad}，完成于 ${doneAt}）`;
    });
    const prompt = `请根据以下已完成任务清单，做简要分析：工作重心、时间分布、改进建议（用简洁的中文回答）：\n${lines.join('\n')}`;

    // 收集流式回复（临时包装 onChunk，保留原广播链路，完成后恢复）
    let reply = '';
    const origOnChunk = this.aiService.onChunk;
    this.aiService.onChunk = (chunk, mode) => {
      origOnChunk?.(chunk, mode);
      if (!chunk.done) reply += chunk.text;
    };
    const before = this.aiService.getHistoryLength();
    try {
      await this.aiService.chatStream(prompt, { mode: 'assistant' });
    } catch (err) {
      return {
        ok: false,
        text: `AI 分析失败：${err instanceof Error ? err.message : String(err)}`
      };
    } finally {
      this.aiService.onChunk = origOnChunk;
      // 清理本次调用写入的对话历史（成功时追加 user+assistant 两条；失败时已回滚）
      const added = this.aiService.getHistoryLength() - before;
      if (added > 0) this.aiService.popHistory(added);
    }
    if (!reply.trim()) return { ok: false, text: 'AI 分析无返回内容' };
    return { ok: true, text: reply.trim() };
  }
}
