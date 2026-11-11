import type { Rgba } from './color';
import type { Shape, ShapeKind } from './types';
import { DRAWN, type SketchView } from './view';

/** Tools for lab checks on a sketch: color words, shape names, and what the canvas ends up showing. */

export type Hue = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'brown' | 'white' | 'black' | 'gray';

/** The color word most people would use for a color, so "tomato" and (255, 0, 0) are both red. */
export function hueOf(c: Rgba): Hue {
  const [r, g, b] = [c[0] / 255, c[1] / 255, c[2] / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.93) return 'white';
  if (l < 0.1) return 'black';
  if (s < 0.15 || d < 0.08) return 'gray';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  if (h < 15 || h >= 345) return l < 0.2 ? 'brown' : 'red';
  if (h < 45) return l < 0.4 ? 'brown' : 'orange';
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 260) return 'blue';
  if (h <= 300) return 'purple';
  return 'pink';
}

const NAMES: Record<ShapeKind, string> = {
  background: 'background',
  clear: 'clear',
  circle: 'circle',
  ellipse: 'ellipse',
  rect: 'rectangle',
  square: 'square',
  line: 'line',
  point: 'point',
  triangle: 'triangle',
  quad: 'four-sided shape',
  text: 'text',
};

/** "the circle from line 6", for a note. */
export const named = (s: Shape) => `the ${NAMES[s.kind]} from line ${s.line}`;

/** A point for a note: (200, 150). */
export const at = (x: number, y: number) => `(${Math.round(x)}, ${Math.round(y)})`;

/** The shapes the canvas shows when the run ends, leaving out background() and anything off the edge. */
export function showing(v: SketchView, kinds: readonly ShapeKind[] = DRAWN): Shape[] {
  const end = v.last?.n ?? 0;
  return v.visible(end).filter((s) => kinds.includes(s.kind) && v.onCanvas(s));
}

/** The background that covers the canvas at the end of frame n, if one does. */
export function backgroundAt(v: SketchView, n: number): Rgba | undefined {
  return v.visible(n).find((s) => s.kind === 'background')?.fill ?? undefined;
}
