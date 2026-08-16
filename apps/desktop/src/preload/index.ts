/**
 * Preload：通过 contextBridge 暴露白名单 API（contextIsolation 开启）。
 * 渲染层只能访问 window.pet.*，其余一律不可达。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { PetTransition, FoodId, PetPart, AIProviderPreset } from '@desktop-helper/core';
import type { PetActionCommand } from '@desktop-helper/platform-api';

export type { PetActionCommand };
export type { PetTransition, FoodId, PetPart, AIProviderPreset };

/** 文件搜索选项（与主进程 services/file-search.service.ts 的 FileSearchOptions 结构一致） */
export interface FileSearchOptions {
  kinds?: string[];
  withinMinutes?: number;
  limit?: number;
}

/** 文件搜索结果（与主进程 FileSearchResult 结构一致） */
export interface FileSearchResult {
  path: string;
  name: string;
  size: number;
  mtime: number;
}

/** 剪贴板历史条目（与主进程 services/clipboard.service.ts 的 ClipboardHistoryItem 结构一致） */
export interface ClipboardHistoryItem {
  id: string;
  kind: 'text' | 'image';
  text?: string;
  imagePath?: string;
  hash: string;
  copiedAt: number;
  isPinned: boolean;
}

/** AI 流式 chunk */
export interface AiChunk {
  text: string;
  done: boolean;
}

/** 日历事件（与主进程 services/calendar.service.ts 的 CalendarEvent 结构一致） */
export interface CalendarEvent {
  id: string;
  title: string;
  startAt: number;
  endAt?: number;
  allDay?: boolean;
  repeatRule?: 'none' | 'daily' | 'weekly' | 'monthly';
  notes?: string;
  remindBeforeMs?: number;
  /** 是否已提醒（面板展示用） */
  reminded?: boolean;
  /** 下一个待提醒的 occurrence startAt（无可排则为 null） */
  nextStartAt?: number | null;
}

/** 新增事件入参（无 id，由主进程生成） */
export interface CalendarEventInput {
  title: string;
  startAt: number;
  endAt?: number;
  allDay?: boolean;
  repeatRule?: 'none' | 'daily' | 'weekly' | 'monthly';
  notes?: string;
  remindBeforeMs?: number;
}

/** 番茄钟状态（与主进程 services/pomodoro.service.ts 的 PomodoroStatus 结构一致） */
export interface PomodoroStatus {
  phase: 'idle' | 'focus' | 'break';
  endAt: number | null;
  remainingMs: number;
  focusMinutes: number;
  breakMinutes: number;
}

export interface PetClickInput {
  x: number;
  y: number;
  hitPart: PetPart | null;
}

export interface PetApi {
  // 基础
  getPlatform(): Promise<string>;
  getState(): Promise<{
    platform: string;
    electron: string;
    node: string;
    petState: string;
    petVisible: boolean;
    debug: boolean;
  }>;
  setClickThrough(on: boolean): Promise<void>;
  dragMove(dx: number, dy: number): Promise<void>;
  getPosition(): Promise<{ x: number; y: number }>;
  /** 动态调整窗口尺寸（气泡对话扩展/恢复） */
  resizeWindow(width: number, height: number): Promise<void>;
  quit(): Promise<void>;
  /** 订阅桌宠状态机转换（返回取消函数） */
  onPetState(cb: (t: PetTransition) => void): () => void;
  /** 订阅动画指令（返回取消函数） */
  onCommand(cb: (cmd: PetActionCommand) => void): () => void;
  // 行为交互
  click(input: PetClickInput): Promise<void>;
  feed(food: FoodId): Promise<void>;
  dragStart(): Promise<void>;
  dragEnd(): Promise<void>;
  userActivity(): Promise<void>;
  setPlayMode(enabled: boolean): Promise<void>;
  foodList(): Promise<FoodId[]>;
  // AI 对话
  aiProviders(): Promise<AIProviderPreset[]>;
  aiConfigGet(): Promise<{
    providerId: string;
    apiKey: string;
    model?: string;
    baseURL?: string;
    systemPrompt?: string;
  }>;
  aiConfigSet(patch: Record<string, unknown>): Promise<unknown>;
  aiChat(message: string, mode?: 'pet' | 'assistant'): Promise<{ ok: boolean; error?: string }>;
  aiClear(): Promise<boolean>;
  /** 订阅 AI 流式回复（返回取消函数） */
  onAiChunk(cb: (chunk: AiChunk) => void): () => void;
  /** 打开 AI 对话窗口 */
  openChat(): Promise<boolean>;
  /** 订阅窗口尺寸变化（气泡扩展时主进程主动推送） */
  onWindowResized(cb: (size: { width: number; height: number }) => void): () => void;
  // 联网搜索
  searchConfigGet(): Promise<{ provider: string; apiKey: string; enabled: boolean } | null>;
  searchConfigSet(patch: Record<string, unknown>): Promise<unknown>;
  // 桌宠名称
  petNameGet(): Promise<string>;
  petNameSet(name: string): Promise<string>;
  /** 隐藏桌宠窗口 */
  hidePet(): Promise<boolean>;
  // 剪贴板历史
  /** 打开剪贴板历史面板（主进程会先同步一次当前剪贴板） */
  clipboardOpen(): Promise<boolean>;
  /** 全量历史列表 */
  clipboardList(): Promise<ClipboardHistoryItem[]>;
  /** 按关键字搜索历史 */
  clipboardSearch(keyword: string): Promise<ClipboardHistoryItem[]>;
  /** 固定/取消固定（返回新状态） */
  clipboardPin(id: string): Promise<boolean>;
  /** 删除条目 */
  clipboardRemove(id: string): Promise<boolean>;
  /** 写回系统剪贴板 */
  clipboardPaste(id: string): Promise<{ ok: boolean; error?: string }>;
  /** 立即同步当前剪贴板入库（返回新增/更新条数） */
  clipboardSync(): Promise<number>;
  /** 常驻监听开关（默认关） */
  clipboardSetConstant(on: boolean): Promise<boolean>;
  // 文件搜索
  /** 打开文件搜索面板（右键菜单入口） */
  fileSearchOpen(): Promise<boolean>;
  /** 按文件名关键词搜索（支持类型/时间过滤）；返回 {ok, error?, results} */
  fileSearch(query: string, opts?: FileSearchOptions): Promise<{
    ok: boolean;
    error?: string;
    results: FileSearchResult[];
  }>;
  /** 在 Finder/Explorer 中显示文件（shell.showItemInFolder） */
  fileSearchReveal(path: string): Promise<boolean>;
  // 日程 / 番茄钟
  /** 打开日程 / 番茄钟面板（右键菜单入口） */
  calendarOpen(): Promise<boolean>;
  /** 事件列表（按下一个提醒时间排序，含提醒状态） */
  calendarList(): Promise<CalendarEvent[]>;
  /** 添加事件；失败时返回 { error } */
  calendarAdd(input: CalendarEventInput): Promise<CalendarEvent | { error: string }>;
  /** 删除事件 */
  calendarRemove(id: string): Promise<boolean>;
  /** 清空全部事件 */
  calendarClear(): Promise<boolean>;
  /** 订阅日程变化（提醒触发/增删改后主进程广播，返回取消函数） */
  onCalendarChanged(cb: () => void): () => void;
  /** 打开番茄钟面板（右键菜单入口） */
  pomodoroOpen(): Promise<boolean>;
  /** 番茄钟开始某阶段（minutes 可选覆盖本次时长，分钟，支持小数） */
  pomodoroStart(phase: 'focus' | 'break', minutes?: number): Promise<PomodoroStatus>;
  /** 番茄钟停止 */
  pomodoroStop(): Promise<PomodoroStatus>;
  /** 番茄钟状态（含剩余毫秒） */
  pomodoroStatus(): Promise<PomodoroStatus>;
  /** 今日专注总分钟数 */
  pomodoroSessionsToday(): Promise<number>;
  /** 订阅番茄钟状态变化（阶段切换后主进程广播，返回取消函数） */
  onPomodoroChanged(cb: () => void): () => void;
}

const api: PetApi = {
  getPlatform: () => ipcRenderer.invoke('pet:get-platform'),
  getState: () => ipcRenderer.invoke('pet:get-state'),
  setClickThrough: (on: boolean) => ipcRenderer.invoke('pet:set-click-through', on),
  dragMove: (dx: number, dy: number) => ipcRenderer.invoke('pet:drag-move', dx, dy),
  getPosition: () => ipcRenderer.invoke('pet:get-position'),
  resizeWindow: (width: number, height: number) => ipcRenderer.invoke('pet:resize-window', width, height),
  quit: () => ipcRenderer.invoke('pet:quit'),
  onPetState: (cb) => {
    const listener = (_e: unknown, t: PetTransition): void => cb(t);
    ipcRenderer.on('pet:state', listener);
    return () => {
      ipcRenderer.removeListener('pet:state', listener);
    };
  },
  onCommand: (cb) => {
    const listener = (_e: unknown, cmd: PetActionCommand): void => cb(cmd);
    ipcRenderer.on('pet:command', listener);
    return () => {
      ipcRenderer.removeListener('pet:command', listener);
    };
  },
  click: (input: PetClickInput) => ipcRenderer.invoke('pet:click', input),
  feed: (food: FoodId) => ipcRenderer.invoke('pet:feed', food),
  dragStart: () => ipcRenderer.invoke('pet:drag-start'),
  dragEnd: () => ipcRenderer.invoke('pet:drag-end'),
  userActivity: () => ipcRenderer.invoke('pet:user-activity'),
  setPlayMode: (enabled: boolean) => ipcRenderer.invoke('pet:set-play-mode', enabled),
  foodList: () => ipcRenderer.invoke('pet:food-list'),
  aiProviders: () => ipcRenderer.invoke('pet:ai:providers'),
  aiConfigGet: () => ipcRenderer.invoke('pet:ai:config-get'),
  aiConfigSet: (patch: Record<string, unknown>) => ipcRenderer.invoke('pet:ai:config-set', patch),
  aiChat: (message: string, mode?: string) => ipcRenderer.invoke('pet:ai:chat', message, mode),
  aiClear: () => ipcRenderer.invoke('pet:ai:clear'),
  openChat: () => ipcRenderer.invoke('pet:chat-open'),
  onWindowResized: (cb) => {
    const listener = (_e: unknown, size: { width: number; height: number }): void => cb(size);
    ipcRenderer.on('pet:window-resized', listener);
    return () => {
      ipcRenderer.removeListener('pet:window-resized', listener);
    };
  },
  searchConfigGet: () => ipcRenderer.invoke('pet:search:config-get'),
  searchConfigSet: (patch: Record<string, unknown>) => ipcRenderer.invoke('pet:search:config-set', patch),
  petNameGet: () => ipcRenderer.invoke('pet:pet-name-get'),
  petNameSet: (name: string) => ipcRenderer.invoke('pet:pet-name-set', name),
  hidePet: () => ipcRenderer.invoke('pet:hide-pet'),
  clipboardOpen: () => ipcRenderer.invoke('pet:clipboard:open'),
  clipboardList: () => ipcRenderer.invoke('pet:clipboard:list'),
  clipboardSearch: (keyword: string) => ipcRenderer.invoke('pet:clipboard:search', keyword),
  clipboardPin: (id: string) => ipcRenderer.invoke('pet:clipboard:pin', id),
  clipboardRemove: (id: string) => ipcRenderer.invoke('pet:clipboard:remove', id),
  clipboardPaste: (id: string) => ipcRenderer.invoke('pet:clipboard:paste', id),
  clipboardSync: () => ipcRenderer.invoke('pet:clipboard:sync'),
  clipboardSetConstant: (on: boolean) => ipcRenderer.invoke('pet:clipboard:set-constant', on),
  fileSearchOpen: () => ipcRenderer.invoke('pet:file-search:open'),
  fileSearch: (query: string, opts?: FileSearchOptions) =>
    ipcRenderer.invoke('pet:file-search:search', query, opts),
  fileSearchReveal: (path: string) => ipcRenderer.invoke('pet:file-search:reveal', path),
  calendarOpen: () => ipcRenderer.invoke('pet:calendar:open'),
  calendarList: () => ipcRenderer.invoke('pet:calendar:list'),
  calendarAdd: (input: CalendarEventInput) => ipcRenderer.invoke('pet:calendar:add', input),
  calendarRemove: (id: string) => ipcRenderer.invoke('pet:calendar:remove', id),
  calendarClear: () => ipcRenderer.invoke('pet:calendar:clear'),
  onCalendarChanged: (cb) => {
    const listener = (): void => cb();
    ipcRenderer.on('pet:calendar:changed', listener);
    return () => {
      ipcRenderer.removeListener('pet:calendar:changed', listener);
    };
  },
  pomodoroOpen: () => ipcRenderer.invoke('pet:pomodoro:open'),
  pomodoroStart: (phase: 'focus' | 'break', minutes?: number) =>
    ipcRenderer.invoke('pet:pomodoro:start', phase, minutes),
  pomodoroStop: () => ipcRenderer.invoke('pet:pomodoro:stop'),
  pomodoroStatus: () => ipcRenderer.invoke('pet:pomodoro:status'),
  pomodoroSessionsToday: () => ipcRenderer.invoke('pet:pomodoro:sessions-today'),
  onPomodoroChanged: (cb) => {
    const listener = (): void => cb();
    ipcRenderer.on('pet:pomodoro:changed', listener);
    return () => {
      ipcRenderer.removeListener('pet:pomodoro:changed', listener);
    };
  },
  onAiChunk: (cb) => {
    const listener = (_e: unknown, chunk: AiChunk): void => cb(chunk);
    ipcRenderer.on('pet:ai:chunk', listener);
    return () => {
      ipcRenderer.removeListener('pet:ai:chunk', listener);
    };
  }
};

contextBridge.exposeInMainWorld('pet', api);
