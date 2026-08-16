/**
 * 文件搜索服务（方案见 docs/report-new-features.md §1）。
 *
 * - macOS：child_process.execFile('mdfind', [query, ...])，查询字符串按 Spotlight 语法构建
 *   （kMDItemFSName 文件名通配 + kMDItemContentTypeTree 类型 + kMDItemFSContentChangeDate 时间组合，见报告 §1.3）；
 *   输出用 -0（NUL 分隔，防路径含换行）解析为路径，再用 fs.stat 补 size/mtime。
 * - limit：部分 mdfind 版本（如本机 macOS 26.3）不支持 -limit 选项，首次调用时探测一次并缓存：
 *   支持则交给 mdfind 截断，不支持则在本进程按 limit 截断（maxBuffer 兜底防超量输出）。
 * - Windows：预留 Everything es.exe 分支（见报告 §1.4），本机 macOS 不验证。
 * - 子进程超时 5s（execFile timeout）防 Spotlight 索引卡死挂起；去抖在渲染层做（主进程不做）。
 * - 安全：结果路径来自 mdfind（可信系统输出），渲染层仅展示；reveal 用 shell.showItemInFolder。
 */
import { app, shell } from 'electron';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** 搜索选项（渲染层透传；与 preload 的 FileSearchOptions 结构一致） */
export interface FileSearchOptions {
  /** 类型过滤：kMDItemContentTypeTree 值（如 'public.image' / 'public.pdf'），可多个 */
  kinds?: string[];
  /** 时间过滤：最近 N 分钟内的修改时间（如 1440=今天，10080=近7天，43200=近30天） */
  withinMinutes?: number;
  /** 限定搜索目录（-onlyin，预留；MVP 面板不暴露） */
  onlyin?: string;
  /** 返回条数上限（默认 50，上限 200） */
  limit?: number;
}

/** 搜索结果条目（与 preload 的 FileSearchResult 结构一致） */
export interface FileSearchResult {
  /** 完整路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 文件大小（字节；stat 失败为 0） */
  size: number;
  /** 修改时间（ms 时间戳；stat 失败为 0） */
  mtime: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** mdfind 子进程超时（防挂起） */
const TIMEOUT_MS = 5000;
/** stdout 上限（不支持 -limit 的版本靠进程内截断时，防超量输出撑爆内存；约 10 万条路径） */
const MAX_BUFFER = 8 * 1024 * 1024;

/** 转义 Spotlight 查询字符串中的字面量：\ ' * 需转义，防止用户输入破坏查询结构/通配符语义 */
function escapeSpotlightLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\*/g, '\\*');
}

/**
 * 构造 mdfind 查询字符串（见报告 §1.3）：文件名 + 类型 + 时间 组合。
 * 导出便于单测。示例：
 *   buildMdfindQuery('报告', { kinds: ['public.pdf'], withinMinutes: 10080 })
 *   → kMDItemFSName == '*报告*'c && kMDItemContentTypeTree == 'public.pdf'
 *     && kMDItemFSContentChangeDate >= $time.now(-10080m)
 */
export function buildMdfindQuery(raw: string, opts?: FileSearchOptions): string {
  const parts: string[] = [];
  const kw = String(raw ?? '').trim();
  if (kw) parts.push(`kMDItemFSName == '*${escapeSpotlightLiteral(kw)}*'c`);
  for (const kind of opts?.kinds ?? []) {
    if (kind) parts.push(`kMDItemContentTypeTree == '${escapeSpotlightLiteral(kind)}'`);
  }
  const within = opts?.withinMinutes;
  if (typeof within === 'number' && Number.isFinite(within) && within > 0) {
    parts.push(`kMDItemFSContentChangeDate >= $time.now(-${Math.round(within)}m)`);
  }
  return parts.join(' && ');
}

export class FileSearchService {
  /** -limit 支持状态：null=未探测；探测一次后缓存（本机 macOS 26.3 不支持） */
  private limitSupported: boolean | null = null;

  /**
   * 搜索文件：query 为文件名关键词（支持类型/时间过滤），返回 FileSearchResult[]。
   * 空查询且无过滤条件 → 直接返回 []（避免 mdfind 全量匹配）。
   * 失败（超时/命令不可用/输出超限）→ 抛 Error（IPC 层捕获转为 { ok:false, error }）。
   */
  async search(query: string, opts?: FileSearchOptions): Promise<FileSearchResult[]> {
    const limit = Math.min(Math.max(1, Math.round(opts?.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
    const mdfindQuery = buildMdfindQuery(query, opts);
    if (!mdfindQuery) return [];

    if (process.platform === 'darwin') {
      const useLimit = await this.probeLimitSupport();
      const args: string[] = [mdfindQuery];
      if (useLimit) args.push('-limit', String(limit));
      args.push('-0');
      if (opts?.onlyin) args.push('-onlyin', opts.onlyin);
      const paths = await this.execMdfind(args);
      return this.enrich(paths.slice(0, limit));
    }
    // Windows：预留 Everything es.exe 分支（本机 macOS 不验证，见报告 §1.4）
    return this.searchWindows(query, limit);
  }

  /** 在 Finder/Explorer 中显示文件（跨平台 shell 能力，macOS 等价 open -R；受保护目录内 reveal 无需权限） */
  reveal(path: string): boolean {
    const p = String(path ?? '');
    if (!p) return false;
    try {
      shell.showItemInFolder(p);
      return true;
    } catch (err) {
      console.error('[file-search] reveal 失败:', err);
      return false;
    }
  }

  /**
   * 探测本机 mdfind 是否支持 -limit（探测一次并缓存）。
   * 注意：macOS 26.3 的 mdfind 实测不支持 -limit（"Unknown option -limit"），
   * 部分版本（如报告引用的 ss64 手册）支持——用必然无结果的查询探测，避免探测本身输出大量路径。
   */
  private probeLimitSupport(): Promise<boolean> {
    if (this.limitSupported !== null) return Promise.resolve(this.limitSupported);
    return new Promise((resolve) => {
      const probe = `kMDItemFSName == '*mdfind-limit-probe-${Date.now()}-*'c`;
      execFile('mdfind', [probe, '-limit', '1'], { timeout: 3000 }, (err, stdout, stderr) => {
        // 注意：mdfind 的 "Unknown option -limit" 打到 **stdout**（实测 stderr 为空），
        // 且 execFile 的 err.message 只是 "Command failed: <cmd>" —— 必须拼上 stdout/stderr 才能判定
        const detail = `${err?.message ?? ''} ${stdout ?? ''} ${stderr ?? ''}`;
        this.limitSupported = !err || !/unknown option/i.test(detail);
        resolve(this.limitSupported);
      });
    });
  }

  /** 执行 mdfind（NUL 分隔输出），返回路径数组 */
  private execMdfind(args: string[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      execFile('mdfind', args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (err, stdout) => {
        if (err) {
          reject(this.mapMdfindError(err));
          return;
        }
        // -0：NUL 分隔（末尾有 NUL），split 后过滤空串；路径含换行也安全
        resolve(stdout.split('\0').filter((s) => s.length > 0));
      });
    });
  }

  private mapMdfindError(err: { message?: string; code?: string | number | null; killed?: boolean }): Error {
    if (err.killed) return new Error('搜索超时（mdfind 5s 未响应）');
    if (err.code === 'ENOENT') return new Error('mdfind 不可用（需要 macOS Spotlight）');
    if (typeof err.code === 'string' && err.code.startsWith('ERR_CHILD_PROCESS_STDIO_MAXBUFFER')) {
      return new Error('搜索结果过多，请缩小关键词范围');
    }
    return new Error(`mdfind 失败: ${err.message ?? String(err)}`);
  }

  /** 路径 → 结果对象：fs.stat 补 size/mtime（索引可能过期，stat 失败填 0） */
  private async enrich(paths: string[]): Promise<FileSearchResult[]> {
    return Promise.all(
      paths.map(async (p) => {
        const base = { path: p, name: basename(p) };
        try {
          const st = await stat(p);
          return { ...base, size: st.size, mtime: st.mtimeMs };
        } catch {
          return { ...base, size: 0, mtime: 0 };
        }
      })
    );
  }

  // ---------- Windows 预留分支（本机 macOS 不验证；随包分发 Everything 便携版） ----------

  private searchWindows(keyword: string, limit: number): Promise<FileSearchResult[]> {
    return new Promise((resolve, reject) => {
      // es.exe 候选：随包 resources/es/es.exe → resources/es.exe → 系统 PATH
      const candidates = [
        join(app.getAppPath(), 'resources', 'es', 'es.exe'),
        join(app.getAppPath(), 'resources', 'es.exe'),
        'es.exe'
      ];
      let idx = 0;
      const attempt = (): void => {
        const esPath = candidates[idx];
        if (!esPath) {
          reject(new Error('Windows 文件搜索需要 Everything（es.exe），请随包分发便携版'));
          return;
        }
        idx += 1;
        execFile(
          esPath,
          ['-json', '-sort', 'DateModified', '-search', String(keyword ?? '')],
          { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
          (err, stdout) => {
            if (err) {
              if (err.code === 'ENOENT') return attempt(); // 换下一个候选
              reject(new Error(`Windows 搜索失败: ${err.message ?? String(err)}`));
              return;
            }
            try {
              const parsed = JSON.parse(stdout) as Array<{
                name?: string;
                path?: string;
                size?: number;
                date_modified?: string;
              }>;
              resolve(
                parsed
                  .slice(0, limit)
                  .map((it) => ({
                    path: it.path ?? '',
                    name: it.name ?? basename(it.path ?? ''),
                    size: typeof it.size === 'number' ? it.size : 0,
                    mtime: it.date_modified ? new Date(it.date_modified).getTime() : 0
                  }))
                  .filter((r) => r.path)
              );
            } catch (e) {
              reject(new Error(`Windows 搜索解析失败: ${e instanceof Error ? e.message : String(e)}`));
            }
          }
        );
      };
      attempt();
    });
  }
}
