/**
 * 平台抽象接口。
 *
 * 核心原则（来自调研）：core 只依赖这些接口类型，反向依赖禁止；
 * 宿主在启动时通过 createPlatform() 工厂注入具体实现（darwin / win32）。
 */

import type {
  ClipboardItemInput,
  MenuItem,
  PetNotification,
  PlatformName,
  TrayOptions,
} from './types';

export interface ITray {
  create(options: TrayOptions): void;
  setTooltip(tooltip: string): void;
  /** 全量更新菜单（macOS 模板图标由实现处理） */
  updateMenu(items: MenuItem[]): void;
  destroy(): void;
  /** 托盘图标点击（macOS 左键 / Windows 左键） */
  onClick(callback: () => void): void;
  /** 运行时替换图标（PNG dataURL；用于"直接用系统 emoji 渲染托盘图标"） */
  setIcon?(dataUrl: string): void;
}

export interface IAutoLaunch {
  isEnabled(): Promise<boolean>;
  enable(): Promise<void>;
  disable(): Promise<void>;
}

export interface INotifier {
  requestPermission(): Promise<'granted' | 'denied'>;
  show(notification: PetNotification): Promise<void>;
  /** 通知点击回调 */
  onClick(callback: (notification: PetNotification) => void): void;
}

export interface IWindowManager {
  /** 显示/聚焦桌宠窗口 */
  showPet(): void;
  hidePet(): void;
  setAlwaysOnTop(on: boolean): void;
  /** 点击穿透（macOS 无 forward 时由实现自行处理） */
  setClickThrough(on: boolean): void;
  /** 桌宠窗口是否可见 */
  isPetVisible(): boolean;
}

export interface IClipboardWatcher {
  start(options?: { intervalMs?: number }): void;
  stop(): void;
  /** 监听剪贴板产生新条目 */
  onItem(callback: (item: ClipboardItemInput) => void): void;
  /** 立即读取当前剪贴板（用于"交互时同步"策略） */
  syncNow(): ClipboardItemInput | null;
}

export interface IFileSearch {
  /** 按文件名/元数据搜索（macOS mdfind / Windows es.exe） */
  search(query: string, options?: { limit?: number; dir?: string }): Promise<unknown[]>;
  /** 在文件管理器中显示（open -R / explorer /select,） */
  revealInFolder(path: string): Promise<void>;
}

export interface IPlatform {
  readonly name: PlatformName;
  tray: ITray;
  autoLaunch: IAutoLaunch;
  notifier: INotifier;
  windows: IWindowManager;
  clipboard?: IClipboardWatcher;
  fileSearch?: IFileSearch;
  /** 托盘动画（呼吸帧循环，tray-anim/frame-0..N.png）；帧资源不存在时静默不启动 */
  startTrayAnimation?(framesDir: string, intervalMs?: number): void;
  /** 用运行时渲染的帧（PNG dataURL 数组）启动托盘呼吸动画；帧 < 2 时不启动 */
  startTrayAnimationFromDataUrls?(dataUrls: string[], intervalMs?: number): void;
}
