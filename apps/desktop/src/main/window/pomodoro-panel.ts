/**
 * 番茄钟面板窗口（独立普通窗口，可滚动，参考 calendar-panel 范式）。
 * - HTML/CSS/JS 在 resources/pomodoro-panel.html（独立文件，避免字符串转义问题）
 * - 复用桌宠 preload（window.pet.pomodoro*）
 * - 入口：桌宠右键菜单「🍅 番茄钟」→ IPC 'pet:pomodoro:open'
 */
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

let panelWindow: BrowserWindow | null = null;

/** 打开（或聚焦）番茄钟面板 */
export function openPomodoroPanel(): BrowserWindow | null {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return panelWindow;
  }

  panelWindow = new BrowserWindow({
    width: 380,
    height: 460,
    minWidth: 320,
    minHeight: 380,
    title: '🍅 番茄钟',
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
  void panelWindow.loadFile(join(app.getAppPath(), 'resources', 'pomodoro-panel.html'));
  panelWindow.on('closed', () => {
    panelWindow = null;
  });
  return panelWindow;
}

/** 面板是否已打开（供入口判断是否需要聚焦） */
export function isPomodoroPanelOpen(): boolean {
  return !!panelWindow && !panelWindow.isDestroyed();
}
