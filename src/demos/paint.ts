import { BLACK, BLUE, compress, GREEN, RED, WHITE, YELLOW, type Picture, type RGB } from './pictures';
import type { DemoModel, PaintSpec } from './types';

/** The paint colors, in palette order. The canvas starts all white. */
export const PAINT_COLORS: RGB[] = [WHITE, BLACK, RED, BLUE, YELLOW, GREEN];
export const PAINT_SIZE = 8;

export interface PaintState {
  /** Each pixel's palette index, row by row. */
  px: number[];
  /** The palette index a tap paints with. */
  brush: number;
}

export const paintPicture = (s: PaintState): Picture => ({ w: PAINT_SIZE, h: PAINT_SIZE, px: s.px.map((i) => PAINT_COLORS[i]) });

export const paintModel: DemoModel<PaintSpec, PaintState> = {
  init: () => ({ px: Array.from({ length: PAINT_SIZE * PAINT_SIZE }, () => 0), brush: 1 }),
  apply(_spec, s, input) {
    if ('brush' in input) {
      const b = input.brush;
      return Number.isInteger(b) && b >= 0 && b < PAINT_COLORS.length && b !== s.brush ? { ...s, brush: b } : s;
    }
    if ('paint' in input) {
      const i = input.paint;
      if (!Number.isInteger(i) || i < 0 || i >= s.px.length || s.px[i] === s.brush) return s;
      return { ...s, px: s.px.map((v, j) => (j === i ? s.brush : v)) };
    }
    if ('clear' in input) return s.px.some((v) => v !== 0) ? { ...s, px: s.px.map(() => 0) } : s;
    return s;
  },
  facts(_spec, s) {
    const p = paintPicture(s);
    const runs = compress(p, 'runs');
    const avg = compress(p, 'avg2');
    return { runs: runs.runs ?? 0, runBytes: runs.bytes, raw: compress(p, 'none').bytes, changed: avg.changed, colors: new Set(s.px).size };
  },
};
