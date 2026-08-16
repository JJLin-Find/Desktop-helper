/**
 * 统一调度器服务：包装 core Scheduler + 持久化快照 + 日志。
 * 番茄钟、定时提醒、心情衰减 tick 后续统一注册到此。
 */
import { Scheduler, type SchedulerJob, type SchedulerSnapshot } from '@desktop-helper/core';
import type { JsonStore } from './store.service';

interface SchedulerStoreShape {
  scheduler: SchedulerSnapshot;
}

export class SchedulerService {
  readonly scheduler: Scheduler;

  constructor(private readonly store: JsonStore<SchedulerStoreShape>) {
    this.scheduler = new Scheduler({ tickIntervalMs: 250 });
    this.scheduler.onStateChange = (state) => {
      console.log(`[scheduler] ${state}`);
    };
  }

  start(): void {
    const snapshot = this.store.get('scheduler');
    if (snapshot && Array.isArray(snapshot.jobs)) {
      this.scheduler.restore(snapshot);
      const pending = snapshot.jobs.filter((j: SchedulerJob) => j.fireAt <= Date.now());
      if (pending.length > 0) {
        console.log(`[scheduler] 恢复 ${snapshot.jobs.length} 个任务，其中 ${pending.length} 个已过期`);
      }
    }
    this.scheduler.start();
  }

  stop(): void {
    this.persist();
    this.scheduler.stop();
  }

  persist(): void {
    this.store.set('scheduler', this.scheduler.snapshot());
  }

  /** 注册任务（立即持久化） */
  addJob(job: SchedulerJob): void {
    this.scheduler.addJob(job);
    this.persist();
  }

  removeJob(id: string): void {
    this.scheduler.removeJob(id);
    this.persist();
  }
}
