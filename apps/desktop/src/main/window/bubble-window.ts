/**
 * 回复气泡窗口（透明气泡造型，位于桌宠上方）
 *
 * 造型：白色圆角气泡 + 底部小尾巴（指向桌宠），无窗口框感；
 * 高度随内容自适应（向上增长，保持气泡贴近桌宠）；透明窗口不触碰桌宠窗口 → 模型位置不动。
 */
import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

const BUBBLE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: transparent; height: 100%; overflow: hidden; }
  body { font-family: -apple-system, 'PingFang SC', sans-serif; display: flex; align-items: flex-end; padding: 6px; }
  #bubble {
    position: relative;
    max-width: 100%;
    background: rgba(255,255,255,0.97);
    border-radius: 16px;
    padding: 10px 13px;
    font-size: 13px;
    line-height: 1.7;
    color: #333;
    white-space: pre-wrap;
    word-break: break-word;
    box-shadow: 0 3px 14px rgba(0,0,0,0.16);
  }
  /* 底部小尾巴（指向桌宠） */
  #bubble::after {
    content: '';
    position: absolute;
    bottom: -9px;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: rgba(255,255,255,0.97);
  }
  #content.typing::after { content: '▍'; animation: blink 0.8s infinite; color: #e8a04c; }
  @keyframes blink { 50% { opacity: 0; } }
  .error { color: #d33; }
</style>
</head>
<body>
  <div id="bubble"><span id="content"></span></div>
<script>
  const content = document.getElementById('content');
  window.appendText = (t) => {
    content.textContent += t;
    content.classList.add('typing');
  };
  window.finishText = () => content.classList.remove('typing');
  window.setError = (msg) => {
    content.textContent = msg;
    content.classList.remove('typing');
    content.classList.add('error');
  };
  // 返回气泡实际高度（含尾巴），供主进程自适应窗口高度
  window.getBubbleHeight = () =>
    document.getElementById('bubble').getBoundingClientRect().height + 18;
</script>
</body>
</html>`;

let bubbleWin: BrowserWindow | null = null;

/** 获取当前气泡窗口（验证/调试用） */
export function getBubbleWindow(): BrowserWindow | null {
  return bubbleWin;
}

/** 桌宠移动时跟随：按桌宠当前位置重算气泡位置（保持相对位置不变） */
export function moveBubbleWindow(petPos?: { x: number; y: number }): void {
  if (!petPos || !bubbleWin || bubbleWin.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const w = 270;
  const h = bubbleWin.getContentSize()[1] ?? 90;
  // 与 openBubbleWindow 相同的定位逻辑（相对桌宠中心 + 上方）
  let x = petPos.x + 130 - w / 2;
  let y = petPos.y - h - 6;
  if (y < area.y) y = petPos.y + 260 + 8; // 上方放不下则放下方
  x = Math.max(area.x, Math.min(x, area.x + area.width - w));
  bubbleWin.setPosition(Math.round(x), Math.round(y));
}

/** 在桌宠上方打开（或聚焦）气泡窗口 */
export function openBubbleWindow(petPos?: { x: number; y: number }): void {
  if (bubbleWin && !bubbleWin.isDestroyed()) {
    bubbleWin.show();
    bubbleWin.focus();
    return;
  }
  const w = 270;
  const h = 90; // 初始小高度，append 后自适应增长
  const area = screen.getPrimaryDisplay().workArea;
  const baseX = petPos ? petPos.x + 130 : area.x + area.width / 2;
  let x = baseX - w / 2;
  let y = petPos ? petPos.y - h - 6 : area.y + area.height / 2;
  // clamp 屏幕内；上方放不下则放桌宠下方
  if (petPos && y < area.y) y = petPos.y + 260 + 8;
  x = Math.max(area.x, Math.min(x, area.x + area.width - w));

  bubbleWin = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(x),
    y: Math.round(y),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  void bubbleWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(BUBBLE_HTML)}`);
  bubbleWin.on('closed', () => {
    bubbleWin = null;
  });
}

/** 流式追加文本并自适应窗口高度（气泡向上生长，保持贴近桌宠） */
export function appendBubbleText(text: string): void {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  void bubbleWin.webContents
    .executeJavaScript(`window.appendText(${JSON.stringify(text)}); window.getBubbleHeight();`)
    .then((h: unknown) => {
      if (typeof h !== 'number' || !bubbleWin || bubbleWin.isDestroyed()) return;
      const targetH = Math.min(Math.max(Math.round(h), 60), 400); // 上限 400
      const size = bubbleWin.getContentSize();
      const cw = size[0] ?? 270;
      const ch = size[1] ?? 90;
      if (Math.abs(targetH - ch) > 4) {
        const pos = bubbleWin.getPosition();
        const dy = targetH - ch;
        // 保持窗口底部（气泡尾巴贴近桌宠）不动，向上增长
        bubbleWin.setBounds({
          x: pos[0] ?? 0,
          y: (pos[1] ?? 0) - dy,
          width: cw,
          height: targetH
        });
      }
    });
}

/** 回复完成（去掉打字光标） */
export function finishBubbleText(): void {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  void bubbleWin.webContents.executeJavaScript(`window.finishText ? window.finishText() : null`);
}

/** 显示错误 */
export function setBubbleError(msg: string): void {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  void bubbleWin.webContents.executeJavaScript(`window.setError ? window.setError(${JSON.stringify(msg)}) : null`);
}

/** 回复完成后延迟自动关闭 */
export function closeBubbleWindow(delayMs = 8000): void {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  setTimeout(() => {
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.close();
  }, delayMs);
}
