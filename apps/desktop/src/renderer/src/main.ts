/**
 * 渲染层：橘猫桌宠（默认形象）
 *
 * 渲染模式：
 * - 'cat'（默认）：Canvas 程序化橘猫（零许可风险，形象可控）
 * - 'live2d'：Live2D 模型（aidang_2，已就绪；未来可换合规模型）
 *
 * 架构：主进程行为控制器产出命令（pet:command）→ 本层映射为表情/动作。
 * 交互：点击（命中头部/身体）→ pet.click；拖拽 → dragStart/dragMove/dragEnd；
 *       鼠标进入/移动 → userActivity；拖放文件 → pet.feed('random-file')。
 */
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { install } from '@pixi/unsafe-eval';
import type { PetActionCommand } from '@desktop-helper/platform-api';
import { OrangeCat, type CatExpression } from './cat';

// CSP 禁用了 unsafe-eval，PixiJS v6 需要 eval → 安装官方补丁（仅 live2d 模式需要，先装无副作用）
install(PIXI);

/** 渲染模式：默认 Live2D（皮丘 Pichu 模型）；改 'cat' 使用 Canvas 橘猫 */
let RENDER_MODE: 'cat' | 'live2d' = 'live2d';
const MODEL_URL = 'live2d/pichu/Pichu.model3.json';

// 命令动作 → 表情（cat 模式）
const ACTION_TO_EXPRESSION: Record<string, CatExpression> = {
  idle: 'normal',
  idle_yawn: 'normal',
  idle_groom: 'normal',
  idle_stretch: 'normal',
  happy: 'happy',
  sad: 'sad',
  sleep: 'sleep',
  wake: 'surprised',
  watch: 'normal',
  chase: 'normal',
  pounce: 'surprised',
  eat: 'eat',
  pet_head: 'happy',
  pet_body: 'happy',
  angry: 'angry'
};

// 命令动作 → Live2D 模型动作组（皮丘仅有 Idle 呼吸动作，全部映射到 Idle）
const ACTION_TO_MOTION: Record<string, string> = {
  idle: 'Idle',
  idle_yawn: 'Idle',
  idle_groom: 'Idle',
  idle_stretch: 'Idle',
  happy: 'Idle',
  sad: 'Idle',
  sleep: 'Idle',
  wake: 'Idle',
  watch: 'Idle',
  chase: 'Idle',
  pounce: 'Idle',
  eat: 'Idle',
  pet_head: 'Idle',
  pet_body: 'Idle',
  angry: 'Idle'
};

// 命令动作 → Live2D 表情（皮丘模型自带 5 个表情：Angry/Dispair/Happy/Sad/Shock；未映射的回到默认）
const ACTION_TO_LIVE2D_EXPRESSION: Record<string, string> = {
  happy: 'Happy',
  sad: 'Sad',
  angry: 'Angry',
  wake: 'Shock',
  pounce: 'Shock',
  pet_head: 'Happy',
  pet_body: 'Happy'
};

// ---------- DOM ----------
const petCanvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
const overlayCtx = overlayCanvas.getContext('2d')!;
const stateLine = document.getElementById('state-line')!;
const metaLine = document.getElementById('meta-line')!;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;

// 窗口尺寸动态化：气泡对话时会扩展高度（区域不写死）
const BASE_W = 260;
const BASE_H = 260;
const dpr = window.devicePixelRatio || 1;
let W = window.innerWidth;
let H = window.innerHeight;
overlayCanvas.width = W * dpr;
overlayCanvas.height = H * dpr;
overlayCtx.scale(dpr, dpr);

window.addEventListener('resize', () => {
  applyWindowSize(window.innerWidth, window.innerHeight);
});

// 主进程主动推送窗口尺寸（气泡扩展时，比 DOM resize 事件可靠）
window.pet.onWindowResized(({ width, height }) => {
  applyWindowSize(width, height);
});

function applyWindowSize(width: number, height: number): void {
  W = width;
  H = height;
  overlayCanvas.width = W * dpr;
  overlayCanvas.height = H * dpr;
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (petCanvas.width !== Math.round(W * dpr)) petCanvas.width = Math.round(W * dpr);
  if (petCanvas.height !== Math.round(H * dpr)) petCanvas.height = Math.round(H * dpr);
  // Pixi renderer 同步尺寸（否则窗口 resize 后模型渲染异常）
  if (live2dApp) {
    try {
      live2dApp.renderer.resize(W, H);
    } catch {
      /* 忽略 */
    }
  }
  anchorModelToBottom();
}

// ---------- 气泡/粒子（overlay） ----------
let bubble: { text: string; until: number } | null = null;
const particles: { x: number; y: number; vy: number; life: number; maxLife: number; size: number; char: string }[] = [];

/** 文本按宽度换行 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    let line = '';
    for (const ch of raw) {
      if (ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

/** 短反馈气泡（喂食/抚摸等；AI 长回复走独立气泡窗口，不占桌宠窗口） */
function drawBubble(): void {
  if (!bubble || Date.now() > bubble.until) {
    bubble = null;
    return;
  }

  const text = bubble.text;
  const maxW = 170;
  const lineH = 15;
  const lines = wrapText(overlayCtx, text, maxW);
  const w = maxW + 20;
  const h = Math.max(lines.length * lineH + 14, 30);
  const cx = W / 2;
  // 气泡锚定在模型顶部上方
  const modelTop = usingLive2D && model ? H - modelAnchorH - 10 : H - cat.r * 2.6;
  const y = Math.max(6, modelTop - h - 10);
  const x = cx - w / 2;

  overlayCtx.fillStyle = 'rgba(255,255,255,0.96)';
  overlayCtx.strokeStyle = 'rgba(180,180,180,0.8)';
  overlayCtx.lineWidth = 1;
  overlayCtx.beginPath();
  overlayCtx.roundRect(x, y, w, h, 10);
  overlayCtx.fill();
  overlayCtx.stroke();
  overlayCtx.beginPath();
  overlayCtx.moveTo(cx - 6, y + h);
  overlayCtx.lineTo(cx, y + h + 8);
  overlayCtx.lineTo(cx + 6, y + h);
  overlayCtx.closePath();
  overlayCtx.fill();
  overlayCtx.stroke();

  overlayCtx.fillStyle = '#333';
  overlayCtx.font = '12px sans-serif';
  overlayCtx.textAlign = 'center';
  overlayCtx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    overlayCtx.fillText(line, cx, y + h / 2 - ((lines.length - 1) * lineH) / 2 + i * lineH);
  });
}

function drawParticles(): void {
  for (const p of particles) {
    const alpha = 1 - p.life / p.maxLife;
    overlayCtx.fillStyle = `rgba(255, 90, 120, ${alpha})`;
    overlayCtx.font = `${p.size}px sans-serif`;
    overlayCtx.fillText(p.char, p.x, p.y);
  }
}

function spawnHearts(n: number): void {
  for (let i = 0; i < n; i++) {
    particles.push({
      x: W / 2 + (Math.random() - 0.5) * 60,
      y: H / 2 - 10,
      vy: -(1.2 + Math.random() * 1.6),
      life: 0,
      maxLife: 50 + Math.random() * 30,
      size: 10 + Math.random() * 8,
      char: '♥'
    });
  }
}

function overlayFrame(): void {
  anchorModelToBottom(); // 窗口尺寸恒定时模型位置固定
  overlayCtx.clearRect(0, 0, W, H);
  drawBubble();
  drawParticles();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.life++;
    p.y += p.vy;
    if (p.life > p.maxLife) particles.splice(i, 1);
  }
  requestAnimationFrame(overlayFrame);
}

// ---------- 橘猫渲染（默认） ----------
const cat = new OrangeCat(W, H);
let catExpression: CatExpression = 'normal';
let blinkTimer = 0;

function catFrame(): void {
  const ctx = petCanvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // 眨眼
  blinkTimer += 16;
  let eyeOpen = 1;
  if (catExpression !== 'sleep') {
    if (blinkTimer > 3000) {
      const t = blinkTimer - 3000;
      if (t < 120) eyeOpen = Math.max(0, 1 - t / 60);
      else if (t < 160) eyeOpen = 0;
      else if (t < 280) eyeOpen = Math.min(1, (t - 160) / 60);
      else blinkTimer = 0;
    }
  } else {
    eyeOpen = 0;
    blinkTimer = 0;
  }

  cat.update(16);
  cat.draw(ctx, { expression: catExpression, eyeOpen, excitement: 0.5 });
  requestAnimationFrame(catFrame);
}

// ---------- Live2D 渲染（可选分支） ----------
let model: Live2DModel | null = null;
let usingLive2D = false;
let live2dApp: PIXI.Application | null = null;
/** 模型锚定高度（加载时固定一次，避免动画中 bounds 变化导致锚定跳动） */
let modelAnchorH = 0;

/** 模型 alpha 命中掩码（按模型实际占用区域，非方形、不写死） */
interface HitMask {
  grid: Uint8Array;
  gw: number;
  gh: number;
}
let hitMask: HitMask | null = null;

/** 模型锚定窗口底部（用固定锚定高度，屏幕位置绝对不变） */
function anchorModelToBottom(): void {
  if (!model) return;
  model.x = W / 2;
  model.y = H - modelAnchorH / 2 - 10;
}

/** 应用图标渲染模式：模型居中放大（透明底，供主进程生成应用图标） */
function renderIconMode(): void {
  if (!model) return;
  const scale = (H * 0.92) / modelAnchorH;
  model.scale.set(scale);
  model.anchor.set(0.5, 0.5);
  model.x = W / 2;
  model.y = H / 2;
}

/** 用 renderer.extract.pixels 生成模型 alpha 掩码（网格采样，点击命中用） */
function buildHitMask(app: PIXI.Application): void {
  const m = model;
  if (!m) return;
  try {
    // pixi 6 Renderer.extract 的类型定义不完整，此处以运行时 API 为准
    const renderer = app.renderer as unknown as {
      extract: { pixels(obj: unknown): Uint8Array };
    };
    const b = m.getBounds();
    const mw = Math.max(1, Math.round(b.width));
    const mh = Math.max(1, Math.round(b.height));
    // 手动离屏渲染到受控尺寸的 RenderTexture，再提取像素（绕开 extract.pixels(obj, region) 的 bug）
    const maskScale = Math.min(1, 256 / Math.max(mw, mh));
    const tw = Math.max(1, Math.round(mw * maskScale));
    const th = Math.max(1, Math.round(mh * maskScale));
    const rt = PIXI.RenderTexture.create({ width: tw, height: th });
    const saved = { x: m.x, y: m.y, scaleX: m.scale.x, scaleY: m.scale.y };
    m.scale.set(m.scale.x * maskScale, m.scale.y * maskScale);
    m.position.set(tw / 2, th / 2);
    app.renderer.render(m, rt as never);
    m.position.set(saved.x, saved.y);
    m.scale.set(saved.scaleX, saved.scaleY);
    const raw = renderer.extract.pixels(rt) as Uint8Array;
    rt.destroy(true);

    const gw = 64;
    const gh = Math.max(1, Math.round((gw * mh) / mw));
    const grid = new Uint8Array(gw * gh);
    let hits = 0;
    for (let gy = 0; gy < gh; gy++) {
      const py = Math.min(th - 1, Math.floor(((gy + 0.5) / gh) * th));
      for (let gx = 0; gx < gw; gx++) {
        const px = Math.min(tw - 1, Math.floor(((gx + 0.5) / gw) * tw));
        const idx = (py * tw + px) * 4;
        if (idx + 3 < raw.length && (raw[idx + 3] ?? 0) > 16) {
          grid[gy * gw + gx] = 1;
          hits++;
        }
      }
    }
    hitMask = { grid, gw, gh };
    console.log(`[renderer] 命中掩码: ${gw} x ${gh}（命中 ${hits}/${gw * gh}）`);
  } catch (err) {
    console.warn('[renderer] 掩码生成失败，回退包围盒:', err);
    hitMask = null;
  }
}

async function initLive2D(): Promise<void> {
  const app = new PIXI.Application({
    view: petCanvas,
    backgroundAlpha: 0,
    resolution: dpr,
    autoDensity: true,
    antialias: true,
    preserveDrawingBuffer: true // 允许 canvas.toDataURL 读取（应用图标生成用）
  });
  live2dApp = app;
  Live2DModel.registerTicker(PIXI.Ticker);
  try {
    model = await Live2DModel.from(MODEL_URL);
    const scale = (H * 0.9) / model.height;
    model.scale.set(scale);
    model.anchor.set(0.5, 0.5);
    app.stage.addChild(model);
    // 固定锚定高度（动画中 getBounds 会变化，但锚定用固定值保持稳定）
    modelAnchorH = model.getBounds().height;
    anchorModelToBottom();
    buildHitMask(app);
    void playMotion('Idle');
    usingLive2D = true;
    metaLine.textContent = `live2d: pichu`;
  } catch (err) {
    console.warn('[renderer] Live2D 加载失败，回退橘猫:', err);
    usingLive2D = false;
    app.destroy(true);
    live2dApp = null;
    startCat();
  }
}

async function playMotion(group: string): Promise<void> {
  if (!model) return;
  try {
    await model.motion(group);
  } catch {
    try {
      await model.motion('Idle');
    } catch {
      /* 忽略 */
    }
  }
}

async function playExpression(name: string | null): Promise<void> {
  if (!model) return;
  try {
    if (name) {
      await model.expression(name);
    } else {
      // expressionManager 类型定义不完整（pixi-live2d-display），运行时存在
      (model as unknown as { expressionManager?: { resetExpression(): void } }).expressionManager?.resetExpression();
    }
  } catch {
    /* 忽略 */
  }
}

// ---------- 命令处理 ----------
function applyAction(cmd: PetActionCommand): void {
  if (cmd.bubble) bubble = { text: cmd.bubble, until: Date.now() + 2200 };
  if (usingLive2D) {
    const group = ACTION_TO_MOTION[cmd.action] ?? 'Idle';
    void playMotion(group);
    void playExpression(ACTION_TO_LIVE2D_EXPRESSION[cmd.action] ?? null);
  } else {
    catExpression = ACTION_TO_EXPRESSION[cmd.action] ?? 'normal';
  }
  if (cmd.action === 'pounce' || cmd.action === 'pet_head' || cmd.action === 'pet_body' || cmd.action === 'happy') {
    spawnHearts(cmd.action === 'pounce' ? 5 : 4);
  }
}

function startCat(): void {
  usingLive2D = false;
  metaLine.textContent = '🐱 橘猫 · canvas';
  requestAnimationFrame(catFrame);
}

// ---------- 交互 ----------
let dragging = false;
let downAt = { x: 0, y: 0 };
let dragMoved = false;

/** 双击桌宠 → 气泡对话模式（弹出输入框；回复在桌宠上方的独立气泡窗口呈现，桌宠不动） */
function onDoubleClick(e: MouseEvent): void {
  if (!hitPart(e.clientX, e.clientY)) return; // 只响应形象区域
  chatInput.style.display = 'block';
  chatInput.value = '';
  chatInput.focus();
  void window.pet.setClickThrough(false);
}

/** 右键菜单项（可扩展：后续添加更多项） */
interface ContextMenuItem {
  id: string;
  label: string;
  action: () => void;
}

const CONTEXT_MENU_ITEMS: ContextMenuItem[] = [
  { id: 'chat', label: '💬 聊天框', action: () => void window.pet.openChat() },
  { id: 'clipboard', label: '📋 剪贴板历史', action: () => void window.pet.clipboardOpen() },
  { id: 'file-search', label: '🔍 文件搜索', action: () => void window.pet.fileSearchOpen() },
  { id: 'calendar', label: '📅 日程管理', action: () => void window.pet.calendarOpen() },
  { id: 'pomodoro', label: '🍅 番茄钟', action: () => void window.pet.pomodoroOpen() },
  { id: 'todo', label: '✅ 待办清单', action: () => void window.pet.todoOpen() },
  { id: 'hide', label: '🙈 隐藏桌宠', action: () => void window.pet.hidePet() }
  // 后续可加：AI 设置、喂食、退出 等
];

const contextMenuEl = document.getElementById('context-menu') as HTMLDivElement;

function hideContextMenu(): void {
  contextMenuEl.style.display = 'none';
}

function showContextMenu(x: number, y: number): void {
  // 构建菜单项
  contextMenuEl.innerHTML = '';
  for (const item of CONTEXT_MENU_ITEMS) {
    const div = document.createElement('div');
    div.className = 'menu-item';
    div.textContent = item.label;
    div.addEventListener('click', () => {
      hideContextMenu();
      item.action();
    });
    contextMenuEl.appendChild(div);
  }
  // 位置 clamp 在窗口内
  const menuW = 150;
  const menuH = CONTEXT_MENU_ITEMS.length * 32 + 8;
  contextMenuEl.style.left = `${Math.min(x, W - menuW - 4)}px`;
  contextMenuEl.style.top = `${Math.min(y, H - menuH - 4)}px`;
  contextMenuEl.style.display = 'block';
  void window.pet.setClickThrough(false);
}

/** 右键桌宠 → 弹出右键菜单（当前含聊天框，可扩展） */
function onContextMenu(e: MouseEvent): void {
  e.preventDefault();
  if (!hitPart(e.clientX, e.clientY)) return;
  showContextMenu(e.clientX, e.clientY);
}

// 点击其他区域/失焦隐藏菜单
petCanvas.addEventListener('mousedown', (e) => {
  if (contextMenuEl.style.display === 'block' && !contextMenuEl.contains(e.target as Node)) {
    hideContextMenu();
  }
});

/** 发送消息：桌宠闲聊（气泡模式），由主进程在桌宠上方气泡窗口流式呈现 */
async function sendChat(): Promise<void> {
  const text = chatInput.value.trim();
  chatInput.style.display = 'none';
  if (!text) return;
  const res = await window.pet.aiChat(text, 'pet');
  if (!res.ok) {
    // 失败反馈：本地气泡显示错误原因（如未配置 AI Key）
    bubble = { text: `⚠️ ${res.error ?? '发送失败'}`, until: Date.now() + 4000 };
  }
}

chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void sendChat();
  } else if (e.key === 'Escape') {
    chatInput.style.display = 'none';
  }
});

/** 点击命中判定：模型 alpha 掩码（非方形、随模型动态）；上半 head / 下半 body */
function hitPart(x: number, y: number): 'head' | 'body' | null {
  if (usingLive2D && model) {
    const b = model.getBounds();
    if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height) return null;
    // 掩码命中：透明区域（模型轮廓外）点击不响应
    if (hitMask) {
      const lx = Math.min(0.999, Math.max(0, (x - b.x) / b.width));
      const ly = Math.min(0.999, Math.max(0, (y - b.y) / b.height));
      const gx = Math.floor(lx * hitMask.gw);
      const gy = Math.floor(ly * hitMask.gh);
      if (!hitMask.grid[gy * hitMask.gw + gx]) return null;
    }
    return y < b.y + b.height * 0.45 ? 'head' : 'body';
  }
  // 橘猫：头圆 + 身体椭圆近似
  const r = cat.r;
  const headHit = Math.hypot(x - cat.cx, y - (cat.cy - r * 0.1)) <= r * 1.05;
  const bodyHit = Math.hypot((x - cat.cx) / 0.95, (y - (cat.cy + r * 0.85)) / 0.85) <= r * 0.95;
  if (headHit) return 'head';
  if (bodyHit) return 'body';
  return null;
}

function onMouseMove(e: MouseEvent): void {
  void window.pet.setClickThrough(false);
  void window.pet.userActivity();
  if (dragging) {
    const dx = e.clientX - downAt.x;
    const dy = e.clientY - downAt.y;
    if (Math.abs(dx) + Math.abs(dy) > 8) {
      dragMoved = true;
      void window.pet.dragMove(dx, dy);
    }
  }
}

function onMouseDown(e: MouseEvent): void {
  dragging = true;
  dragMoved = false;
  downAt = { x: e.clientX, y: e.clientY };
}

function onMouseUp(e: MouseEvent): void {
  if (!dragging) return;
  const wasDrag = dragMoved;
  dragging = false;
  if (wasDrag) {
    void window.pet.dragEnd();
  } else {
    const part = hitPart(e.clientX, e.clientY);
    void window.pet.click({ x: e.clientX, y: e.clientY, hitPart: part });
  }
}

function onMouseLeave(): void {
  if (!dragging) void window.pet.setClickThrough(true);
}

function onDrop(e: DragEvent): void {
  e.preventDefault();
  void window.pet.feed('random-file');
  void window.pet.userActivity();
}

petCanvas.addEventListener('mousemove', onMouseMove);
petCanvas.addEventListener('mousedown', onMouseDown);
petCanvas.addEventListener('mouseup', onMouseUp);
petCanvas.addEventListener('mouseleave', onMouseLeave);
petCanvas.addEventListener('dblclick', onDoubleClick);
petCanvas.addEventListener('contextmenu', onContextMenu);
petCanvas.addEventListener('dragenter', (e) => e.preventDefault());
petCanvas.addEventListener('dragover', (e) => e.preventDefault());
petCanvas.addEventListener('drop', onDrop);
window.addEventListener('mouseup', () => {
  if (dragging && dragMoved) void window.pet.dragEnd();
  dragging = false;
});

// ---------- 订阅主进程 ----------
window.pet.onPetState((t) => {
  stateLine.textContent = `state: ${t.from} → ${t.to} (${t.reason})`;
});

window.pet.onCommand((cmd) => {
  applyAction(cmd);
});

void window.pet.getState().then((s) => {
  // 调试面板默认隐藏，仅 PET_DEBUG=1 时显示（状态机日志/版本信息）
  const debug = document.getElementById('debug');
  if (debug) debug.style.display = s.debug ? 'block' : 'none';
  if (s.debug) {
    metaLine.textContent = usingLive2D
      ? `live2d: pichu · electron=${s.electron}`
      : `🐱 橘猫 · electron=${s.electron}`;
  }
});

// ---------- 启动 ----------
overlayFrame();
// 供主进程验证模式读取内部状态（executeJavaScript 只能访问全局）
(window as unknown as Record<string, unknown>).__petDebug = () => ({
  W,
  H,
  modelY: model ? model.y : -1,
  modelBH: model ? modelAnchorH : -1
});
// 供主进程生成应用图标：切换到图标渲染模式（模型居中放大）
(window as unknown as Record<string, unknown>).__renderIcon = () => {
  renderIconMode();
};
// 供主进程生成应用图标：切换图标模式并返回 Pixi canvas 的 PNG dataURL（透明底，绕开 capturePage 合成问题）
(window as unknown as Record<string, unknown>).__captureIconPng = () =>
  new Promise((resolve) => {
    renderIconMode();
    setTimeout(() => {
      try {
        resolve(petCanvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    }, 400);
  });
// 供主进程生成托盘动画帧：图标模式下按固定间隔连拍 count 帧。
// 图标模式不停止 PIXI.Ticker，Live2D 呼吸/眨眼动画持续播放 → 帧间有相位差，构成动态托盘图标。
(window as unknown as Record<string, unknown>).__captureFrames = (count = 4, intervalMs = 300) =>
  new Promise((resolve) => {
    renderIconMode();
    const frames: (string | null)[] = [];
    let i = 0;
    const step = (): void => {
      setTimeout(() => {
        try {
          frames.push(petCanvas.toDataURL('image/png'));
        } catch {
          frames.push(null);
        }
        i++;
        if (i < count) step();
        else resolve(frames);
      }, intervalMs);
    };
    step();
  });
// 供主进程直接把系统 🐾 emoji 渲染为托盘图标（用户要求"直接使用🐾"）：
// 系统 emoji 字体（Apple Color Emoji）渲染 → 保留 alpha、RGB 置黑（模板图）→
// 内容裁剪去字体 padding → 缩放 16x16 → count 帧呼吸灯 dataURL 数组。
// 运行时执行 → 图标形状与用户看到的 🐾 完全一致。
(window as unknown as Record<string, unknown>).__renderEmojiFrames = (
  emoji: string,
  count = 20
): Promise<(string | null)[]> =>
  new Promise((resolve) => {
    try {
      const size = 160; // 高清渲染，缩放 16x16 保留形状
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      if (!ctx) {
        resolve([]);
        return;
      }
      ctx.font = '135px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, size / 2, size / 2 + size * 0.03);
      const img = ctx.getImageData(0, 0, size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = 0;
        img.data[i + 1] = 0;
        img.data[i + 2] = 0;
      }
      ctx.putImageData(img, 0, 0);
      // 内容边界裁剪（去 emoji 字体 padding，让形状占满 16px）
      let minX = size, minY = size, maxX = -1, maxY = -1;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (img.data[(y * size + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const cw = maxX - minX + 1;
      const ch = maxY - minY + 1;
      let side = Math.max(cw, ch) * 1.15;
      side = Math.min(side, size);
      const cx0 = Math.max(0, Math.min(minX + cw / 2 - side / 2, size - side));
      const cy0 = Math.max(0, Math.min(minY + ch / 2 - side / 2, size - side));
      const out = document.createElement('canvas');
      out.width = out.height = 16;
      const octx = out.getContext('2d');
      const frames: (string | null)[] = [];
      for (let f = 0; f < count; f++) {
        // 余弦呼吸：0.72 → 1.0 → 0.72（4s 周期，200ms/帧）
        const alphaMul = 0.72 + 0.28 * (1 - Math.cos((2 * Math.PI * f) / count)) / 2;
        octx.clearRect(0, 0, 16, 16);
        octx.globalAlpha = alphaMul;
        octx.drawImage(c, cx0, cy0, side, side, 0, 0, 16, 16);
        frames.push(out.toDataURL('image/png'));
      }
      resolve(frames);
    } catch {
      resolve([]);
    }
  });
if (RENDER_MODE === 'live2d') {
  void initLive2D();
} else {
  startCat();
}
