import type { Shape, ShapeKind, SketchFrame } from './types';

/** Shapes a person would call round, or boxes. */
export const ROUND: readonly ShapeKind[] = ['circle', 'ellipse'];
export const BOXES: readonly ShapeKind[] = ['rect', 'square'];
/** Everything that draws something, leaving out background() and clear(). */
export const DRAWN: readonly ShapeKind[] = ['circle', 'ellipse', 'rect', 'square', 'line', 'point', 'triangle', 'quad', 'text'];

/** The middle of a shape's box on the canvas. */
export const center = (s: Pick<Shape, 'x' | 'y' | 'w' | 'h'>): [number, number] => [s.x + s.w / 2, s.y + s.h / 2];

/** What a check reads about a run of the sketch. Frame 0 is setup(), and frame n is the nth frame after it. */
export class SketchView {
  constructor(
    readonly canvas: { w: number; h: number; made: boolean },
    readonly frames: readonly SketchFrame[],
    /** p5.js found setup() or draw(). */
    readonly started: boolean,
    /** The run drew too much to record all of it. */
    readonly cut: boolean,
  ) {}

  frame(n: number): SketchFrame | undefined {
    return this.frames.find((f) => f.n === n);
  }

  /** setup()'s frame. */
  get setup(): SketchFrame | undefined {
    return this.frame(0);
  }

  get last(): SketchFrame | undefined {
    return this.frames[this.frames.length - 1];
  }

  /** Frames where draw() ran. */
  get drawn(): SketchFrame[] {
    return this.frames.filter((f) => f.drew);
  }

  /** Shapes of these kinds, in one frame or in all of them. */
  shapes(kinds: ShapeKind | readonly ShapeKind[] = DRAWN, frame?: number): Shape[] {
    const want = typeof kinds === 'string' ? [kinds] : kinds;
    const from = frame === undefined ? this.frames : this.frames.filter((f) => f.n === frame);
    return from.flatMap((f) => f.shapes.filter((s) => want.includes(s.kind)));
  }

  /** What the canvas shows at the end of frame n: the last background or clear that covered it, and everything drawn after. */
  visible(n: number): Shape[] {
    const out: Shape[] = [];
    for (const f of this.frames) {
      if (f.n > n) break;
      for (const s of f.shapes) {
        if (s.kind === 'clear' || (s.kind === 'background' && s.fill![3] >= 255)) out.length = 0;
        out.push(s);
      }
    }
    return out;
  }

  /** The shape a line of code drew in a frame, if it drew one. */
  at(line: number, frame: number): Shape | undefined {
    return this.frame(frame)?.shapes.find((s) => s.line === line);
  }

  /** A shape is on the canvas if any of its box is. */
  onCanvas(s: Shape): boolean {
    return s.x <= this.canvas.w && s.y <= this.canvas.h && s.x + s.w >= 0 && s.y + s.h >= 0;
  }
}
