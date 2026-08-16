/**
 * AI 信息查询助手窗口（完整对话界面 + Markdown 渲染）
 * - 右键桌宠 → 聊天框 打开
 * - HTML/CSS/JS 在 resources/chat-window.html（独立文件，避免字符串转义问题）
 * - 复用桌宠 preload（window.pet.aiChat / onAiChunk）
 */
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

let chatWindow: BrowserWindow | null = null;

/** 打开（或聚焦）信息查询助手窗口 */
export function openChatWindow(petName = '皮丘'): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 360,
    height: 500,
    title: petName + '自习室',
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
  void chatWindow.loadFile(join(app.getAppPath(), 'resources', 'chat-window.html'));
  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}
