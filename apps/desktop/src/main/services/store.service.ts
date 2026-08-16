/**
 * 轻量 JSON 配置存储（原子写入：tmp + rename）。
 * P0 阶段替代 electron-store；后续如需可无缝替换。
 */
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class JsonStore<T extends object> {
  private readonly file: string;
  private data: T;

  constructor(defaults: T, fileName = 'config.json') {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, fileName);
    this.data = { ...defaults };
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<T>;
      this.data = { ...this.data, ...parsed };
    } catch (err) {
      console.error('[store] 读取配置失败，使用默认值:', err);
    }
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value;
    this.persist();
  }

  update(fn: (draft: T) => void): void {
    fn(this.data);
    this.persist();
  }

  /** 原子写盘 */
  persist(): void {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] 写入配置失败:', err);
    }
  }

  get path(): string {
    return this.file;
  }
}
