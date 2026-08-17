/**
 * macOS 平台实现。
 * 差异点：托盘 Template 模板图标；自启走 SMAppService（Electron 自动）；隐藏 Dock。
 */
import { app } from 'electron';
import { join } from 'node:path';
import { ElectronPlatform } from './base';
import type { PetWindow } from '../window/pet-window';

export class DarwinPlatform extends ElectronPlatform {
  override readonly name = 'darwin' as const;

  constructor(petWindow: PetWindow) {
    super(petWindow);
  }

  override dispose(): void {
    super.dispose();
  }

  /** 托盘图标路径（彩色 pichu 头像，44x44=22pt@2x；非 template，浅/深色菜单栏均可见） */
  static trayIconPath(): string {
    return join(app.getAppPath(), 'resources', 'tray.png');
  }
}
