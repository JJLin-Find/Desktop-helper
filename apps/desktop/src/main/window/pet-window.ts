/**
 * 桌宠窗口（PetWindow）：透明、无边框、置顶、可穿透。
 * 参数遵循调研结论（Electron ≥ v42）：
 * transparent + frame:false + alwaysOnTop + skipTaskbar + hasShadow:false + resizable:false
 * + setVisibleOnAllWorkspaces({ visibleOnFullScreen: true })
 */
import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { PetStateMachine, PetStats, type PetState } from '@desktop-helper/core';

export const PET_WINDOW_SIZE = 260;

export class PetWindow {
  private win: BrowserWindow | null = null;
  /** 桌宠状态机（core 纯逻辑，主进程持有） */
  readonly stateMachine = new PetStateMachine();
  /** 桌宠数值（心情/饱腹/好感/精力） */
  readonly stats = new PetStats();

  /** 桌宠窗口移动回调（气泡窗跟随用） */
  onMoved: ((pos: { x: number; y: number }) => void) | null = null;

  create(): void {
    const display = screen.getPrimaryDisplay().workArea;
    const width = PET_WINDOW_SIZE;
    const height = PET_WINDOW_SIZE;

    this.win = new BrowserWindow({
      width,
      height,
      x: display.x + display.width - width - 40,
      y: display.y + display.height - height - 90,
      transparent: true,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // 防失焦冻结：桌宠动画/行为在后台时不被节流
        backgroundThrottling: false
      }
    });

    // 移动事件（拖拽/程序移动）→ 通知（气泡窗跟随）
    this.win.on('move', () => {
      this.onMoved?.(this.getPosition());
    });

    // 所有 Space / 全屏空间可见（macOS/Linux 生效；Electron v42 文档标记为 _macOS_ _Linux_，
    // Windows 实现（views::Widget）为 no-op 且 IsVisibleOnAllWorkspaces 恒 false——显式跳过，
    // 避免调用跨平台歧义 API；Windows 虚拟桌面默认跟随当前桌面即可，见跨平台报告 §4.3）
    if (process.platform !== 'win32') {
      this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    // 创建后聚焦一次（规避 electron#36364：组合设置需先 focus）
    this.win.focus();

    // 状态机转换 → 推送给渲染层展示（debug/后续驱动动画）
    this.stateMachine.onTransition = (t) => {
      this.win?.webContents.send('pet:state', t);
    };

    // 渲染层：dev 模式走 Vite dev server，否则加载打包产物
    if (process.env['ELECTRON_RENDERER_URL']) {
      void this.win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
      void this.win.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  get window(): BrowserWindow | null {
    return this.win;
  }

  show(): void {
    this.win?.show();
    this.win?.focus();
  }

  hide(): void {
    this.win?.hide();
  }

  isVisible(): boolean {
    return this.win?.isVisible() ?? false;
  }

  setAlwaysOnTop(on: boolean): void {
    this.win?.setAlwaysOnTop(on, 'floating');
  }

  /**
   * 点击穿透：默认整窗穿透；forward:true 保留鼠标移动事件转发，
   * 渲染层据此在"鼠标移回桌宠"时恢复交互（Live2D 桌宠标配做法）。
   */
  setClickThrough(on: boolean): void {
    this.win?.setIgnoreMouseEvents(on, { forward: true });
    if (on) {
      this.stateMachine.transition('click-through', 'click-through-on', { force: true });
    } else if (this.stateMachine.current === 'click-through') {
      this.stateMachine.transition('idle', 'click-through-off', { force: true });
    }
  }

  /** 拖拽移动（渲染层 mousemove 增量） */
  moveBy(dx: number, dy: number): void {
    if (!this.win) return;
    const pos = this.win.getPosition();
    this.win.setPosition(Math.round((pos[0] ?? 0) + dx), Math.round((pos[1] ?? 0) + dy));
  }

  getPosition(): { x: number; y: number } {
    const pos = this.win?.getPosition();
    return { x: pos?.[0] ?? 0, y: pos?.[1] ?? 0 };
  }

  /**
   * 动态调整窗口尺寸（气泡对话时扩展高度，结束后恢复）
   * 关键：保持窗口【底部】位置不变（向上扩展），这样锚定底部的模型在屏幕上位置不动。
   */
  setSize(width: number, height: number): void {
    if (!this.win) return;
    const pos = this.win.getPosition();
    const size = this.win.getSize();
    const ch = size[1] ?? 0;
    const dy = Math.round(height) - ch;
    this.win.setBounds({
      x: pos[0] ?? 0,
      y: (pos[1] ?? 0) - dy,
      width: Math.round(width),
      height: Math.round(height)
    });
    // 主动通知渲染层新尺寸（不依赖 DOM resize 事件时序）
    this.win.webContents.send('pet:window-resized', {
      width: Math.round(width),
      height: Math.round(height)
    });
  }

  getState(): PetState {
    return this.stateMachine.current;
  }

  destroy(): void {
    this.stateMachine.onTransition = null;
    this.win?.destroy();
    this.win = null;
  }
}
