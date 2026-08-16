/**
 * 平台无关的共享类型（IPC 协议、领域对象）。
 * 仅类型定义，无运行时逻辑。
 */

export type PlatformName = 'darwin' | 'win32';

/** 托盘菜单项 */
export interface MenuItem {
  id: string;
  /** separator 类型可省略 label */
  label?: string;
  type?: 'normal' | 'separator' | 'checkbox' | 'radio';
  checked?: boolean;
  enabled?: boolean;
  submenu?: MenuItem[];
  /** 注意：click 回调含函数，跨进程时需替换为菜单事件 id */
  click?: () => void;
}

export interface TrayOptions {
  /** 图标路径（macOS 建议 Template 命名） */
  icon?: string;
  tooltip?: string;
  /** macOS 模板图标（自动适配深色模式） */
  iconAsTemplate?: boolean;
}

/** 系统通知 */
export interface PetNotification {
  title: string;
  body: string;
  icon?: string;
  /** 透传数据（点击通知回调时回传） */
  data?: unknown;
}

/** 剪贴板历史条目 */
export interface ClipboardItem {
  id: string;
  kind: 'text' | 'html' | 'image' | 'file';
  text?: string;
  html?: string;
  imagePath?: string;
  filePaths?: string[];
  hash: string;
  sourceApp?: string;
  copiedAt: number;
  isPinned?: boolean;
}

/** 剪贴板条目输入（监听器产生，尚未入库） */
export interface ClipboardItemInput {
  kind: ClipboardItem['kind'];
  text?: string;
  html?: string;
  imageData?: Buffer;
  filePaths?: string[];
}

/** 文件搜索结果 */
export interface FileSearchResult {
  path: string;
  name: string;
  kind?: string;
  size?: number;
  mtime?: number;
}

/** 日程事件（本地存储模型，MVP） */
export interface CalendarEvent {
  id: string;
  title: string;
  startAt: number;
  endAt?: number;
  allDay?: boolean;
  repeatRule?: 'none' | 'daily' | 'weekly' | 'monthly';
  notes?: string;
  remindBeforeMs?: number;
}

/** 主进程行为控制器推送给渲染层的动画指令（跨进程共享类型） */
export interface PetActionCommand {
  /** 动作 key（与 docs/design-pet-interactions.md 动画资产映射表一致） */
  action: string;
  oneShot?: boolean;
  durationMs?: number;
  /** 气泡文案 */
  bubble?: string;
  /** 当前心情 */
  mood?: 'happy' | 'calm' | 'sad' | 'angry';
}
