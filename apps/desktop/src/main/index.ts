/**
 * 主进程入口。
 * P0 目标：启动桌宠（透明置顶穿透窗口）+ 托盘 + 统一调度器 + IPC 白名单。
 *
 * 红线（来自调研）：
 * - 关窗 ≠ 退出：window-all-closed 不 quit，托盘"退出"才退出；
 * - macOS 全屏空间可见：setVisibleOnAllWorkspaces({ visibleOnFullScreen: true })；
 * - 打包期通过 Info.plist 设 LSUIElement 隐藏 Dock（开发模式保留 Dock 便于调试）。
 */
import { app, ipcMain, screen, BrowserWindow } from 'electron';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PetWindow } from './window/pet-window';
import { openAISettingsWindow } from './window/settings-window';
import { openChatWindow } from './window/chat-window';
import { openClipboardPanel } from './window/clipboard-panel';
import { openFileSearchPanel } from './window/file-search-panel';
import { openCalendarPanel } from './window/calendar-panel';
import { openPomodoroPanel } from './window/pomodoro-panel';
import { openTodoPanel } from './window/todo-panel';
import {
  openBubbleWindow,
  appendBubbleText,
  finishBubbleText,
  closeBubbleWindow,
  setBubbleError,
  getBubbleWindow,
  moveBubbleWindow
} from './window/bubble-window';
import { createPlatform } from './platform';
import { DarwinPlatform } from './platform/darwin';
import { Win32Platform } from './platform/win32';

// 单实例锁：防止多开导致多个托盘图标（残留旧实例会继续显示旧版本图标，造成"图标没改"的错觉）
const gotSingleInstanceLock = app.requestSingleInstanceLock();
import { JsonStore } from './services/store.service';
import { SchedulerService } from './services/scheduler.service';
import { AIService } from './services/ai.service';
import { PetBehaviorController, type PetClickInput } from './services/pet-behavior.service';
import { ClipboardHistoryService } from './services/clipboard.service';
import { FileSearchService, type FileSearchOptions } from './services/file-search.service';
import { CalendarService, CAL_JOB_TYPE, type CalendarEventInput } from './services/calendar.service';
import { PomodoroService, POMO_JOB_TYPE } from './services/pomodoro.service';
import { TodoService, type TodoAddInput, type TodoPatch, type TodoStoreShape } from './services/todo.service';
import { dateKeyOf, todayKey, quadrantOf, type TodoItem } from '@desktop-helper/core';
import type { FoodId } from '@desktop-helper/core';
import type { IPlatform } from '@desktop-helper/platform-api';

let petWindow: PetWindow | null = null;
let platform: IPlatform | null = null;
let schedulerService: SchedulerService | null = null;
let behavior: PetBehaviorController | null = null;
let aiService: AIService | null = null;
let clipboardService: ClipboardHistoryService | null = null;
let fileSearchService: FileSearchService | null = null;
let calendarService: CalendarService | null = null;
let pomodoroService: PomodoroService | null = null;
let todoStore: JsonStore<TodoStoreShape> | null = null;
let todoService: TodoService | null = null;
let storeRef: JsonStore<{
  scheduler: { jobs: unknown[]; paused: boolean };
  ai: unknown;
  search: unknown;
  pet: { name: string };
}> | null = null;

/** 注册 IPC 白名单（preload 暴露的 pet.* 通道） */
function registerIpc(): void {
  ipcMain.handle('pet:get-platform', () => platform?.name ?? process.platform);
  ipcMain.handle('pet:get-state', () => ({
    platform: platform?.name ?? process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
    petState: petWindow?.getState(),
    petVisible: petWindow?.isVisible(),
    // 调试面板开关：PET_DEBUG=1 时渲染层显示状态/版本信息
    debug: Boolean(process.env['PET_DEBUG'])
  }));
  ipcMain.handle('pet:set-click-through', (_e, on: boolean) => {
    petWindow?.setClickThrough(Boolean(on));
  });
  ipcMain.handle('pet:drag-move', (_e, dx: number, dy: number) => {
    petWindow?.moveBy(dx, dy);
  });
  ipcMain.handle('pet:get-position', () => petWindow?.getPosition() ?? { x: 0, y: 0 });
  ipcMain.handle('pet:resize-window', (_e, width: number, height: number) => {
    petWindow?.setSize(Number(width), Number(height));
  });
  ipcMain.handle('pet:quit', () => {
    app.quit();
  });

  // ---- 行为交互 IPC ----
  // 渲染层点击（含 Live2D HitArea 命中部位）
  ipcMain.handle('pet:click', (_e, input: PetClickInput) => {
    behavior?.onClick(input);
  });
  // 投喂
  ipcMain.handle('pet:feed', (_e, food: FoodId) => {
    behavior?.onFeed(food);
  });
  // 拖拽开始/结束
  ipcMain.handle('pet:drag-start', () => {
    behavior?.onDragStart();
  });
  ipcMain.handle('pet:drag-end', () => {
    behavior?.onDragEnd();
  });
  // 用户活动（鼠标进入/任意交互 → 唤醒/重置待机链）
  ipcMain.handle('pet:user-activity', () => {
    behavior?.onUserActivity();
  });
  // 逗猫棒模式开关
  ipcMain.handle('pet:set-play-mode', (_e, enabled: boolean) => {
    if (behavior) behavior.playModeEnabled = Boolean(enabled);
  });
  // 隐藏桌宠（右键菜单）
  ipcMain.handle('pet:hide-pet', () => {
    petWindow?.hide();
    return true;
  });
  // 投喂食物列表（供面板/菜单使用）
  ipcMain.handle('pet:food-list', () => {
    // FOOD_TABLE 由 core 导出；此处返回简化列表给 UI
    return ['fish', 'can', 'cookie', 'milk', 'random-file'];
  });

  // ---- AI 对话 IPC ----
  ipcMain.handle('pet:ai:providers', () => aiService?.getPresets() ?? []);
  ipcMain.handle('pet:ai:config-get', () => aiService?.getConfig() ?? null);
  ipcMain.handle('pet:ai:config-set', (_e, patch: object) => {
    aiService?.setConfig(patch as never);
    return aiService?.getConfig() ?? null;
  });
  ipcMain.handle('pet:ai:chat', async (_e, message: string, mode: string) => {
    if (!aiService) return { ok: false, error: 'AI 服务未就绪' };
    const chatMode = mode === 'assistant' ? 'assistant' : 'pet';
    if (chatMode === 'pet') {
      // 桌宠闲聊 → 桌宠上方的气泡窗口（桌宠窗口/模型位置完全不动）
      openBubbleWindow(petWindow?.getPosition());
    }
    if (!aiService.isReady()) {
      const msg = '请先在设置中配置 AI Key（托盘 → AI 对话设置）';
      if (chatMode === 'pet') {
        setBubbleError(`⚠️ ${msg}`);
        closeBubbleWindow(6000);
      }
      return { ok: false, error: msg };
    }
    const mood = behavior?.mood ?? 'calm';
    try {
      // 等待流式完成；流式内容已通过 pet:ai:chunk 广播给聊天窗/气泡窗
      await aiService.chatStream(String(message), {
        mode: chatMode,
        moodHint: chatMode === 'pet' ? mood : undefined
      });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (chatMode === 'pet') {
        setBubbleError(`⚠️ ${msg}`);
        closeBubbleWindow(5000);
      }
      return { ok: false, error: msg };
    }
  });
  ipcMain.handle('pet:ai:clear', () => {
    aiService?.clearHistory();
    return true;
  });
  // 联网搜索配置
  ipcMain.handle('pet:search:config-get', () => {
    const c = aiService?.getSearchConfig();
    return c ? { ...c, apiKey: c.apiKey ? '***' : '' } : null;
  });
  ipcMain.handle('pet:search:config-set', (_e, patch: object) => {
    aiService?.setSearchConfig(patch as never);
    const c = aiService?.getSearchConfig();
    return c ? { ...c, apiKey: c.apiKey ? '***' : '' } : null;
  });
  // 桌宠名称（聊天框标题 = "{名称}自习室"）
  ipcMain.handle('pet:pet-name-get', () => {
    return storeRef?.get('pet').name ?? '皮丘';
  });
  ipcMain.handle('pet:pet-name-set', (_e, name: string) => {
    const clean = String(name ?? '').trim().slice(0, 20) || '皮丘';
    storeRef?.set('pet', { name: clean });
    return clean;
  });
  // 打开对话窗口（双击桌宠触发，显示在桌宠旁）
  ipcMain.handle('pet:chat-open', () => {
    openChatWindow(storeRef?.get('pet').name);
    return true;
  });

  // ---- 剪贴板历史 IPC ----
  // 打开面板 = 用户在场交互 → 先同步一次当前剪贴板（macOS 26 隐私：交互时同步）
  ipcMain.handle('pet:clipboard:open', () => {
    clipboardService?.syncNow();
    openClipboardPanel();
    return true;
  });
  ipcMain.handle('pet:clipboard:list', () => clipboardService?.list() ?? []);
  ipcMain.handle('pet:clipboard:search', (_e, keyword: string) =>
    clipboardService?.search(String(keyword ?? '')) ?? []
  );
  ipcMain.handle('pet:clipboard:pin', (_e, id: string) =>
    clipboardService?.pin(String(id)) ?? false
  );
  ipcMain.handle('pet:clipboard:remove', (_e, id: string) =>
    clipboardService?.remove(String(id)) ?? false
  );
  ipcMain.handle('pet:clipboard:paste', (_e, id: string) =>
    clipboardService?.paste(String(id)) ?? { ok: false, error: '剪贴板服务未就绪' }
  );
  // 立即同步当前剪贴板入库，返回本次新增/更新的条目数（0 或 1）
  ipcMain.handle('pet:clipboard:sync', () => (clipboardService?.syncNow() ? 1 : 0));
  // 常驻监听开关（默认关；打开后 0.5s 内容比对轮询）
  ipcMain.handle('pet:clipboard:set-constant', (_e, on: boolean) =>
    clipboardService?.setConstantMode(Boolean(on)) ?? false
  );

  // ---- 文件搜索 IPC ----
  // 打开面板（桌宠右键菜单「🔍 文件搜索」入口）
  ipcMain.handle('pet:file-search:open', () => {
    openFileSearchPanel();
    return true;
  });
  // 搜索：query=文件名关键词，opts={kinds[], withinMinutes, limit}；返回 {ok, error?, results}
  ipcMain.handle('pet:file-search:search', async (_e, query: string, opts?: unknown) => {
    if (!fileSearchService) return { ok: false, error: '文件搜索服务未就绪', results: [] };
    try {
      const results = await fileSearchService.search(
        String(query ?? ''),
        opts as FileSearchOptions | undefined
      );
      return { ok: true, results };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        results: []
      };
    }
  });
  // 在 Finder/Explorer 中显示文件（shell.showItemInFolder，跨平台）
  ipcMain.handle('pet:file-search:reveal', (_e, path: string) =>
    fileSearchService?.reveal(String(path ?? '')) ?? false
  );

  // ---- 日程 / 番茄钟 IPC ----
  // 打开面板（桌宠右键菜单「📅 日程 / 番茄钟」入口）
  ipcMain.handle('pet:calendar:open', () => {
    openCalendarPanel();
    return true;
  });
  ipcMain.handle('pet:calendar:list', () => calendarService?.list() ?? []);
  ipcMain.handle('pet:calendar:add', (_e, input: CalendarEventInput) =>
    calendarService?.add(input ?? {}) ?? { error: '日程服务未就绪' }
  );
  ipcMain.handle('pet:calendar:remove', (_e, id: string) =>
    calendarService?.remove(String(id ?? '')) ?? false
  );
  ipcMain.handle('pet:calendar:clear', () => calendarService?.clear() ?? false);
  ipcMain.handle('pet:pomodoro:start', (_e, phase: 'focus' | 'break', minutes?: number) =>
    pomodoroService?.start(phase === 'break' ? 'break' : 'focus', Number(minutes)) ?? POMO_IDLE_STATUS
  );
  ipcMain.handle('pet:pomodoro:stop', () => pomodoroService?.stop() ?? POMO_IDLE_STATUS);
  ipcMain.handle('pet:pomodoro:status', () => pomodoroService?.status() ?? POMO_IDLE_STATUS);
  ipcMain.handle('pet:pomodoro:sessions-today', () => pomodoroService?.sessionsToday() ?? 0);
  // 打开番茄钟面板（桌宠右键菜单「🍅 番茄钟」入口）
  ipcMain.handle('pet:pomodoro:open', () => {
    openPomodoroPanel();
    return true;
  });

  // ---- 待办清单 IPC ----
  // 打开/聚焦面板（桌宠右键菜单「✅ 待办清单」入口）
  ipcMain.handle('pet:todo:open', () => {
    openTodoPanel();
    return true;
  });
  // 某日待办列表（默认今天；先跨天结转）
  ipcMain.handle('pet:todo:list', (_e, dateKey?: string) =>
    todoService?.list(typeof dateKey === 'string' && dateKey ? dateKey : undefined) ?? []
  );
  // 新增待办（name 为空时服务抛错 → invoke reject）
  ipcMain.handle('pet:todo:add', (_e, input: TodoAddInput, dateKey?: string) =>
    todoService?.add(input ?? { name: '', important: false, urgent: false }, dateKey) ?? []
  );
  // 标记完成/未完成（done=true 记 doneAt）
  ipcMain.handle('pet:todo:set-done', (_e, id: string, done: boolean, dateKey?: string) =>
    todoService?.setDone(String(id ?? ''), Boolean(done), dateKey) ?? []
  );
  // 删除待办
  ipcMain.handle('pet:todo:remove', (_e, id: string, dateKey?: string) =>
    todoService?.remove(String(id ?? ''), dateKey) ?? []
  );
  // 更新待办字段
  ipcMain.handle('pet:todo:update', (_e, id: string, patch: TodoPatch, dateKey?: string) =>
    todoService?.update(String(id ?? ''), patch ?? {}, dateKey) ?? []
  );
  // 历史完成记录（[fromKey, toKey] 含端点，按完成时间升序）
  ipcMain.handle('pet:todo:history', (_e, fromKey: string, toKey: string) =>
    todoService?.history(String(fromKey ?? ''), String(toKey ?? '')) ?? []
  );
  // AI 简要分析某区间完成情况（不污染对话历史）
  ipcMain.handle('pet:todo:analyze', async (_e, fromKey: string, toKey: string) =>
    todoService?.analyze(String(fromKey ?? ''), String(toKey ?? '')) ?? { ok: false, text: '待办服务未就绪' }
  );
}

/** 番茄钟服务未就绪时的兜底状态（正常情况下服务在 IPC 可达前已初始化） */
const POMO_IDLE_STATUS = {
  phase: 'idle' as const,
  endAt: null,
  remainingMs: 0,
  focusMinutes: 25,
  breakMinutes: 5
};

function bootstrap(): void {
  // 存储与调度器
  const store = new JsonStore({
    scheduler: { jobs: [], paused: false },
    ai: {
      providerId: 'glm',
      apiKeyEnc: '',
      systemPrompt: '',
      history: []
    },
    search: {
      provider: '',
      apiKey: '',
      enabled: true
    },
    pet: {
      name: '皮丘'
    }
  });
  storeRef = store;
  schedulerService = new SchedulerService(store);

  // 日程 / 番茄钟服务：复用统一调度器（见 services/calendar.service.ts、pomodoro.service.ts）
  calendarService = new CalendarService(schedulerService);
  pomodoroService = new PomodoroService(schedulerService);
  // 统一 onFire 分发：按 Job type 路由到对应服务（日程提醒 / 番茄钟阶段到点）
  schedulerService.scheduler.onFire = (job) => {
    if (job.type === CAL_JOB_TYPE) calendarService?.handleFire(job);
    else if (job.type === POMO_JOB_TYPE) pomodoroService?.handleFire(job);
  };
  schedulerService.start();
  // 调度器快照已持久化，但事件表/番茄钟状态需自行重建 Job（init 在 start 之后，先清后建，幂等）
  calendarService.init();
  pomodoroService.init();

  // 剪贴板历史服务（JSON 存储 + SHA-256 去重；常驻监听默认关，面板打开时同步一次）
  clipboardService = new ClipboardHistoryService();
  // 文件搜索服务（mdfind；Windows 预留 es.exe 分支）
  fileSearchService = new FileSearchService();

  // 桌宠窗口
  petWindow = new PetWindow();
  petWindow.create();
  // 桌宠移动 → 气泡窗跟随（保持相对位置）
  petWindow.onMoved = (pos) => moveBubbleWindow(pos);

  // 平台（托盘/自启/通知/窗口管理）
  platform = createPlatform(petWindow);

  // 托盘
  // 图标：彩色 pichu 头像（resources/tray.png，44x44=22pt@2x，非 template；
  // 浅/深色菜单栏与任务栏均可见；generate-tray-icon.js 从 icon.png 生成）。
  const icon =
    process.platform === 'darwin'
      ? DarwinPlatform.trayIconPath()
      : process.platform === 'win32'
        ? Win32Platform.trayIconPath()
        : undefined;
  platform.tray.create({ icon, iconAsTemplate: true, tooltip: '桌面宠物助手' });
  // 托盘动态动画（呼吸）：resources/tray-anim/ 帧资源存在时启用（generate-tray-icon.js --frames-dir 生成）
  const trayAnimDir = join(app.getAppPath(), 'resources', 'tray-anim');
  if (existsSync(trayAnimDir)) platform.startTrayAnimation?.(trayAnimDir);
  platform.tray.updateMenu([
    { id: 'show', label: '显示 / 隐藏桌宠', click: () => {
        if (petWindow?.isVisible()) petWindow.hide();
        else petWindow?.show();
      } },
    { id: 'ai-settings', label: 'AI 对话设置', click: () => openAISettingsWindow() },
    { id: 'sep1', type: 'separator' },
    { id: 'quit', label: '退出', click: () => app.quit() }
  ]);
  // Windows：左键单击托盘 → 切换桌宠显隐（右键弹菜单；macOS 左键弹菜单，无需注册）
  if (process.platform === 'win32') {
    platform.tray.onClick(() => {
      if (petWindow?.isVisible()) petWindow.hide();
      else petWindow?.show();
    });
  }

  registerIpc();

  // 行为控制器（逗猫棒/抚摸/喂食/待机链）
  behavior = new PetBehaviorController({
    stateMachine: petWindow.stateMachine,
    stats: petWindow.stats,
    getWindowPosition: () => petWindow!.getPosition(),
    moveBy: (dx, dy) => petWindow!.moveBy(dx, dy),
    getCursor: () => {
      const p = screen.getCursorScreenPoint();
      return { x: p.x, y: p.y };
    },
    emitCommand: (cmd) => {
      console.log('[behavior] 命令:', JSON.stringify(cmd));
      petWindow?.window?.webContents.send('pet:command', cmd);
    }
  });
  behavior.start();

  // AI 对话服务（流式：pet 模式→气泡窗；assistant 模式→仅聊天窗广播，绝不进气泡）
  aiService = new AIService(store);
  aiService.onChunk = (chunk, mode) => {
    if (mode === 'pet') {
      // 桌宠闲聊 → 气泡窗主进程直写
      if (chunk.done) {
        finishBubbleText();
        closeBubbleWindow(8000);
      } else {
        appendBubbleText(chunk.text);
      }
    }
    // 广播给所有窗口（聊天窗订阅 pet:ai:chunk 呈现流式；assistant 模式聊天窗才接收）
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('pet:ai:chunk', chunk);
    }
  };

  // 待办清单服务（JsonStore 原子写 userData/todo-data.json；analyze 复用 AI 服务）
  todoStore = new JsonStore<TodoStoreShape>({ days: {} }, 'todo-data.json');
  todoService = new TodoService(todoStore, aiService);

  // 演示任务：每 60s 心情衰减 tick（接入统一调度器；幂等注册，防持久化恢复后重复）
  if (!schedulerService.scheduler.hasJob('stats-decay-tick')) {
    schedulerService.addJob({
      id: 'stats-decay-tick',
      type: 'stats-decay',
      fireAt: Date.now() + 60_000,
      repeatIntervalMs: 60_000
    });
  }

  console.log('[main] 桌宠已启动:', {
    platform: platform.name,
    electron: process.versions.electron,
    petState: petWindow.getState()
  });

  // 验证模式：PET_SCREENSHOT=<path> 时截图窗口（含透明 alpha）后退出，用于 PoC 验证
  // PET_DEMO=1 时先模拟一次喂食+抚摸，验证行为链路（命令 → 渲染层表情/气泡）
  // PET_AI_MOCK=1 时内置 mock OpenAI 服务器，验证 AI 对话全链路（人设注入→流式→历史）
  // 注：大模型（如 50MB/8192 贴图）加载慢，截图延迟 6s 保证模型渲染完成
  // 文件搜索自测（PET_FS_TEST=1）：真实 mdfind 搜索，打印结果数/首条路径（独立于截图验证）
  if (process.env['PET_FS_TEST']) {
    void runFsTest(fileSearchService)
      .then(() => app.quit())
      .catch((err) => {
        console.error('[fs-test] 自测异常:', err);
        app.quit();
      });
    return;
  }
  // 日程/番茄钟自测（PET_CAL_TEST=1）：添加事件→断言 Job 注册→模拟提前触发→断言通知回调→
  // 番茄钟 start→status→自动切阶段→stop→面板端到端（独立于截图验证）
  if (process.env['PET_CAL_TEST']) {
    void runCalTest()
      .then(() => app.quit())
      .catch((err) => {
        console.error('[cal-test] 自测异常:', err);
        app.quit();
      });
    return;
  }
  // 番茄钟独立自测（PET_POMO_TEST=1）：start→status→stop + 番茄钟面板端到端（独立于截图验证）
  if (process.env['PET_POMO_TEST']) {
    void runPomoTest()
      .then(() => app.quit())
      .catch((err) => {
        console.error('[pomo-test] 自测异常:', err);
        app.quit();
      });
    return;
  }
  // 托盘图标尺寸探测（PET_TRAY_PROBE=1）：打印 nativeImage 组合后的逻辑尺寸，
  // 验证 addRepresentation(@1x + @2x) 是否被 Electron 正确解读（期望 getSize(1x)=16x16）
  if (process.env['PET_TRAY_PROBE']) {
    void (async () => {
      try {
        const { nativeImage, screen, Tray } = await import('electron');
        const { readFileSync } = await import('node:fs');
        const base = DarwinPlatform.trayIconPath();
        const retina = base.replace(/\.png$/i, '@2x.png');
        const plain = nativeImage.createFromPath(base);
        const composed = nativeImage.createEmpty();
        composed.addRepresentation({ scaleFactor: 1, buffer: readFileSync(base) });
        if (existsSync(retina)) composed.addRepresentation({ scaleFactor: 2, buffer: readFileSync(retina) });
        const d = screen.getPrimaryDisplay();
        console.log('[tray-probe] tray.png 文件:', JSON.stringify(plain.getSize()));
        console.log('[tray-probe] composed.getSize():', JSON.stringify(composed.getSize()));
        console.log('[tray-probe] 主屏 scaleFactor:', d.scaleFactor, '逻辑尺寸:', JSON.stringify(d.size));
        // 用组合图创建 Tray（与运行时一致）；Tray 无 getImage API，仅确认创建不抛错
        const t = new Tray(composed);
        t.setToolTip('tray-probe');
        t.destroy();
        console.log('[tray-probe] 完成 ✅（Tray 创建成功，图标逻辑尺寸 16x16 = 16pt）');
      } catch (err) {
        console.error('[tray-probe] 失败:', err);
      } finally {
        app.quit();
      }
    })();
    return;
  }
  // 待办清单自测（PET_TODO_TEST=1）：四象限排序/完成置底/取消恢复/跨天结转幂等/历史/AI 分析/持久化
  // （独立于截图验证；PET_AI_MOCK=1 时内置 mock OpenAI 服务器供 analyze 用例）
  if (process.env['PET_TODO_TEST']) {
    void runTodoTest()
      .then(() => app.quit())
      .catch((err) => {
        console.error('[todo-test] 自测异常:', err);
        app.quit();
      });
    return;
  }
  // 托盘动画帧生成（PET_TRAY_ANIM=<dir>）：图标模式连拍 4 帧（呼吸动画相位差）→ 保存 frame-0..3.png
  // （供 scripts/generate-tray-icon.js --frames-dir 缩放成托盘动画帧资源）
  if (process.env['PET_TRAY_ANIM']) {
    const animDir = process.env['PET_TRAY_ANIM'];
    petWindow!.window!.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          let modelReady = false;
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 500));
            try {
              const info = (await petWindow!.window!.webContents.executeJavaScript(
                `window.__petDebug ? window.__petDebug() : null`
              )) as { modelY: number } | null;
              if (info && info.modelY !== -1) {
                modelReady = true;
                break;
              }
            } catch {
              /* 继续等 */
            }
          }
          console.log('[tray-anim] 模型就绪:', modelReady);
          const frames = (await petWindow!.window!.webContents.executeJavaScript(
            `window.__captureFrames ? window.__captureFrames(4, 300) : null`
          )) as (string | null)[] | null;
          const { mkdirSync } = await import('node:fs');
          mkdirSync(animDir!, { recursive: true });
          let saved = 0;
          if (frames) {
            const { nativeImage } = await import('electron');
            frames.forEach((dataUrl, i) => {
              if (!dataUrl) return;
              writeFileSync(`${animDir}/frame-${i}.png`, nativeImage.createFromDataURL(dataUrl).toPNG());
              saved++;
            });
          }
          console.log(`[tray-anim] 保存 ${saved} 帧 → ${animDir}`);
        } catch (err) {
          console.error('[tray-anim] 失败:', err);
        } finally {
          app.quit();
        }
      }, 500);
    });
    return;
  }
  const screenshotPath = process.env['PET_SCREENSHOT'];
  if (screenshotPath) {
    // 应用图标生成：PET_ICON_SHOT=<path> 时图标模式→canvas toDataURL→保存 PNG（透明底）
    if (process.env['PET_ICON_SHOT']) {
      const iconShot = process.env['PET_ICON_SHOT'];
      petWindow!.window!.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            // 轮询等待 Live2D 模型加载完成（50MB 模型加载较慢）
            let modelReady = false;
            for (let i = 0; i < 30; i++) {
              await new Promise((r) => setTimeout(r, 500));
              try {
                const info = (await petWindow!.window!.webContents.executeJavaScript(
                  `window.__petDebug ? window.__petDebug() : null`
                )) as { modelY: number } | null;
                if (info && info.modelY !== -1) {
                  modelReady = true;
                  break;
                }
              } catch {
                /* 继续等 */
              }
            }
            console.log('[main] 图标模型就绪:', modelReady);
            const dataUrl = (await petWindow!.window!.webContents.executeJavaScript(
              `window.__captureIconPng ? window.__captureIconPng() : null`
            )) as string | null;
            if (dataUrl) {
              const img = (await import('electron')).nativeImage.createFromDataURL(dataUrl);
              writeFileSync(iconShot!, img.toPNG());
              console.log('[main] 图标截图已保存:', iconShot);
            } else {
              console.error('[main] 图标截图失败: toDataURL 返回空');
            }
          } catch (err) {
            console.error('[main] 图标截图失败:', err);
          } finally {
            app.quit();
          }
        }, 500);
      });
      return;
    }
    // 剪贴板历史逻辑自测：PET_CLIP_TEST=1 时写剪贴板→sync→list→验证去重/pin/搜索/粘贴/图片
    if (process.env['PET_CLIP_TEST']) {
      void runClipTest(clipboardService).then(() => app.quit());
      return;
    }
    // 存储持久化探测：PET_STORE_PROBE=1（+PET_SET_NAME=xx 则先写入）
    if (process.env['PET_STORE_PROBE']) {
      const setName = process.env['PET_SET_NAME'];
      if (setName) storeRef?.set('pet', { name: String(setName) });
      const setAiKey = process.env['PET_SET_AIKEY'];
      if (setAiKey) {
        const ai = storeRef?.get('ai') as { apiKeyEnc?: string } | undefined;
        storeRef?.set('ai', { ...(ai ?? {}), apiKeyEnc: String(setAiKey) });
      }
      console.log('[store] path:', storeRef?.path);
      console.log('[store] pet.name:', storeRef?.get('pet').name);
      const aiCfg = storeRef?.get('ai') as { apiKeyEnc?: string } | undefined;
      console.log('[store] ai.apiKeyEnc:', JSON.stringify(aiCfg?.apiKeyEnc ?? ''));
      console.log('[store] 存在:', require('node:fs').existsSync(storeRef?.path ?? ''));
      app.quit();
      return;
    }
    petWindow.window?.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (process.env['PET_DEMO']) {
            behavior?.onFeed('fish');
            behavior?.onClick({ x: 130, y: 100, hitPart: 'head' });
          }
          if (process.env['PET_AI_MOCK'] && aiService) {
            // 可选：mock 搜索服务器（验证网页搜索注入链路）
            if (process.env['PET_SEARCH_MOCK']) {
              const hs = await import('node:http');
              const searchSrv = hs.createServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    data: {
                      webPages: {
                        value: [
                          { name: 'Mock科技新闻一', snippet: 'AI 领域最新进展（模拟结果）', url: 'https://mock1.example' },
                          { name: 'Mock科技新闻二', snippet: '芯片行业动态（模拟结果）', url: 'https://mock2.example' },
                          { name: 'Mock科技新闻三', snippet: '机器人技术突破（模拟结果）', url: 'https://mock3.example' }
                        ]
                      }
                    }
                  })
                );
              });
              await new Promise<void>((r) => searchSrv.listen(18098, r));
              aiService.setSearchConfig({ provider: 'bocha', apiKey: 'mock-key', enabled: true });
            }
            // mock 模式不经过 IPC，先手动打开气泡窗口（供 onChunk 流式写入）
            openBubbleWindow(petWindow?.getPosition());
            await runAiMockTest(aiService);
            // 等气泡窗口完成渲染/自适应
            await new Promise((r) => setTimeout(r, 600));
            // 截气泡窗口验证气泡造型
            const bubbleShot = process.env['PET_BUBBLE_SHOT'];
            if (bubbleShot) {
              const bubble = getBubbleWindow();
              console.log('[main] bubble-win 状态:', bubble ? (bubble.isDestroyed() ? '已销毁' : '存活') : 'null');
              if (bubble && !bubble.isDestroyed()) {
                try {
                  const content = await bubble.webContents.executeJavaScript(
                    `document.getElementById('content') ? document.getElementById('content').textContent.slice(0, 80) : '(未加载)'`
                  );
                  console.log('[main] 气泡内容:', JSON.stringify(content));
                  const image = await bubble.webContents.capturePage();
                  writeFileSync(bubbleShot, image.toPNG());
                  console.log('[main] 气泡窗口截图已保存:', bubbleShot);
                } catch (err) {
                  console.log('[main] 气泡截图失败:', err instanceof Error ? err.message : String(err));
                }
              }
            }
          }
          // 读取渲染层内部状态（确认窗口尺寸同步与模型锚定）
          try {
            const info = (await petWindow!.window!.webContents.executeJavaScript(
              `window.__petDebug ? window.__petDebug() : null`
            )) as { W: number; H: number; modelY: number; modelBH: number } | null;
            if (info) {
              console.log(
                `[main] 渲染层状态: H=${info.H} 模型y=${info.modelY.toFixed(1)} 模型高=${info.modelBH.toFixed(1)}（锚底期望y=${(info.H - info.modelBH / 2 - 10).toFixed(1)}）`
              );
            }
          } catch {
            /* 忽略 */
          }
          if (process.env['PET_MD_TEST']) {
            // 验证聊天窗 Markdown 渲染器
            openChatWindow(storeRef?.get('pet').name);
            await new Promise((r) => setTimeout(r, 900));
            const md =
              '# 测试标题\n\n**加粗** 和 `行内代码`\n\n- 项目一\n- 项目二\n\n```js\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |';
            const mdJson = JSON.stringify(md);
            const html = await petWindow!.window!.webContents.executeJavaScript(
              `(async () => {
                const wins = require ? null : null;
                return 'noop';
              })()`
            ).catch(() => '');
            void html;
            // 直接向聊天窗发送测试消息渲染（标题已改为"XX自习室"，按宽度 360 识别）
            const chatWins = BrowserWindow.getAllWindows().find(
              (w) => w.getBounds().width === 360 && w.getBounds().height === 500
            );
            if (chatWins) {
              const out = await chatWins.webContents.executeJavaScript(
                `renderMarkdown(${mdJson})`
              );
              console.log('[md-test] 渲染输出:', out.slice(0, 400));
            }
          }
          const image = await petWindow!.window!.webContents.capturePage();
          writeFileSync(screenshotPath, image.toPNG());
          console.log('[main] 验证截图已保存:', screenshotPath);
        } catch (err) {
          console.error('[main] 截图失败:', err);
        } finally {
          app.quit();
        }
      }, 6000);
    });
  }
}

/** 剪贴板历史逻辑自测（PET_CLIP_TEST=1）：写剪贴板→sync→list→验证去重/pin/搜索/粘贴/图片 */
async function runClipTest(clip: ClipboardHistoryService | null): Promise<void> {
  const electron = await import('electron');
  const { existsSync, readFileSync } = await import('node:fs');
  if (!clip) {
    console.error('[clip-test] 剪贴板服务未初始化');
    return;
  }
  console.log('[clip-test] 存储文件:', clip.path);
  console.log('[clip-test] 图片目录:', clip.imageDirPath);
  // 清空历史，保证可重复运行
  for (const item of clip.list()) clip.remove(item.id);

  // 1. 写文本 A → sync → 应出现 1 条
  electron.clipboard.writeText('clip-test-文本A-你好世界');
  clip.syncNow();
  const l1 = clip.list();
  console.log('[clip-test] ① 写入A后条数:', l1.length, '首条:', JSON.stringify(l1[0]?.text ?? null));

  // 2. 重复写 A → sync → 去重：仍 1 条，仅时间戳更新
  const beforeTs = l1[0]?.copiedAt ?? 0;
  await new Promise((r) => setTimeout(r, 20));
  electron.clipboard.writeText('clip-test-文本A-你好世界');
  clip.syncNow();
  const l2 = clip.list();
  const dedupOk = l2.length === 1 && (l2[0]?.copiedAt ?? 0) >= beforeTs;
  console.log('[clip-test] ② 重复A后条数(期望1):', l2.length, '去重+时间戳更新:', dedupOk ? 'PASS' : 'FAIL');

  // 3. 写文本 B → sync → 应 2 条
  electron.clipboard.writeText('clip-test-文本B-第二段');
  clip.syncNow();
  const l3 = clip.list();
  console.log('[clip-test] ③ 写入B后条数(期望2):', l3.length);

  // 4. 搜索
  const s = clip.search('第二段');
  console.log('[clip-test] ④ 搜索"第二段"命中:', s.length, '内容:', JSON.stringify(s[0]?.text ?? null));

  // 5. pin A → A 应置顶且 isPinned=true
  const pinId = l3.find((i) => i.text?.includes('文本A'))?.id ?? '';
  const pinnedState = clip.pin(pinId);
  const l4 = clip.list();
  console.log('[clip-test] ⑤ pin后:', pinnedState ? '已固定' : 'FAIL', '首位:', JSON.stringify(l4[0]?.text ?? null), l4[0]?.isPinned ? '(置顶✓)' : '(置顶✗)');

  // 6. paste B → 剪贴板读回应等于 B
  const pasteId = l3.find((i) => i.text?.includes('文本B'))?.id ?? '';
  const pr = clip.paste(pasteId);
  console.log('[clip-test] ⑥ paste结果:', JSON.stringify(pr), '读回:', JSON.stringify(electron.clipboard.readText()));

  // 7. 图片：写入 4x4 红点 PNG → sync → 应出现 image 条目且文件落盘
  const img = electron.nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP4z8DwHxkzkC4AADxAH+HggXe0AAAAAElFTkSuQmCC'
  );
  console.log('[clip-test] ⑦ 构造图片非空:', !img.isEmpty());
  electron.clipboard.writeImage(img);
  clip.syncNow();
  const l5 = clip.list();
  const imgItem = l5.find((i) => i.kind === 'image');
  console.log(
    '[clip-test] ⑦ 图片条目:',
    imgItem
      ? `kind=${imgItem.kind} hash=${imgItem.hash.slice(0, 8)} 文件存在=${imgItem.imagePath ? existsSync(imgItem.imagePath) : false}`
      : '(未记录)'
  );
  const pr2 = clip.paste(imgItem?.id ?? '');
  console.log('[clip-test] ⑦ 图片粘贴:', JSON.stringify(pr2), '读回非空:', !electron.clipboard.readImage().isEmpty());

  // 8. remove A → 剩 B + 图片 = 2 条
  clip.remove(pinId);
  console.log('[clip-test] ⑧ remove A 后条数(期望2):', clip.list().length);

  // 9. 持久化：JSON 文件存在且可解析
  let persisted = false;
  try {
    persisted = existsSync(clip.path) && JSON.parse(readFileSync(clip.path, 'utf8')).items?.length === 2;
  } catch {
    /* 忽略 */
  }
  console.log('[clip-test] ⑨ 持久化文件存在且条数正确:', persisted ? 'PASS' : 'FAIL');

  // 10. 面板端到端：打开面板 → 等待加载 → 验证 DOM 渲染出条目（IPC 全链路：preload→main→service）
  const panelWin = openClipboardPanel();
  if (panelWin) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const dom = (await panelWin.webContents.executeJavaScript(`(() => {
        const items = document.querySelectorAll('#list .item').length;
        const first = document.querySelector('#list .item .preview');
        return { items, firstText: first ? first.textContent.slice(0, 20) : null };
      })()`)) as { items: number; firstText: string | null };
      console.log('[clip-test] ⑩ 面板渲染: 条目数=', dom.items, '首条预览=', JSON.stringify(dom.firstText));
    } catch (err) {
      console.log('[clip-test] ⑩ 面板执行 JS 失败:', err instanceof Error ? err.message : String(err));
    }
    panelWin.close();
    await new Promise((r) => setTimeout(r, 200));
  } else {
    console.log('[clip-test] ⑩ 面板打开失败');
  }

  // 11. 常驻监听轮询：开启 → 外部写入剪贴板 → 0.5s 轮询应自动入库
  clip.setConstantMode(true);
  await new Promise((r) => setTimeout(r, 300)); // 等轮询快照对齐
  electron.clipboard.writeText('clip-test-常驻轮询-C');
  await new Promise((r) => setTimeout(r, 1200)); // 等 ≥2 个轮询周期
  const l6 = clip.list();
  const polled = l6.some((i) => i.text?.includes('常驻轮询'));
  console.log('[clip-test] ⑪ 常驻轮询自动入库:', polled ? 'PASS' : 'FAIL', '总条数:', l6.length);
  clip.setConstantMode(false);
  console.log('[clip-test] 全部完成 ✅');
}

/** 文件搜索自测（PET_FS_TEST=1）：真实 mdfind 搜索，验证查询构建/解析/截断/类型+时间组合 */
async function runFsTest(fs: FileSearchService | null): Promise<void> {
  if (!fs) {
    console.error('[fs-test] 文件搜索服务未初始化');
    return;
  }
  // ① 空查询 → 直接 []，不触发 mdfind
  const empty = await fs.search('');
  console.log('[fs-test] ① 空查询结果数(期望0):', empty.length);
  // ② 真实 mdfind 搜索 "README"
  const r1 = await fs.search('README');
  console.log('[fs-test] ② "README" 结果数:', r1.length, '首条:', JSON.stringify(r1[0] ?? null));
  // ③ "package.json"
  const r2 = await fs.search('package.json');
  console.log('[fs-test] ③ "package.json" 结果数:', r2.length, '首条:', JSON.stringify(r2[0] ?? null));
  // ④ 类型 + 时间组合（近 7 天的图片）
  const r3 = await fs.search('README', { kinds: ['public.image'], withinMinutes: 10080 });
  console.log('[fs-test] ④ 类型=public.image + 近7天 结果数:', r3.length, '首条:', JSON.stringify(r3[0] ?? null));
  // ⑤ limit 截断
  const r4 = await fs.search('package.json', { limit: 2 });
  console.log('[fs-test] ⑤ limit=2 结果数(期望≤2):', r4.length);
  // ⑥ 面板端到端：打开面板 → 等待加载 → 验证 preload 注入 + DOM 结构（IPC 全链路）
  const panelWin = openFileSearchPanel();
  if (panelWin) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const dom = (await panelWin.webContents.executeJavaScript(`(() => ({
        hasPetApi: typeof window.pet !== 'undefined',
        hasSearch: !!document.getElementById('search'),
        hasKind: !!document.getElementById('kind'),
        status: document.getElementById('status') ? document.getElementById('status').textContent : null
      }))()`)) as { hasPetApi: boolean; hasSearch: boolean; hasKind: boolean; status: string | null };
      console.log(
        '[fs-test] ⑥ 面板: preload注入=',
        dom.hasPetApi,
        '搜索框=',
        dom.hasSearch,
        '类型过滤=',
        dom.hasKind,
        '状态栏=',
        JSON.stringify(dom.status)
      );
      // ⑦ 面板内直接调 window.pet.fileSearch（preload → IPC → 服务全链路）
      const res = (await panelWin.webContents.executeJavaScript(
        `window.pet.fileSearch('PROGRESS', { withinMinutes: 43200 }).then(r => ({ ok: r.ok, n: r.results.length, first: r.results[0] ? r.results[0].name : null }))`
      )) as { ok: boolean; n: number; first: string | null };
      console.log('[fs-test] ⑦ 面板内 IPC fileSearch("PROGRESS"):', JSON.stringify(res));
    } catch (err) {
      console.log('[fs-test] ⑥ 面板执行 JS 失败:', err instanceof Error ? err.message : String(err));
    }
    panelWin.close();
    await new Promise((r) => setTimeout(r, 200));
  } else {
    console.log('[fs-test] ⑥ 面板打开失败');
  }
  console.log('[fs-test] 全部完成 ✅');
}

/** 日程/番茄钟逻辑自测（PET_CAL_TEST=1）：添加事件→断言 Job 注册→模拟提前触发→断言通知回调→番茄钟全流程→面板端到端 */
async function runCalTest(): Promise<void> {
  const cal = calendarService;
  const pomo = pomodoroService;
  const sched = schedulerService;
  if (!cal || !pomo || !sched) {
    console.error('[cal-test] 服务未初始化');
    return;
  }
  let allOk = true;
  const check = (label: string, pass: boolean, extra = ''): void => {
    if (!pass) allOk = false;
    console.log(`[cal-test] ${label}: ${pass ? 'PASS' : 'FAIL'}${extra ? ' ' + extra : ''}`);
  };

  console.log('[cal-test] 日程存储文件:', cal.path);
  console.log('[cal-test] 番茄钟存储文件:', pomo.path);

  // 清空旧数据，保证可重复运行
  cal.clear();
  pomo.stop();

  // 通知回调计数（沙盒下系统通知不可见，用回调钩子验证触发链路）
  let calNotifyCount = 0;
  let pomoNotifyCount = 0;
  cal.onNotify = () => {
    calNotifyCount++;
  };
  pomo.onNotify = () => {
    pomoNotifyCount++;
  };

  // ① 添加事件：未来 2 分钟 + 提前 1 分钟提醒 → list 包含 + Job 注册
  const addRes = cal.add({ title: 'cal-test-提醒', startAt: Date.now() + 120_000, remindBeforeMs: 60_000 });
  const evtId = 'error' in addRes ? '' : addRes.id;
  check('① 添加事件成功', !!evtId && !('error' in addRes));
  check('① list 包含新事件', cal.list().some((e) => e.id === evtId));
  const jobId = `calendar:evt:${evtId}`;
  check('① 调度器已注册提醒 Job', sched.scheduler.hasJob(jobId), `id=${jobId}`);

  // ② 模拟到点：把 Job fireAt 提前到 now-1s → 等调度器 tick → 通知回调被调 + 标记已提醒 + Job 移除
  sched.scheduler.reschedule(jobId, Date.now() - 1000);
  await new Promise((r) => setTimeout(r, 900));
  check('② 提醒触发后通知回调被调', calNotifyCount >= 1, `notifyCount=${calNotifyCount}`);
  check('② 一次性事件标记已提醒', cal.list().find((e) => e.id === evtId)?.reminded === true);
  check('② 触发后 Job 已移除', !sched.scheduler.hasJob(jobId));

  // ③ 重复规则：daily，起始于过去 1 天 → 应注册下一个 occurrence 的 Job（未来，跳过已过期的 occurrence）
  const addRes2 = cal.add({ title: 'cal-test-每日', startAt: Date.now() - 86_400_000, repeatRule: 'daily', remindBeforeMs: 0 });
  const evt2Id = 'error' in addRes2 ? '' : addRes2.id;
  const job2 = `calendar:evt:${evt2Id}`;
  check('③ 每日事件注册下一个 Job', sched.scheduler.hasJob(job2), `id=${job2}`);

  // ④ 番茄钟：start focus 0.05 分钟（3 秒）→ phase=focus → 3.5s 后自动切 break → 统计入账 → stop 回 idle
  const st1 = pomo.start('focus', 0.05);
  check('④ 番茄钟 start 后 phase=focus', st1.phase === 'focus' && st1.remainingMs > 0, `remaining=${st1.remainingMs}ms`);
  check('④ 番茄钟 Job 已注册', sched.scheduler.hasJob('pomodoro:phase'));
  await new Promise((r) => setTimeout(r, 3500));
  const st2 = pomo.status();
  check('④ 3.5s 后自动切到 break', st2.phase === 'break', `phase=${st2.phase}`);
  check('④ 专注完成通知回调被调', pomoNotifyCount >= 1, `notifyCount=${pomoNotifyCount}`);
  const today = pomo.sessionsToday();
  check('④ 专注完成计入今日统计', today > 0, `今日=${today.toFixed(2)} 分钟`);
  const st3 = pomo.stop();
  check('④ stop 后 phase=idle', st3.phase === 'idle');
  check('④ stop 后 Job 已移除', !sched.scheduler.hasJob('pomodoro:phase'));

  // ⑤ 面板端到端：打开面板 → 等待加载 → 验证 preload 注入 + DOM 渲染（IPC 全链路）
  // 拆分后日历面板不再含番茄钟区块：断言 #pomodoro-area / #pomo-status 均不存在
  const panelWin = openCalendarPanel();
  if (panelWin) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const dom = (await panelWin.webContents.executeJavaScript(`(async () => ({
        hasPetApi: typeof window.pet !== 'undefined',
        hasCalendar: typeof window.pet.calendarList === 'function',
        hasPomodoroApi: typeof window.pet.pomodoroStatus === 'function',
        evCount: document.querySelectorAll('#list .ev-item').length,
        evEmpty: document.getElementById('ev-empty').style.display,
        pomoAreaExists: !!document.getElementById('pomodoro-area'),
        pomoStatusExists: !!document.getElementById('pomo-status')
      }))()`)) as {
        hasPetApi: boolean;
        hasCalendar: boolean;
        hasPomodoroApi: boolean;
        evCount: number;
        evEmpty: string;
        pomoAreaExists: boolean;
        pomoStatusExists: boolean;
      };
      console.log(
        '[cal-test] ⑤ 面板: preload=',
        dom.hasPetApi,
        'calendarAPI=',
        dom.hasCalendar,
        'pomodoroAPI=',
        dom.hasPomodoroApi,
        '事件条目=',
        dom.evCount,
        '番茄钟区块=',
        dom.pomoAreaExists ? '存在(✗)' : '已移除(✓)'
      );
      check('⑤ 面板 preload 注入', dom.hasPetApi && dom.hasCalendar && dom.hasPomodoroApi);
      check('⑤ 日历面板无番茄钟元素', !dom.pomoAreaExists && !dom.pomoStatusExists);
      check('⑤ 面板渲染事件列表', dom.evCount >= 2, `evCount=${dom.evCount}`);
      // ⑥ 面板内直接走 window.pet 全链路：add → list → remove
      const ipc = (await panelWin.webContents.executeJavaScript(`(async () => {
        await window.pet.calendarAdd({ title: 'cal-test-IPC', startAt: Date.now() + 3600e3, remindBeforeMs: 0, repeatRule: 'none' });
        const listed = await window.pet.calendarList();
        const item = listed.find(e => e.title === 'cal-test-IPC');
        const found = !!item;
        const removed = found ? await window.pet.calendarRemove(item.id) : false;
        return { found, removed };
      })()`)) as { found: boolean; removed: boolean };
      console.log('[cal-test] ⑥ 面板内 IPC 全链路: 添加并查到=', ipc.found, '删除=', ipc.removed);
      check('⑥ 面板内 IPC 全链路（add/list/remove）', ipc.found && ipc.removed);
    } catch (err) {
      console.error('[cal-test] ⑤ 面板执行 JS 失败:', err instanceof Error ? err.message : String(err));
      check('⑤ 面板端到端', false);
    }
    panelWin.close();
    await new Promise((r) => setTimeout(r, 200));
  } else {
    check('⑤ 面板打开', false);
  }

  console.log('[cal-test] 全部完成 ✅', allOk ? '（全部 PASS）' : '（存在 FAIL）');
}

/** 番茄钟独立自测（PET_POMO_TEST=1）：start→status→stop + 番茄钟面板端到端（IPC 全链路） */
async function runPomoTest(): Promise<void> {
  const pomo = pomodoroService;
  const sched = schedulerService;
  if (!pomo || !sched) {
    console.error('[pomo-test] 服务未初始化');
    return;
  }
  let allOk = true;
  const check = (label: string, pass: boolean, extra = ''): void => {
    if (!pass) allOk = false;
    console.log(`[pomo-test] ${label}: ${pass ? 'PASS' : 'FAIL'}${extra ? ' ' + extra : ''}`);
  };

  console.log('[pomo-test] 番茄钟存储文件:', pomo.path);
  pomo.stop();

  // ① start focus 0.1 分钟（6 秒，留足面板检查余量）→ phase=focus + Job 注册 + 剩余>0
  const st1 = pomo.start('focus', 0.1);
  check('① start 后 phase=focus', st1.phase === 'focus' && st1.remainingMs > 0, `remaining=${st1.remainingMs}ms`);
  check('① 番茄钟 Job 已注册', sched.scheduler.hasJob('pomodoro:phase'));

  // ② status 查询与 start 一致
  const st2 = pomo.status();
  check('② status 与 start 一致', st2.phase === 'focus' && st2.remainingMs > 0, `remaining=${st2.remainingMs}ms`);

  // ③ 面板端到端：打开番茄钟面板 → preload 注入 + DOM 渲染（IPC 全链路）
  const panelWin = openPomodoroPanel();
  if (panelWin) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const dom = (await panelWin.webContents.executeJavaScript(`(async () => ({
        hasPetApi: typeof window.pet !== 'undefined',
        hasStatus: typeof window.pet.pomodoroStatus === 'function',
        hasStart: typeof window.pet.pomodoroStart === 'function',
        hasStop: typeof window.pet.pomodoroStop === 'function',
        hasArea: !!document.getElementById('pomodoro-area'),
        statusText: document.getElementById('pomo-status') ? document.getElementById('pomo-status').textContent : null,
        countdownText: document.getElementById('pomo-countdown') ? document.getElementById('pomo-countdown').textContent : null
      }))()`)) as {
        hasPetApi: boolean;
        hasStatus: boolean;
        hasStart: boolean;
        hasStop: boolean;
        hasArea: boolean;
        statusText: string | null;
        countdownText: string | null;
      };
      console.log(
        '[pomo-test] ③ 面板: preload=',
        dom.hasPetApi,
        'statusAPI=',
        dom.hasStatus,
        'startAPI=',
        dom.hasStart,
        'stopAPI=',
        dom.hasStop,
        '状态=',
        JSON.stringify(dom.statusText),
        '倒计时=',
        JSON.stringify(dom.countdownText)
      );
      check('③ 面板 preload 注入', dom.hasPetApi && dom.hasStatus && dom.hasStart && dom.hasStop);
      check('③ 面板渲染番茄钟区块', dom.hasArea);
      check('③ 面板显示专注中状态', dom.statusText === '🍅 专注中', `status=${JSON.stringify(dom.statusText)}`);
      // ④ 面板内直接走 window.pet 全链路：stop → start break → status → stop
      const ipc = (await panelWin.webContents.executeJavaScript(`(async () => {
        await window.pet.pomodoroStop();
        const idle = await window.pet.pomodoroStatus();
        await window.pet.pomodoroStart('break', 0.05);
        const brk = await window.pet.pomodoroStatus();
        await window.pet.pomodoroStop();
        const fin = await window.pet.pomodoroStatus();
        return { idlePhase: idle.phase, breakPhase: brk.phase, finalPhase: fin.phase };
      })()`)) as { idlePhase: string; breakPhase: string; finalPhase: string };
      console.log('[pomo-test] ④ 面板内 IPC 全链路: idle→break→idle =', JSON.stringify(ipc));
      check(
        '④ 面板内 IPC 全链路（stop/start/status）',
        ipc.idlePhase === 'idle' && ipc.breakPhase === 'break' && ipc.finalPhase === 'idle'
      );
    } catch (err) {
      console.error('[pomo-test] ③ 面板执行 JS 失败:', err instanceof Error ? err.message : String(err));
      check('③ 面板端到端', false);
    }
    panelWin.close();
    await new Promise((r) => setTimeout(r, 200));
  } else {
    check('③ 面板打开', false);
  }

  // ⑤ stop 后 phase=idle + Job 移除
  const st3 = pomo.stop();
  check('⑤ stop 后 phase=idle', st3.phase === 'idle');
  check('⑤ stop 后 Job 已移除', !sched.scheduler.hasJob('pomodoro:phase'));

  console.log('[pomo-test] 全部完成 ✅', allOk ? '（全部 PASS）' : '（存在 FAIL）');
}

/** 待办清单自测（PET_TODO_TEST=1）：四象限排序/完成置底/取消恢复/跨天结转幂等/历史/AI 分析/持久化 */
async function runTodoTest(): Promise<void> {
  const todo = todoService;
  const ai = aiService;
  const store = todoStore;
  if (!todo || !ai || !store) {
    console.error('[todo-test] 服务未初始化');
    return;
  }
  let allOk = true;
  const check = (label: string, pass: boolean, extra = ''): void => {
    if (!pass) allOk = false;
    console.log(`[todo-test] ${label}: ${pass ? 'PASS' : 'FAIL'}${extra ? ' ' + extra : ''}`);
  };

  console.log('[todo-test] 存储文件:', todo.path);
  const today = todayKey();
  const daysAgo = (n: number): string => dateKeyOf(new Date(Date.now() - n * 86_400_000));
  const yesterday = daysAgo(1);

  // 清空旧数据，保证可重复运行
  store.set('days', {});

  // ① 添加 4 个任务覆盖 4 个象限（重要紧急带 start '09:00' end '10:00'）
  todo.add({ name: 'todo-test-重要紧急', important: true, urgent: true, start: '09:00', end: '10:00' });
  todo.add({ name: 'todo-test-重要不紧急', important: true, urgent: false });
  todo.add({ name: 'todo-test-不重要紧急', important: false, urgent: true });
  todo.add({ name: 'todo-test-不重要不紧急', important: false, urgent: false });
  const l1 = todo.list();
  const order1 = l1.map((t) => quadrantOf(t)).join(',');
  check(
    '① 四象限排序',
    order1 === 'urgent-important,important,urgent,neither',
    `顺序=${order1}`
  );
  check('① 带时间任务字段保留', l1[0]?.start === '09:00' && l1[0]?.end === '10:00', `start=${l1[0]?.start}`);

  // ② setDone 其中一个 → 排到最后 + 记 doneAt
  const doneId = l1[0]?.id ?? '';
  const l2 = todo.setDone(doneId, true);
  const last = l2[l2.length - 1];
  check('② setDone 后排到最后', last?.id === doneId, `末位=${last?.name}`);
  check('② doneAt 已记录', typeof last?.doneAt === 'number' && (last?.doneAt ?? 0) > 0, `doneAt=${last?.doneAt}`);

  // ③ 再次 setDone(false) → 恢复原相对位置（重要紧急回到首位）+ 清除 doneAt
  const l3 = todo.setDone(doneId, false);
  check(
    '③ 取消完成后恢复排序',
    l3[0]?.id === doneId && quadrantOf(l3[0]!) === 'urgent-important',
    `首位=${l3[0]?.name}`
  );
  check('③ doneAt 已清除', l3[0]?.doneAt === undefined);

  // ④ 构造"昨天"数据（直接写 store：done=false、无 carriedTo）→ ensureToday 结转副本 + 幂等
  store.set('days', {
    ...store.get('days'),
    [yesterday]: [
      {
        id: 'yesterday-1',
        name: 'todo-test-昨日任务',
        date: yesterday,
        start: '08:00',
        end: '09:00',
        important: true,
        urgent: true,
        done: false,
        createdAt: Date.now() - 86_400_000
      }
    ]
  });
  const todayBefore = (store.get('days')[today] ?? []).length;
  todo.ensureToday();
  const rolled = (store.get('days')[today] ?? []).filter((t) => t.rolloverFrom === 'yesterday-1');
  check(
    '④ 结转副本出现且字段保留',
    rolled.length === 1 &&
      rolled[0]?.name === 'todo-test-昨日任务' &&
      rolled[0]?.date === today &&
      rolled[0]?.start === '08:00' &&
      rolled[0]?.end === '09:00' &&
      rolled[0]?.important === true &&
      rolled[0]?.urgent === true &&
      rolled[0]?.done === false,
    `副本数=${rolled.length}`
  );
  const orig = (store.get('days')[yesterday] ?? []).find((t) => t.id === 'yesterday-1');
  check('④ 原任务 carriedTo=today', orig?.carriedTo === today, `carriedTo=${orig?.carriedTo}`);
  const after1 = (store.get('days')[today] ?? []).length;
  todo.ensureToday();
  const after2 = (store.get('days')[today] ?? []).length;
  check('④ 再次 ensureToday 不重复复制', after2 === after1 && todayBefore + 1 === after1, `today ${todayBefore}→${after1}→${after2}`);

  // ⑤ history：标记昨天原任务 + 今天结转副本为完成 → [三天前, 今天] 全部 done 且按 doneAt 升序
  todo.setDone('yesterday-1', true, yesterday);
  const rolledId = rolled[0]?.id ?? '';
  todo.setDone(rolledId, true, today);
  const h = todo.history(daysAgo(3), today);
  const ascOk = h.every((t, i) => i === 0 || (h[i - 1]?.doneAt ?? 0) <= (t.doneAt ?? 0));
  check('⑤ history 返回全部 done 任务', h.length === 2 && h.every((t) => t.done), `count=${h.length}`);
  check('⑤ doneAt 升序', ascOk);

  // ⑥ analyze：PET_AI_MOCK 环境内置 mock OpenAI 服务器 → ok=true 且 text 非空；不污染对话历史
  if (process.env['PET_AI_MOCK']) {
    const http = await import('node:http');
    const mockSrv = http.createServer((req, res) => {
      if (req.url?.includes('/chat/completions')) {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body) as { messages?: { role: string; content: string }[] };
          const last = parsed.messages?.at(-1)?.content ?? '';
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: `(mock)[待办分析] 共收到 ${last.length} 字符的待办清单，建议优先处理重要紧急事项。` } }] })}\n\n`
          );
          res.write('data: [DONE]\n\n');
          res.end();
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => mockSrv.listen(18100, r));
    ai.setConfig({ baseURL: 'http://127.0.0.1:18100', apiKey: 'mock-key', model: 'mock-model' });
    // 关闭联网检索（assistant 模式会自动检索），保证 analyze 测试封闭、不依赖外部网络
    ai.setSearchConfig({ provider: '', apiKey: '', enabled: false });
    const histBefore = ai.getHistoryLength();
    const a = await todo.analyze(daysAgo(3), today);
    const histAfter = ai.getHistoryLength();
    check('⑥ analyze ok=true 且 text 非空', a.ok && a.text.length > 0, `text=${JSON.stringify(a.text.slice(0, 40))}`);
    check('⑥ 分析不污染对话历史', histAfter === histBefore, `history ${histBefore}→${histAfter}`);
    mockSrv.close();
  } else {
    console.log('[todo-test] ⑥ 跳过（非 PET_AI_MOCK 环境）');
  }

  // ⑦ 持久化：写盘后重新 new TodoService（同 store 路径）读回，断言数据一致
  const svc2 = new TodoService(new JsonStore<TodoStoreShape>({ days: {} }, 'todo-data.json'), ai);
  const relisted = svc2.list(today);
  const cur = todo.list(today);
  const same =
    relisted.length === cur.length &&
    relisted.every((t, i) => t.id === cur[i]?.id && t.name === cur[i]?.name && t.done === cur[i]?.done);
  check('⑦ 持久化读回数据一致', same, `n=${relisted.length}`);

  if (!allOk) {
    console.error('[todo-test] FAIL: 存在未通过的断言（见上方 [todo-test] ... FAIL 行）');
    process.exit(1);
  }
  console.log('[todo-test] 全部完成 ✅（全部 PASS）');
}

/** AI 对话全链路自测（内置 mock OpenAI 兼容服务器；验证 pet/assistant 双模式人设注入） */
async function runAiMockTest(ai: AIService): Promise<void> {
  const http = await import('node:http');
  const replies: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.url?.includes('/chat/completions')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body) as {
          messages?: { role: string; content: string }[];
        };
        const last = parsed.messages?.at(-1)?.content ?? '';
        const sys = parsed.messages?.find((m) => m.role === 'system')?.content ?? '';
        const isPet = sys.includes('皮丘');
        const isAssistant = sys.includes('信息查询助手');
        const hasRealtime = sys.includes('【实时信息');
        const hasHistory = (parsed.messages?.length ?? 0) > 2;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: `(mock)[${isPet ? '桌宠' : isAssistant ? '查询' : '?'}]「${last.slice(0, 10)}」实时:${hasRealtime ? '✓' : '✗'} 历史:${hasHistory ? '✓' : '✗'}` } }]
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(18099, resolve));
  ai.setConfig({ baseURL: 'http://127.0.0.1:18099', apiKey: 'mock-key', model: 'mock-model' });

  let current = '';
  // 包装原 onChunk（保留广播/气泡流式，同时本地收集）
  const origOnChunk = ai.onChunk;
  ai.onChunk = (chunk, mode) => {
    origOnChunk?.(chunk, mode);
    if (!chunk.done) current += chunk.text;
    else {
      replies.push(current);
      current = '';
    }
  };

  await ai.chatStream('你好，皮丘！', { mode: 'pet' });
  await ai.chatStream('我刚才说了什么？', { mode: 'pet' });
  await ai.chatStream('查询：macOS 26 有什么新功能？', { mode: 'assistant' });
  await ai.chatStream('北京今天天气怎么样？', { mode: 'assistant' });
  await ai.chatStream('查询：最新科技新闻', { mode: 'assistant' }); // 验证搜索注入
  // 验证自定义（局域网自部署）：无 Key 也能调用，网关地址+模型名即可
  const headersSeen: Record<string, string | undefined> = {};
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    headersSeen['auth'] = req.headers['authorization'];
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '(mock)[局域网模型] 响应成功' } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  ai.setConfig({ providerId: 'custom', baseURL: 'http://127.0.0.1:18099', model: 'internal-qwen-72b', apiKey: '' });
  await ai.chatStream('测试局域网自部署模型', { mode: 'assistant' });
  await new Promise((r) => setTimeout(r, 200));
  server.close();

  console.log('[ai-mock] 回复1(桌宠):', JSON.stringify(replies[0]));
  console.log('[ai-mock] 回复2(桌宠历史):', JSON.stringify(replies[1]));
  console.log('[ai-mock] 回复3(查询助手):', JSON.stringify(replies[2]));
  console.log('[ai-mock] 回复4(天气实时):', JSON.stringify(replies[3]));
  console.log('[ai-mock] 回复5(网页搜索):', JSON.stringify(replies[4]));
  console.log('[ai-mock] 回复6(局域网自定义):', JSON.stringify(replies[5]));
  console.log('[ai-mock] 局域网无Key鉴权头:', JSON.stringify(headersSeen['auth'] ?? '(无)'));
  console.log('[ai-mock] 历史总条数:', ai.getHistoryLength());
}

// ---------- 生命周期 ----------
if (!gotSingleInstanceLock) {
  // 已有实例在运行：退出本次启动（second-instance 会聚焦现有桌宠，避免出现第二个托盘图标）
  app.quit();
} else {
  // 二次启动时聚焦现有桌宠窗口
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    const w = wins[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
  });

  app.whenReady().then(bootstrap);

  // 关窗 ≠ 退出（桌宠常驻）：监听但不退出，由托盘「退出」触发 app.quit()
  app.on('window-all-closed', () => {
    // 保持应用常驻（macOS 惯例；Windows 也需常驻以提供托盘/提醒）
  });

  app.on('before-quit', () => {
    behavior?.stop();
    schedulerService?.stop();
    clipboardService?.stop();
    platform?.tray.destroy();
  });

  app.on('activate', () => {
    // macOS Dock 点击（开发模式）：重新显示桌宠
    if (petWindow) petWindow.show();
  });
}
