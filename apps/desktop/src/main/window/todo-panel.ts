/**
 * 待办清单面板窗口（独立普通窗口，参考 calendar-panel 范式）。
 * - HTML/CSS/JS 在 resources/todo-panel.html（独立文件，避免字符串转义问题）
 * - 复用桌宠 preload（window.pet.todo*）
 * - 入口：桌宠右键菜单「✅ 待办清单」→ IPC 'pet:todo:open'
 */
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

let panelWindow: BrowserWindow | null = null;

/** 打开（或聚焦）待办清单面板 */
export function openTodoPanel(): BrowserWindow | null {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return panelWindow;
  }

  panelWindow = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 360,
    minHeight: 480,
    title: '✅ 待办清单',
    resizable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  void panelWindow.loadFile(join(app.getAppPath(), 'resources', 'todo-panel.html'));
  panelWindow.on('closed', () => {
    panelWindow = null;
  });
  return panelWindow;
}

/** 面板是否已打开（供入口判断是否需要聚焦） */
export function isTodoPanelOpen(): boolean {
  return !!panelWindow && !panelWindow.isDestroyed();
}
