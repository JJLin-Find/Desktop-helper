/**
 * Electron 跨平台基类平台实现。
 * 差异点由 darwin/win32 子类覆盖（托盘模板图标、自启机制、通知 AUMID 等）。
 */
import { Tray, Menu, Notification, nativeImage, app } from 'electron';
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

  constructor(petWindow: PetWindow) {
    this.petWindow = petWindow;
    this.tray = this.createTray();
    this.autoLaunch = this.createAutoLaunch();
    this.notifier = this.createNotifier();
    this.windows = this.createWindowManager();
  }

  // ---------- Tray ----------
  protected createTray(): ITray {
    return {
      create: (options: TrayOptions) => {
        const icon = options.icon
          ? nativeImage.createFromPath(options.icon)
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

  dispose(): void {
    this.tray.destroy();
  }
}
