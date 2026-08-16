/**
 * 柴犬渲染器（Canvas 程序化形象 · 高质量版）
 *
 * 柴犬标志性元素：焦糖橘棕毛发 + 奶油白口鼻/脸颊/肚皮 + 额头白纹 + 眉毛白点 +
 * 豆豆眼 + 黑三角鼻 + 黑色 W 嘴线 + 吐舌 + 立耳 + 菊花卷尾巴。
 * 动画：呼吸起伏、卷尾巴轻摇、耳朵抖动、眨眼。
 * 表情：normal / happy / sad / angry / sleep / surprised / eat。
 * 零外部资源、零许可风险。
 */

export type ShibaExpression =
  | 'normal'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'sleep'
  | 'surprised'
  | 'eat';

export interface ShibaRenderState {
  expression: ShibaExpression;
  /** 0-1：眼睛睁开程度（眨眼/睡眠） */
  eyeOpen: number;
  /** 0-1：兴奋度（影响尾巴/耳朵动画频率） */
  excitement: number;
}

const C = {
  fur: '#e8a04c', // 焦糖橘棕
  furShade: '#d98b37',
  belly: '#fff7ea', // 奶油白
  outline: '#6b3a10',
  earInner: '#a86a2a', // 内耳深棕
  nose: '#2b2118', // 黑鼻
  eye: '#2b2118', // 豆豆眼黑
  blush: 'rgba(255, 130, 120, 0.45)',
  tongue: '#f78ba0'
};

/**
 * 柴犬绘制器：动画相位由 update() 推进，draw() 每帧绘制。
 */
export class ShibaInu {
  readonly cx: number;
  readonly cy: number;
  /** 头半径 */
  readonly r: number;

  private phase = 0;
  private earTimer = 0;

  constructor(width: number, height: number) {
    this.cx = width / 2;
    this.cy = height / 2 - 12;
    this.r = Math.min(width, height) * 0.27;
  }

  update(dtMs: number): void {
    this.phase += dtMs / 1000;
    this.earTimer += dtMs;
  }

  draw(ctx: CanvasRenderingContext2D, state: ShibaRenderState): void {
    const { r, cx, cy } = this;
    const breathe = Math.sin(this.phase * 2.2) * 0.01 * r;
    const tailSwing = Math.sin(this.phase * 1.8) * 0.35 * (0.6 + state.excitement * 0.8);
    const earTwitch =
      this.earTimer > 4800 ? Math.sin(this.earTimer / 55) * 5 : 0;
    if (this.earTimer > 5400) this.earTimer = 0;

    ctx.save();

    // ============ 卷尾巴（菊花尾，画在最底层，身体右侧） ============
    this.drawTail(ctx, tailSwing, breathe);

    // ============ 身体 ============
    const bodyY = cy + r * 1.0;
    // 毛色渐变（主体）
    const grad = ctx.createRadialGradient(cx - r * 0.3, bodyY - r * 0.2, r * 0.2, cx, bodyY, r * 1.1);
    grad.addColorStop(0, C.fur);
    grad.addColorStop(1, C.furShade);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY + breathe, r * 0.98, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
    // 白肚皮
    ctx.fillStyle = C.belly;
    ctx.beginPath();
    ctx.ellipse(cx, bodyY + breathe + r * 0.14, r * 0.58, r * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    // 前爪（白袜）
    ctx.fillStyle = C.belly;
    for (const dx of [-r * 0.28, r * 0.28]) {
      ctx.beginPath();
      ctx.ellipse(cx + dx, bodyY + r * 0.8 + breathe, r * 0.17, r * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // ============ 耳朵（立耳，外焦糖内深棕） ============
    const drawEar = (baseX: number, tw: number): void => {
      const ex = baseX + tw;
      ctx.fillStyle = C.fur;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.34, cy - r * 0.4);
      ctx.quadraticCurveTo(ex - r * 0.1, cy - r * 1.25 + tw * 0.4, ex + r * 0.06, cy - r * 1.02);
      ctx.quadraticCurveTo(ex + r * 0.18, cy - r * 0.78, ex + r * 0.36, cy - r * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = 2;
      ctx.stroke();
      // 内耳
      ctx.fillStyle = C.earInner;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.18, cy - r * 0.55);
      ctx.quadraticCurveTo(ex - r * 0.05, cy - r * 1.0 + tw * 0.35, ex + r * 0.05, cy - r * 0.86);
      ctx.quadraticCurveTo(ex + r * 0.12, cy - r * 0.68, ex + r * 0.2, cy - r * 0.55);
      ctx.closePath();
      ctx.fill();
    };
    drawEar(cx - r * 0.6, earTwitch);
    drawEar(cx + r * 0.6, -earTwitch);

    // ============ 头（宽圆脸） ============
    const headGrad = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.15, cx, cy, r * 1.15);
    headGrad.addColorStop(0, C.fur);
    headGrad.addColorStop(1, C.furShade);
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 额头 M 形白纹（柴犬特征：眉骨上方两道白弧汇于鼻梁）
    ctx.strokeStyle = C.belly;
    ctx.lineWidth = r * 0.16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.42, cy - r * 0.62);
    ctx.quadraticCurveTo(cx - r * 0.2, cy - r * 0.48, cx - r * 0.12, cy - r * 0.2);
    ctx.moveTo(cx + r * 0.42, cy - r * 0.62);
    ctx.quadraticCurveTo(cx + r * 0.2, cy - r * 0.48, cx + r * 0.12, cy - r * 0.2);
    ctx.stroke();

    // 眉毛白点（柴犬萌点：两眼上方的小白圆）
    ctx.fillStyle = C.belly;
    for (const dx of [-r * 0.34, r * 0.34]) {
      ctx.beginPath();
      ctx.arc(cx + dx, cy - r * 0.42, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // ============ 白色口鼻区（宽 W 形：口鼻 + 脸颊下缘） ============
    ctx.fillStyle = C.belly;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy - r * 0.15);
    ctx.quadraticCurveTo(cx - r * 0.55, cy + r * 0.62, cx, cy + r * 0.68);
    ctx.quadraticCurveTo(cx + r * 0.55, cy + r * 0.62, cx + r * 0.55, cy - r * 0.15);
    ctx.quadraticCurveTo(cx + r * 0.28, cy - r * 0.05, cx, cy - r * 0.1);
    ctx.quadraticCurveTo(cx - r * 0.28, cy - r * 0.05, cx - r * 0.55, cy - r * 0.15);
    ctx.closePath();
    ctx.fill();

    // ============ 眼睛（豆豆眼） ============
    this.drawEyes(ctx, state, r);

    // ============ 鼻子（黑三角） ============
    ctx.fillStyle = C.nose;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.1, cy + r * 0.12);
    ctx.lineTo(cx + r * 0.1, cy + r * 0.12);
    ctx.lineTo(cx, cy + r * 0.26);
    ctx.closePath();
    ctx.fill();
    // 鼻头高光
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.03, cy + r * 0.14, r * 0.03, r * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();

    // ============ 嘴（黑 W 线 + 吐舌） ============
    this.drawMouth(ctx, state, r);

    // ============ 脸颊腮红 ============
    if (state.expression === 'happy' || state.expression === 'surprised') {
      ctx.fillStyle = C.blush;
      ctx.beginPath();
      ctx.arc(cx - r * 0.56, cy + r * 0.28, r * 0.12, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.56, cy + r * 0.28, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ---------- 眼睛 ----------
  private drawEyes(ctx: CanvasRenderingContext2D, state: ShibaRenderState, r: number): void {
    const { cx, cy } = this;
    const eyeY = cy - r * 0.06;
    const eyeDx = r * 0.34;
    const eyeR = r * 0.11;

    const draw = (x: number): void => {
      if (state.expression === 'sleep' || state.eyeOpen < 0.05) {
        // 闭眼：向下弯的弧线（睡着的安心感）
        ctx.strokeStyle = C.outline;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(x, eyeY, eyeR * 1.05, Math.PI * 0.12, Math.PI * 0.88);
        ctx.stroke();
        return;
      }
      if (state.expression === 'happy') {
        // 开心：眯成弯线
        ctx.strokeStyle = C.outline;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(x, eyeY, eyeR * 1.1, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        return;
      }
      if (state.expression === 'angry') {
        // 生气：半闭 + 皱眉
        ctx.strokeStyle = C.outline;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(x - eyeR * 1.2, eyeY - eyeR * 0.5);
        ctx.lineTo(x + eyeR * 1.2, eyeY - eyeR * 0.2);
        ctx.moveTo(x - eyeR * 0.9, eyeY + eyeR * 0.55);
        ctx.lineTo(x + eyeR * 0.9, eyeY + eyeR * 0.2);
        ctx.stroke();
        return;
      }
      // 豆豆眼：黑圆 + 高光
      const s = state.expression === 'surprised' ? 1.5 : 1;
      ctx.fillStyle = C.eye;
      ctx.beginPath();
      ctx.arc(x, eyeY, eyeR * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x - eyeR * 0.35 * s, eyeY - eyeR * 0.3 * s, eyeR * 0.3 * s, 0, Math.PI * 2);
      ctx.fill();
    };
    draw(cx - eyeDx);
    draw(cx + eyeDx);
  }

  // ---------- 嘴 ----------
  private drawMouth(ctx: CanvasRenderingContext2D, state: ShibaRenderState, r: number): void {
    const { cx, cy } = this;
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 2;

    if (state.expression === 'eat' || state.expression === 'happy' || state.expression === 'surprised') {
      // 张嘴（进食/开心）：半圆嘴 + 粉色小舌
      ctx.fillStyle = '#5a2b10';
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.34, r * 0.16, r * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      if (state.expression === 'happy' || state.expression === 'surprised') {
        ctx.fillStyle = C.tongue;
        ctx.beginPath();
        ctx.ellipse(cx, cy + r * 0.42, r * 0.07, r * 0.1, 0, 0, Math.PI);
        ctx.fill();
      }
      return;
    }
    if (state.expression === 'sad') {
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.44, r * 0.14, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      return;
    }
    // 黑 W 嘴线（柴犬经典）
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.28);
    ctx.quadraticCurveTo(cx - r * 0.1, cy + r * 0.38, cx - r * 0.17, cy + r * 0.31);
    ctx.moveTo(cx, cy + r * 0.28);
    ctx.quadraticCurveTo(cx + r * 0.1, cy + r * 0.38, cx + r * 0.17, cy + r * 0.31);
    ctx.stroke();
  }

  // ---------- 卷尾巴（菊花尾） ----------
  private drawTail(ctx: CanvasRenderingContext2D, swing: number, breathe: number): void {
    const { r, cx, cy } = this;
    const baseX = cx + r * 1.02;
    const baseY = cy + r * 0.85 + breathe;
    ctx.strokeStyle = C.furShade;
    ctx.lineWidth = r * 0.3;
    ctx.lineCap = 'round';
    // 卷尾：从基部上扬再卷成圈
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(
      baseX + r * 0.55 + swing * r * 0.25,
      baseY - r * 0.15,
      baseX + r * 0.6 + swing * r * 0.35,
      baseY - r * 0.55
    );
    ctx.quadraticCurveTo(
      baseX + r * 0.62 + swing * r * 0.4,
      baseY - r * 0.85,
      baseX + r * 0.38 + swing * r * 0.4,
      baseY - r * 0.8
    );
    ctx.stroke();
    // 尾尖白毛
    ctx.strokeStyle = C.belly;
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    const tipX = baseX + r * 0.38 + swing * r * 0.4;
    const tipY = baseY - r * 0.8;
    ctx.moveTo(tipX + r * 0.1, tipY);
    ctx.quadraticCurveTo(tipX + r * 0.22, tipY - r * 0.12, tipX + r * 0.18, tipY - r * 0.24);
    ctx.stroke();
  }
}
