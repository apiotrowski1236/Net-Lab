import type { Rgba } from './color';

export type ShapeKind = 'background' | 'clear' | 'circle' | 'ellipse' | 'rect' | 'square' | 'line' | 'point' | 'triangle' | 'quad' | 'text';

/**
 * One thing a sketch drew, with the style it was drawn in. Plain JSON, so a
 * still of the canvas can be saved with the student's work.
 */
export interface Shape {
  kind: ShapeKind;
  /**
   * Where, before any translate, rotate, or scale. A circle, ellipse, rect, or
   * square is its box after rectMode and ellipseMode: [x, y, w, h]. A line,
   * triangle, or quad is its corners: [x1, y1, x2, y2, ...]. A point or text is [x, y].
   */
  g: number[];
  /** The transform, if translate, rotate, or scale was in effect: [a, b, c, d, e, f], as a canvas takes it. */
  m?: number[];
  /** The box it covers on the canvas, after any transform. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** null after noFill(). For background(), the color it paints. */
  fill: Rgba | null;
  /** null after noStroke(). */
  stroke: Rgba | null;
  weight: number;
  /** A rect's rounded corners. */
  r?: number;
  text?: string;
  size?: number;
  /** textAlign's two values, as canvas words: ['left' | 'center' | 'right', 'top' | 'middle' | 'bottom' | 'alphabetic']. */
  align?: [CanvasTextAlign, CanvasTextBaseline];
  /** Text is outlined only after stroke() is called, as in p5.js. */
  outline?: boolean;
  file: string;
  line: number;
}

/** One run of setup() or draw(), and what happened during it. */
export interface SketchFrame {
  /** 0 is setup(). draw()'s first run is 1, as frameCount counts. */
  n: number;
  /** Everything drawn in this frame, in order, including by mousePressed() and the other event functions. */
  shapes: Shape[];
  /** The top-level variables a check asked to watch, as they were at the end of this frame. */
  vars?: Record<string, unknown>;
  mouse: [number, number];
  pressed: boolean;
  /** Keys held, by KeyboardEvent.key. */
  keys: string[];
  /** draw() ran in this frame. It doesn't after noLoop(). */
  drew: boolean;
}

/** What a check asks a hidden run of the sketch to do. Frames count from 1, the first draw(). */
export interface SketchInput {
  /** How many frames to run. Default 60, one second at p5.js's usual speed. */
  frames?: number;
  /** The mouse moves to x, y just before frame n: [n, x, y]. Before any move it sits at 0, 0, where p5.js starts it. */
  mouse?: [number, number, number][];
  /** The button goes down just before frame a and comes up just before frame b: [a, b]. With b equal to a, it is a click inside one frame. */
  press?: [number, number][];
  /** A key goes down just before frame a and comes up just before frame b: [key, a, b], with the key as KeyboardEvent.key names it: "ArrowLeft", "a", " ". */
  keys?: [string, number, number][];
  /** Top-level variables to read at the end of every frame. */
  watch?: string[];
}

/** Something the person did between two frames of the live sketch. */
export type InputEvent = { t: 'move'; x: number; y: number } | { t: 'down' } | { t: 'up' } | { t: 'keydown'; key: string } | { t: 'keyup'; key: string };

/** What the canvas shows after a Run, saved with the work so a reload or a teacher's review draws it with no code running. */
export interface SketchState {
  w: number;
  h: number;
  /** createCanvas() ran. */
  made: boolean;
  /** p5.js found setup() or draw(), so the sketch started. */
  started: boolean;
  /** How many times draw() ran. */
  drawn: number;
  /** draw() was still running at the end, with no noLoop(). */
  looping: boolean;
  /** What to paint for a still of the canvas: everything since the last background that covered it. */
  still: Shape[];
  /** The still had too many shapes to save, so it shows the most recent ones. */
  cut?: boolean;
  /** The code reads the mouse or the keys, so the live canvas says how to use them. */
  mouse?: boolean;
  keys?: boolean;
  /** frameRate(n), if the sketch set one. */
  fps?: number;
}
