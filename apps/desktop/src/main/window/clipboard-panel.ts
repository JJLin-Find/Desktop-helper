/**
 * 剪贴板历史面板窗口（独立普通窗口，可滚动，参考 chat-window 范式）。
 * - HTML/CSS/JS 在 resources/clipboard-panel.html（独立文件，避免字符串转义问题）
 * - 复用桌宠 preload（window.pet.clipboard*）
 * - 打开面板 = 用户在场交互 → 由 IPC 'pet:clipboard:open' 先 syncNow 一次（macOS 26 隐私安全）
 */
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

let panelWindow: BrowserWindow | null = null;

/** 打开（或聚焦）剪贴板历史面板 */
export function openClipboardPanel(): BrowserWindow | null {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return panelWindow;
  }

  panelWindow = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 320,
    minHeight: 360,
    title: '📋 剪贴板历史',
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
  void panelWindow.loadFile(join(app.getAppPath(), 'resources', 'clipboard-panel.html'));
  panelWindow.on('closed', () => {
    panelWindow = null;
  });
  return panelWindow;
}

/** 面板是否已打开（供入口判断是否需要聚焦/同步） */
export function isClipboardPanelOpen(): boolean {
  return !!panelWindow && !panelWindow.isDestroyed();
}
