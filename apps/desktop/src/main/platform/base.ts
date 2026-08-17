/**
 * Electron 跨平台基类平台实现。
 * 差异点由 darwin/win32 子类覆盖（托盘模板图标、自启机制、通知 AUMID 等）。
 */
import { Tray, Menu, Notification, nativeImage, app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IAutoLaunch,
  IClipboardWatcher,
  INotifier,
  IPlatform,
  ITray,
  IWindowManager,
  MenuItem,
  PetNotification,
  PlatformName,
  TrayOptions
} from '@desktop-helper/platform-api';
import type { PetWindow } from '../window/pet-window';

export abstract class ElectronPlatform implements IPlatform {
  abstract readonly name: PlatformName;

  readonly tray: ITray;
  readonly autoLaunch: IAutoLaunch;
  readonly notifier: INotifier;
  readonly windows: IWindowManager;

  protected readonly petWindow: PetWindow;
  protected trayImpl: Tray | null = null;
  /** 托盘动画定时器（呼吸帧循环） */
  protected trayAnimTimer: NodeJS.Timeout | null = null;

  constructor(petWindow: PetWindow) {
    this.petWindow = petWindow;
    this.tray = this.createTray();
    this.autoLaunch = this.createAutoLaunch();
    this.notifier = this.createNotifier();
    this.windows = this.createWindowManager();
  }

  // ---------- Tray ----------
  /**
   * 加载托盘图标：@1x 基准图 + 自动探测同目录 `@2x` 变体组合成多分辨率 NativeImage。
   * 关键：macOS 菜单栏高 22pt，若只传单张 44px PNG 会被系统当作 44pt 渲染（溢出任务栏）。
   * 提供 22x22(@1x) + 44x44(@2x) 才能正确显示为 22pt 且 Retina 清晰。
   */
  protected loadTrayImage(basePath: string): Electron.NativeImage {
    const img = nativeImage.createEmpty();
    img.addRepresentation({ scaleFactor: 1, buffer: readFileSync(basePath) });
    const retina = basePath.replace(/\.png$/i, '@2x.png');
    if (existsSync(retina)) img.addRepresentation({ scaleFactor: 2, buffer: readFileSync(retina) });
    return img;
  }

  protected createTray(): ITray {
    return {
      create: (options: TrayOptions) => {
        const icon = options.icon
          ? this.loadTrayImage(options.icon)
          : nativeImage.createEmpty();
        if (options.iconAsTemplate) icon.setTemplateImage(true);
        this.trayImpl = new Tray(icon);
        this.trayImpl.setToolTip(options.tooltip ?? '桌面宠物助手');
      },
      setTooltip: (t: string) => this.trayImpl?.setToolTip(t),
      updateMenu: (items: MenuItem[]) => {
        if (!this.trayImpl) return;
        this.trayImpl.setContextMenu(this.buildMenu(items));
      },
      destroy: () => {
        this.trayImpl?.destroy();
        this.trayImpl = null;
      },
      onClick: (cb: () => void) => {
        // macOS：设置了 context menu 后左键自动弹菜单；Windows：左键触发 click。
        // P0 统一挂 click 回调（Windows 生效；macOS 以菜单为准）。
        this.trayImpl?.on('click', cb);
      }
    };
  }

  protected buildMenu(items: MenuItem[]): Menu {
    const map = (list: MenuItem[]): Electron.MenuItemConstructorOptions[] =>
      list.map((item) =>
        item.type === 'separator'
          ? { type: 'separator' }
          : {
              id: item.id,
              label: item.label,
              type: item.type ?? 'normal',
              checked: item.checked,
              enabled: item.enabled,
              click: item.click,
              submenu: item.submenu ? map(item.submenu) : undefined
            }
      );
    return Menu.buildFromTemplate(map(items));
  }

  // ---------- AutoLaunch ----------
  protected createAutoLaunch(): IAutoLaunch {
    return {
      isEnabled: async () => {
        if (process.platform === 'darwin') {
          return app.getLoginItemSettings().openAtLogin;
        }
        return app.getLoginItemSettings().executableWillLaunchAtLogin;
      },
      enable: async () => {
        // macOS 13+：Electron 24+ 自动走 SMAppService（mainAppService）。
        // 注意：真实设备上要求已签名+公证，否则登录项不生效（调研红线）。
        app.setLoginItemSettings({
          openAtLogin: true,
          openAsHidden: true
        });
      },
      disable: async () => {
        app.setLoginItemSettings({ openAtLogin: false });
      }
    };
  }

  // ---------- Notifier ----------
  protected createNotifier(): INotifier {
    return {
      requestPermission: async () => {
        // macOS/Windows 的 Electron Notification 由系统统一管理；
        // macOS 首次通知会触发系统授权弹窗。
        return Notification.isSupported() ? 'granted' : 'denied';
      },
      show: async (n: PetNotification) => {
        new Notification({ title: n.title, body: n.body, icon: n.icon }).show();
      },
      onClick: (cb) => {
        // 点击回调：由具体通知实例触发，P0 提供全局注册钩子
        (Notification as unknown as { __petClick?: (n: PetNotification) => void }).__petClick = cb;
      }
    };
  }

  // ---------- WindowManager ----------
  protected createWindowManager(): IWindowManager {
    return {
      showPet: () => this.petWindow.show(),
      hidePet: () => this.petWindow.hide(),
      setAlwaysOnTop: (on: boolean) => this.petWindow.setAlwaysOnTop(on),
      setClickThrough: (on: boolean) => this.petWindow.setClickThrough(on),
      isPetVisible: () => this.petWindow.isVisible()
    };
  }

  /** 子类可提供剪贴板监听（P0 可选） */
  get clipboard(): IClipboardWatcher | undefined {
    return undefined;
  }

  /**
   * 托盘动画：循环切换 tray-anim/frame-0..N.png（生成自 Live2D 呼吸动画帧），
   * 实现动态托盘图标。帧 < 2 时不启动。
   */
  startTrayAnimation(framesDir: string, intervalMs = 300): void {
    if (!this.trayImpl || this.trayAnimTimer) return;
    const frames: Electron.NativeImage[] = [];
    for (let i = 0; ; i++) {
      const p = join(framesDir, `frame-${i}.png`);
      if (!existsSync(p)) break;
      frames.push(this.loadTrayImage(p));
    }
    if (frames.length < 2) return;
    let idx = 0;
    this.trayAnimTimer = setInterval(() => {
      idx = (idx + 1) % frames.length;
      const frame = frames[idx];
      if (frame) this.trayImpl?.setImage(frame);
    }, intervalMs);
    console.log(`[platform] 托盘动画已启动（${frames.length} 帧，${intervalMs}ms/帧）`);
  }

  dispose(): void {
    if (this.trayAnimTimer) {
      clearInterval(this.trayAnimTimer);
      this.trayAnimTimer = null;
    }
    this.tray.destroy();
  }
}
