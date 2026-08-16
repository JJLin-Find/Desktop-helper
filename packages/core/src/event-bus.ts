/**
 * 类型安全事件总线
 *
 * 用于主进程（数值 tick、提醒触发）与渲染层（动画指令）之间的事件传递，
 * 以及 core 内部模块解耦。零依赖，可与 mitt 互换。
 *
 * 实现细节：内部统一以 (payload: unknown) => void 存储监听器，
 * 公开 API 层做类型收窄，避免泛型强转的类型错误。
 */

export type EventHandler<T> = (payload: T) => void;

export interface EventMap {
  [event: string]: unknown;
}

export class EventBus<T extends EventMap> {
  private readonly handlers = new Map<keyof T, Set<(payload: unknown) => void>>();

  on<K extends keyof T>(event: K, handler: EventHandler<T[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => this.off(event, handler);
  }

  once<K extends keyof T>(event: K, handler: EventHandler<T[K]>): () => void {
    const wrapped: EventHandler<T[K]> = (payload: T[K]) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  off<K extends keyof T>(event: K, handler: EventHandler<T[K]>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as (payload: unknown) => void);
    if (set.size === 0) this.handlers.delete(event);
  }

  emit<K extends keyof T>(event: K, payload: T[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        // 单个监听器异常不阻断其他监听器
        console.error(`[EventBus] handler for "${String(event)}" threw:`, err);
      }
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }

  listenerCount<K extends keyof T>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}
