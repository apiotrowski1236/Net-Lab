import { css } from './color';
import type { Shape } from './types';

/**
 * Draws shapes on a real canvas, the way p5.js's 2D renderer does. `scale` maps
 * one sketch pixel to that many canvas pixels, for sharp lines on a retina screen.
 */
export function paint(ctx: CanvasRenderingContext2D, shapes: readonly Shape[], scale: number, size: { w: number; h: number }): void {
  for (const s of shapes) {
    if (s.kind === 'clear' || s.kind === 'background') {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      if (s.kind === 'clear') ctx.clearRect(0, 0, size.w, size.h);
      else {
        ctx.fillStyle = css(s.fill!);
        ctx.fillRect(0, 0, size.w, size.h);
      }
      continue;
    }
    const m = s.m ?? [1, 0, 0, 1, 0, 0];
    ctx.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale);
    const stroke = s.stroke && s.weight > 0 ? css(s.stroke) : undefined;
    const fill = s.fill ? css(s.fill) : undefined;
    ctx.lineWidth = s.weight;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';
    const g = s.g;
    const finish = (closed: boolean) => {
      if (fill && closed) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    };
    switch (s.kind) {
      case 'circle':
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(g[0] + g[2] / 2, g[1] + g[3] / 2, g[2] / 2, g[3] / 2, 0, 0, Math.PI * 2);
        finish(true);
        break;
      case 'rect':
      case 'square':
        ctx.beginPath();
        if (s.r) ctx.roundRect(g[0], g[1], g[2], g[3], Math.min(s.r, g[2] / 2, g[3] / 2));
        else ctx.rect(g[0], g[1], g[2], g[3]);
        finish(true);
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(g[0], g[1]);
        ctx.lineTo(g[2], g[3]);
        finish(false);
        break;
      case 'point':
        if (!stroke) break;
        ctx.beginPath();
        ctx.fillStyle = stroke;
        ctx.arc(g[0], g[1], Math.max(s.weight, 1) / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'triangle':
      case 'quad':
        ctx.beginPath();
        ctx.moveTo(g[0], g[1]);
        for (let i = 2; i < g.length; i += 2) ctx.lineTo(g[i], g[i + 1]);
        ctx.closePath();
        finish(true);
        break;
      case 'text': {
        ctx.font = `${s.size ?? 12}px sans-serif`;
        ctx.textAlign = s.align?.[0] ?? 'left';
        ctx.textBaseline = s.align?.[1] ?? 'alphabetic';
        const lines = (s.text ?? '').split('\n');
        const lead = (s.size ?? 12) * 1.25;
        lines.forEach((l, i) => {
          const y = g[1] + i * lead;
          if (fill) {
            ctx.fillStyle = fill;
            ctx.fillText(l, g[0], y);
          }
          if (stroke && s.outline) {
            ctx.strokeStyle = stroke;
            ctx.strokeText(l, g[0], y);
          }
        });
        break;
      }
    }
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}
