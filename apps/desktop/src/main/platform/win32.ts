/**
 * Windows 平台实现。
 *
 * 差异点（相对 macOS，见 docs/report-desktop-pet-cross-platform.md §1/§2/§3）：
 * - Windows toast 通知前置条件：启动时设置 AppUserModelID（AUMID）——
 *   必须与 electron-builder `appId` 一致（com.desktophelper.pet）：
 *   NSIS 安装器会创建带该 AUMID 的开始菜单快捷方式，通知才能显示；
 *   开发模式需"开始菜单快捷方式 + AUMID"两条件（见报告 §3.1，待实机验证）。
 * - 托盘图标：Windows 用普通彩色 png/ico（**非 template**；template 仅 macOS 生效）。
 *   复用 resources/icon.png（app 彩色图标，浅/深色任务栏均可见；
 *   trayTemplate.png 是纯黑+alpha 的 macOS 模板图，在 Windows 深色任务栏上几乎不可见）。
 * - 其余（Tray/Notification/setLoginItemSettings 注册表 Run 键/skipTaskbar 最小化到托盘）
 *   Electron 跨平台 API 已覆盖，直接继承基类，无需重写。
 */
import { app } from 'electron';
import { join } from 'node:path';
import { ElectronPlatform } from './base';
import type { PetWindow } from '../window/pet-window';

export class Win32Platform extends ElectronPlatform {
  override readonly name = 'win32' as const;

  constructor(petWindow: PetWindow) {
    super(petWindow);
    // Windows toast 通知前置条件：进程级 AUMID。
    // 本构造在 createPlatform()（index.ts bootstrap）内执行，早于：
    //   - platform.tray.create()（托盘）
    //   - calendar/pomodoro 的 new Notification().show()（提醒 toast）
    // 因此任意通知显示前 AUMID 已生效。
    app.setAppUserModelId('com.desktophelper.pet');
  }

  /** 托盘图标路径：彩色 pichu 头像（44x44；非 template，浅/深色任务栏均可见） */
  static trayIconPath(): string {
    return join(app.getAppPath(), 'resources', 'tray.png');
  }
}
