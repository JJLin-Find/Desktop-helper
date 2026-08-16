/**
 * 平台工厂：按运行平台注入具体实现。
 * core / platform-api 只依赖接口，Windows 阶段只需补 win32 实现。
 */
import type { IPlatform } from '@desktop-helper/platform-api';
import type { PetWindow } from '../window/pet-window';
import { DarwinPlatform } from './darwin';
import { Win32Platform } from './win32';

export function createPlatform(petWindow: PetWindow): IPlatform {
  if (process.platform === 'darwin') {
    return new DarwinPlatform(petWindow);
  }
  if (process.platform === 'win32') {
    return new Win32Platform(petWindow);
  }
  throw new Error(`[platform] 暂不支持平台: ${process.platform}`);
}
