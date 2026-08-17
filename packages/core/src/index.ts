/**
 * @desktop-helper/core — 平台无关的纯 TS 核心
 *
 * 约束：本包不得 import 任何平台 API（Electron / DOM / Node 专属模块），
 * 以保证可在主进程、渲染层、测试环境复用。
 */

export * from './event-bus';
export * from './scheduler';
export * from './pet-state-machine';
export * from './pet-stats';
export * from './pet-behavior';
export * from './ai-client';
export * from './todo';
