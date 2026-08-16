/**
 * 橘猫渲染器（Canvas 程序化形象）
 *
 * 绘制一只可爱的橘色虎斑猫：橙色条纹 + 白肚皮/口鼻 + 粉色内耳 + 琥珀竖瞳 + 摇摆尾巴。
 * 动画：呼吸起伏、尾巴摇摆、耳朵抖动、眨眼。
 * 表情：normal / happy / sad / angry / sleep / surprised / eat。
 * 无外部资源、零许可风险；Live2D 模型未来可无缝替换（main.ts 切换渲染模式）。
 */

export type CatExpression = 'normal' | 'happy' | 'sad' | 'angry' | 'sleep' | 'surprised' | 'eat';

export interface CatRenderState {
  expression: CatExpression;
  /** 0-1：眼睛睁开程度（眨眼/睡眠用） */
  eyeOpen: number;
  /** 0-1：情绪强度（用于耳朵抖动/尾巴频率） */
  excitement: number;
}

interface CatPalette {
  fur: string;
  furDark: string;
  stripe: string;
  belly: string;
  earInner: string;
  nose: string;
  outline: string;
  eye: string;
  eyePupil: string;
}

const PALETTE: CatPalette = {
  fur: '#f5a623', // 橘色
  furDark: '#e08b1d',
  stripe: '#d97a1b', // 深橘条纹
  belly: '#fff4e0', // 奶白肚皮
  earInner: '#ffb3c0', // 粉内耳
  nose: '#ff8f9e',
  outline: '#7a4a15',
  eye: '#ffd76e', // 琥珀眼
  eyePupil: '#2a2018'
};

/**
 * 橘猫绘制器：纯绘制逻辑，动画参数由外部（rAF 循环）更新后调用 draw()。
 */
export class OrangeCat {
  readonly cx: number;
  readonly cy: number;
  /** 头半径 */
  readonly r: number;
  private tailPhase = 0;
  private earTwitchTimer = 0;
  private breathingPhase = 0;

  constructor(width: number, height: number) {
    this.cx = width / 2;
    this.cy = height / 2 - 10;
    this.r = Math.min(width, height) * 0.28;
  }

  /** 更新动画相位（每帧调用） */
  update(dtMs: number): void {
    this.breathingPhase += dtMs / 1000;
    this.tailPhase += dtMs / 700;
    this.earTwitchTimer += dtMs;
  }

  draw(ctx: CanvasRenderingContext2D, state: CatRenderState): void {
    const { r, cx, cy } = this;
    const breathe = Math.sin(this.breathingPhase * 2) * 0.012 * r;
    const tailSwing = Math.sin(this.tailPhase) * 0.5;
    const earTwitch = this.earTwitchTimer > 5000 ? Math.sin(this.earTwitchTimer / 60) * 6 : 0;
    if (this.earTwitchTimer > 5400) this.earTwitchTimer = 0;

    ctx.save();

    // ---- 尾巴（画在身体后面） ----
    ctx.strokeStyle = PALETTE.fur;
    ctx.lineWidth = r * 0.24;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const tailBaseX = cx + r * 1.05;
    const tailBaseY = cy + r * 0.75;
    const t1 = tailSwing * r * 0.35;
    ctx.moveTo(tailBaseX, tailBaseY);
    ctx.quadraticCurveTo(
      tailBaseX + r * 0.5 + t1,
      tailBaseY - r * 0.35,
      tailBaseX + r * 0.75 + t1 * 1.4,
      tailBaseY - r * 0.75
    );
    ctx.stroke();
    // 尾巴尖条纹
    ctx.strokeStyle = PALETTE.stripe;
    ctx.lineWidth = r * 0.24;
    ctx.beginPath();
    const tipX = tailBaseX + r * 0.75 + t1 * 1.4;
    const tipY = tailBaseY - r * 0.75;
    ctx.moveTo(tipX - r * 0.1, tipY + r * 0.12);
    ctx.lineTo(tipX + r * 0.08, tipY - r * 0.1);
    ctx.stroke();

    // ---- 身体（椭圆 + 白肚皮 + 背条纹） ----
    const bodyY = cy + r * 0.95;
    ctx.fillStyle = PALETTE.fur;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY + breathe, r * 0.95, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 肚皮
    ctx.fillStyle = PALETTE.belly;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY + breathe + r * 0.12, r * 0.55, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // 背部条纹（身体上半）
    ctx.strokeStyle = PALETTE.stripe;
    ctx.lineWidth = r * 0.09;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      const x = cx + i * r * 0.32;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.05, bodyY - r * 0.55 + breathe);
      ctx.quadraticCurveTo(x + r * 0.1, bodyY - r * 0.3, x, bodyY - r * 0.05);
      ctx.stroke();
    }
    // 前爪
    ctx.fillStyle = PALETTE.belly;
    for (const dx of [-r * 0.3, r * 0.3]) {
      ctx.beginPath();
      ctx.ellipse(cx + dx, bodyY + r * 0.75 + breathe, r * 0.16, r * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PALETTE.outline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ---- 耳朵（外橙内粉，可抖动） ----
    const earL = { x: cx - r * 0.62, y: cy - r * 0.55 };
    const earR = { x: cx + r * 0.62, y: cy - r * 0.55 };
    const drawEar = (baseX: number, twitch: number): void => {
      const ex = baseX + twitch;
      ctx.fillStyle = PALETTE.fur;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.32, cy - r * 0.42);
      ctx.lineTo(ex + r * 0.02, cy - r * 1.05 + twitch * 0.3);
      ctx.lineTo(ex + r * 0.34, cy - r * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = PALETTE.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = PALETTE.earInner;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.2, cy - r * 0.52);
      ctx.lineTo(ex + r * 0.02, cy - r * 0.9 + twitch * 0.3);
      ctx.lineTo(ex + r * 0.22, cy - r * 0.52);
      ctx.closePath();
      ctx.fill();
    };
    drawEar(earL.x, earTwitch);
    drawEar(earR.x, -earTwitch);

    // ---- 头 ----
    ctx.fillStyle = PALETTE.fur;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
    // 额头条纹
    ctx.strokeStyle = PALETTE.stripe;
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.16, cy - r * 0.92);
    ctx.quadraticCurveTo(cx, cy - r * 0.7, cx + r * 0.16, cy - r * 0.92);
    ctx.moveTo(cx - r * 0.38, cy - r * 0.85);
    ctx.quadraticCurveTo(cx - r * 0.18, cy - r * 0.68, cx - r * 0.1, cy - r * 0.8);
    ctx.moveTo(cx + r * 0.38, cy - r * 0.85);
    ctx.quadraticCurveTo(cx + r * 0.18, cy - r * 0.68, cx + r * 0.1, cy - r * 0.8);
    ctx.stroke();

    // ---- 白口鼻区 ----
    ctx.fillStyle = PALETTE.belly;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy - r * 0.05);
    ctx.quadraticCurveTo(cx - r * 0.35, cy + r * 0.45, cx, cy + r * 0.55);
    ctx.quadraticCurveTo(cx + r * 0.35, cy + r * 0.45, cx + r * 0.45, cy - r * 0.05);
    ctx.quadraticCurveTo(cx, cy - r * 0.18, cx - r * 0.45, cy - r * 0.05);
    ctx.closePath();
    ctx.fill();

    // ---- 眼睛 ----
    this.drawEyes(ctx, state, r);

    // ---- 鼻子 + 嘴 ----
    ctx.fillStyle = PALETTE.nose;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.09, cy + r * 0.12);
    ctx.lineTo(cx + r * 0.09, cy + r * 0.12);
    ctx.lineTo(cx, cy + r * 0.26);
    ctx.closePath();
    ctx.fill();
    this.drawMouth(ctx, state, r);

    // ---- 胡须 ----
    ctx.strokeStyle = 'rgba(90, 60, 30, 0.7)';
    ctx.lineWidth = 1.2;
    for (const dir of [-1, 1]) {
      const sx = cx + dir * r * 0.42;
      for (let i = 0; i < 3; i++) {
        const sy = cy + r * (0.05 + i * 0.14);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + dir * r * 0.55, sy - r * 0.08 + i * r * 0.1);
        ctx.stroke();
      }
    }

    // ---- 腮红 ----
    ctx.fillStyle = 'rgba(255, 140, 150, 0.4)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.55, cy + r * 0.3, r * 0.13, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.55, cy + r * 0.3, r * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawEyes(ctx: CanvasRenderingContext2D, state: CatRenderState, r: number): void {
    const { cx, cy } = this;
    const eyeY = cy - r * 0.08;
    const eyeDx = r * 0.3;
    const eyeW = r * 0.2;
    const eyeH = r * 0.3;
    const open = state.eyeOpen;

    const drawEye = (x: number): void => {
      if (state.expression === 'sleep' || open < 0.05) {
        // 闭眼：弯线
        ctx.strokeStyle = PALETTE.outline;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, eyeY, eyeW * 0.9, Math.PI * 0.12, Math.PI * 0.88);
        ctx.stroke();
        return;
      }
      if (state.expression === 'happy') {
        ctx.strokeStyle = PALETTE.outline;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, eyeY, eyeW * 0.9, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        return;
      }
      if (state.expression === 'angry') {
        // 眯眼 + 眉
        ctx.strokeStyle = PALETTE.outline;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x - eyeW, eyeY - eyeH * 0.6);
        ctx.lineTo(x + eyeW, eyeY - eyeH * 0.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - eyeW, eyeY + eyeH * 0.2);
        ctx.lineTo(x + eyeW, eyeY + eyeH * 0.6);
        ctx.stroke();
        return;
      }
      // 正常/惊讶：琥珀眼 + 竖瞳
      const h = eyeH * open;
      ctx.fillStyle = PALETTE.eye;
      ctx.beginPath();
      ctx.ellipse(x, eyeY, eyeW, Math.max(h, 2), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PALETTE.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (h > 4) {
        ctx.fillStyle = PALETTE.eyePupil;
        ctx.beginPath();
        ctx.ellipse(x, eyeY, eyeW * 0.32, Math.max(h * 0.75, 2), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x - eyeW * 0.3, eyeY - h * 0.3, eyeW * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    drawEye(cx - eyeDx);
    drawEye(cx + eyeDx);
  }

  private drawMouth(ctx: CanvasRenderingContext2D, state: CatRenderState, r: number): void {
    const { cx, cy } = this;
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 1.8;
    if (state.expression === 'eat') {
      ctx.fillStyle = '#7a4a15';
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.34, r * 0.12, r * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (state.expression === 'sad') {
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.42, r * 0.14, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      return;
    }
    if (state.expression === 'happy' || state.expression === 'surprised') {
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.3, r * 0.14, 0, Math.PI);
      ctx.stroke();
      return;
    }
    // 普通 w 嘴
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.26);
    ctx.quadraticCurveTo(cx - r * 0.1, cy + r * 0.36, cx - r * 0.16, cy + r * 0.3);
    ctx.moveTo(cx, cy + r * 0.26);
    ctx.quadraticCurveTo(cx + r * 0.1, cy + r * 0.36, cx + r * 0.16, cy + r * 0.3);
    ctx.stroke();
  }
}
