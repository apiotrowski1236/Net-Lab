import type { JsError, LintNote, Pos, Program, Runtime, Value } from '../js';
import { closestName } from '../js/help';
import { toPlain } from '../js/run';
import { HostObject, JsArray, JsNamespace, JsNative, isCallable } from '../js/values';
import { closestColor, parseColor, clampChannel, type Rgba } from './color';
import { staticNotes } from './notes';
import type { InputEvent, Shape, ShapeKind, SketchFrame, SketchInput, SketchState } from './types';
import { SketchView } from './view';

/**
 * A p5.js sketch in global mode, inside the editor's own interpreter. The
 * program's top level runs first, as the page's script would. Then p5.js
 * "starts": its names become globals, setup() runs once, and draw() runs once a
 * frame. A hidden run plays a script of mouse and key input frame by frame,
 * and the live canvas in the editor feeds real input the same way.
 *
 * The functions and their defaults follow p5.js 1.x, and everything here works
 * the same in 2.x, so a student's sketch also runs in the p5.js web editor.
 * Anything else p5.js has stops with a plain "not in this editor" message.
 */

/** The functions p5.js calls by name, if the sketch has them. */
export const CALLBACKS = ['setup', 'draw', 'mousePressed', 'mouseReleased', 'mouseClicked', 'mouseMoved', 'mouseDragged', 'keyPressed', 'keyReleased'] as const;

const KEY_CODES: Record<string, number> = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, ' ': 32, Escape: 27, Backspace: 8, Tab: 9, Shift: 16, Control: 17, Alt: 18, Delete: 46, Meta: 91 };

/** p5.js's keyCode for a KeyboardEvent.key: 37 for "ArrowLeft", 65 for "a" or "A". */
export const keyCodeOf = (key: string): number => KEY_CODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);

const CONSTANTS: Record<string, Value> = {
  PI: Math.PI,
  TWO_PI: Math.PI * 2,
  TAU: Math.PI * 2,
  HALF_PI: Math.PI / 2,
  QUARTER_PI: Math.PI / 4,
  DEGREES: 'degrees',
  RADIANS: 'radians',
  LEFT: 'left',
  RIGHT: 'right',
  CENTER: 'center',
  TOP: 'top',
  BOTTOM: 'bottom',
  BASELINE: 'alphabetic',
  CORNER: 'corner',
  CORNERS: 'corners',
  RADIUS: 'radius',
  LEFT_ARROW: 37,
  RIGHT_ARROW: 39,
  UP_ARROW: 38,
  DOWN_ARROW: 40,
  ENTER: 13,
  RETURN: 13,
  ESCAPE: 27,
  BACKSPACE: 8,
  DELETE: 46,
  TAB: 9,
  SHIFT: 16,
  CONTROL: 17,
  ALT: 18,
  WEBGL: 'webgl',
  P2D: 'p2d',
};

/** Globals p5.js keeps up to date. */
export const P5_VARIABLES = ['width', 'height', 'mouseX', 'mouseY', 'pmouseX', 'pmouseY', 'mouseIsPressed', 'mouseButton', 'keyIsPressed', 'key', 'keyCode', 'frameCount', 'deltaTime', 'windowWidth', 'windowHeight'] as const;

/** Parts of p5.js this editor leaves out. Each one stops with a message that says so. */
const LEFT_OUT = 'arc beginShape endShape vertex curveVertex bezierVertex quadraticVertex bezier curve image loadImage imageMode tint noTint loadFont textFont textStyle textWidth textLeading textWrap createSlider createButton createInput createP createDiv createSpan createImg createSelect createCheckbox createRadio createColorPicker select selectAll loadSound loadJSON loadStrings loadTable saveCanvas colorMode lerpColor red green blue alpha hue saturation brightness lightness noise noiseSeed noiseDetail randomSeed randomGaussian createVector strokeCap strokeJoin blendMode erase noErase pixelDensity loadPixels updatePixels createGraphics cursor noCursor smooth noSmooth applyMatrix resetMatrix shearX shearY box sphere plane cylinder cone torus orbitControl normalMaterial ambientLight pointLight camera perspective createCamera'.split(' ');

/** Every function this editor's p5.js has. */
export const P5_FUNCTIONS = 'createCanvas resizeCanvas background clear fill noFill stroke noStroke strokeWeight circle ellipse rect square line point triangle quad text textSize textAlign rectMode ellipseMode push pop translate rotate scale angleMode color frameRate noLoop loop redraw isLooping keyIsDown millis random dist constrain map lerp abs ceil floor round sqrt sq pow min max sin cos tan atan2 radians degrees print'.split(' ');

/** Every name p5.js adds, in this editor and out of it. */
export const P5_NAMES = new Set<string>([...P5_FUNCTIONS, ...P5_VARIABLES, ...Object.keys(CONSTANTS), ...LEFT_OUT]);

/** Shapes one hidden run records across all its frames. Past this the frames still run, with nothing recorded. */
const MAX_RECORDED = 150_000;
/** Shapes the saved still keeps. */
const MAX_STILL = 3000;
/** The largest canvas side. A bigger canvas is cut down to this, with a note. */
const MAX_SIDE = 1600;

/** draw() runs this many times when a check asks for no number. */
export const DEFAULT_FRAMES = 60;

const IDENTITY = [1, 0, 0, 1, 0, 0];

interface Style {
  fill: Rgba | null;
  stroke: Rgba | null;
  weight: number;
  textSize: number;
  alignH: CanvasTextAlign;
  alignV: CanvasTextBaseline;
  rectMode: string;
  ellipseMode: string;
  /** stroke() was called, so text gets an outline too. */
  strokeSet: boolean;
  /** The fill() or stroke() call that set the current color, as `file:line`, so a call no shape ever used can be noted. */
  fillFrom?: string;
  strokeFrom?: string;
  m: number[];
}

const defaults = (): Style => ({ fill: [255, 255, 255, 255], stroke: [0, 0, 0, 255], weight: 1, textSize: 12, alignH: 'left', alignV: 'alphabetic', rectMode: 'corner', ellipseMode: 'center', strokeSet: false, m: IDENTITY });

/** What the shape functions call their numbers, for notes. */
const WORDS: Record<string, { need: number; most: number; names: string[]; say: string }> = {
  circle: { need: 3, most: 3, names: ['x', 'y', 'the diameter'], say: 'x, y, and the diameter (how wide the circle is)' },
  ellipse: { need: 3, most: 4, names: ['x', 'y', 'the width', 'the height'], say: 'x, y, the width, and the height' },
  rect: { need: 3, most: 8, names: ['x', 'y', 'the width', 'the height', 'the corner radius'], say: 'x, y, the width, and the height' },
  square: { need: 3, most: 7, names: ['x', 'y', 'the side length', 'the corner radius'], say: 'x, y, and the side length' },
  line: { need: 4, most: 4, names: ['x1', 'y1', 'x2', 'y2'], say: 'x and y for one end, then x and y for the other end' },
  point: { need: 2, most: 2, names: ['x', 'y'], say: 'x and y' },
  triangle: { need: 6, most: 6, names: ['x1', 'y1', 'x2', 'y2', 'x3', 'y3'], say: 'x and y for each of its 3 corners' },
  quad: { need: 8, most: 8, names: ['x1', 'y1', 'x2', 'y2', 'x3', 'y3', 'x4', 'y4'], say: 'x and y for each of its 4 corners' },
  text: { need: 3, most: 5, names: ['the text', 'x', 'y'], say: 'the text, then x and y' },
  createCanvas: { need: 2, most: 3, names: ['the width', 'the height'], say: 'the width and the height' },
  resizeCanvas: { need: 2, most: 3, names: ['the width', 'the height'], say: 'the width and the height' },
};

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/** A value as a note names it. */
function shown(v: Value): string {
  if (typeof v === 'string') return `the string "${v}"`;
  if (v === undefined) return 'undefined (no value)';
  if (v === null) return 'null';
  if (typeof v === 'boolean') return `the boolean ${v}`;
  if (isCallable(v)) return 'a function';
  if (v instanceof JsArray) return 'an array';
  return 'an object';
}

/** A color from p5.js, as `color(255, 0, 0)` makes one. */
export class ColorHost extends HostObject {
  readonly allow = { call: ['toString'] };
  constructor(readonly rgba: Rgba) {
    super();
  }
  label(): string {
    return 'p5.Color';
  }
  asString(): string {
    const [r, g, b, a] = this.rgba;
    return `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`;
  }
  call(): Value {
    return this.asString();
  }
}

const multiply = (m: number[], n: number[]): number[] => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** The box that points cover after a transform. */
function boxOf(m: number[], pts: number[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = m[0] * pts[i] + m[2] * pts[i + 1] + m[4];
    const y = m[1] * pts[i] + m[3] * pts[i + 1] + m[5];
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

const corners = (g: number[]) => [g[0], g[1], g[0] + g[2], g[1], g[0] + g[2], g[1] + g[3], g[0], g[1] + g[3]];

/** A box from x, y, w, h under a mode: corner, center, radius, or corners. Negative sizes flip, as on a canvas. */
function placed(mode: string, x: number, y: number, w: number, h: number): number[] {
  let box: number[];
  if (mode === 'center') box = [x - w / 2, y - h / 2, w, h];
  else if (mode === 'radius') box = [x - w, y - h, w * 2, h * 2];
  else if (mode === 'corners') box = [Math.min(x, w), Math.min(y, h), Math.abs(w - x), Math.abs(h - y)];
  else box = [x, y, w, h];
  if (box[2] < 0) box = [box[0] + box[2], box[1], -box[2], box[3]];
  if (box[3] < 0) box = [box[0], box[1] + box[3], box[2], -box[3]];
  return box;
}

const KIND_WORD: Record<ShapeKind, string> = { background: 'background', clear: 'clear', circle: 'circle', ellipse: 'ellipse', rect: 'rectangle', square: 'square', line: 'line', point: 'point', triangle: 'triangle', quad: 'shape', text: 'text' };

const round1 = (n: number) => String(Math.round(n * 10) / 10);

const placeKey = (p: Pick<Pos, 'file' | 'line'>) => `${p.file}:${p.line}`;

/** What one of the lines that draws has drawn: whether any of it ever showed. */
interface Drawer {
  first: Shape;
  seen: boolean;
}

export class Sketch {
  w = 100;
  h = 100;
  made = false;
  started = false;
  /** p5.js's names are globals now. Before this, the top of the code is running. */
  bound = false;
  frameCount = 0;
  looping = true;
  fps?: number;
  /** One run of draw() is due even with noLoop(): the first one, and one after redraw(). */
  private due = true;
  private style: Style = defaults();
  private stack: Style[] = [];
  private angle: 'radians' | 'degrees' = 'radians';
  private mouseX = 0;
  private mouseY = 0;
  private pmouseX = 0;
  private pmouseY = 0;
  private pressed = false;
  /** Keys down, by keyCode (or by name for a key with no code), with the key's name. */
  private readonly down = new Map<number | string, string>();
  private key = '';
  private keyCode = 0;
  private phase: 'top' | 'setup' | 'draw' | 'event' = 'top';
  /** Frames run so far, counting ones where noLoop() kept draw() from running. */
  private ticks = 0;
  readonly frames: SketchFrame[] = [];
  private frame?: SketchFrame;
  /** Shapes since the last covering background, for the still. */
  private still: Shape[] = [];
  private stillCut = false;
  /** Shapes drawn since the view last asked, for the live canvas. */
  private pending: Shape[] = [];
  /** The canvas changed size or started over since the view last asked. */
  private resized = true;
  private recorded = 0;
  cut = false;
  private readonly log = new Map<string, LintNote>();
  private readonly styleCalls = new Map<string, { kind: 'fill' | 'stroke'; file: string; line: number; used: boolean }>();
  private readonly drawers = new Map<string, Drawer>();
  /** Shapes in this frame since the last covering background, for the note on a background that hides them. */
  private sinceCover: Shape[] = [];

  constructor(
    private readonly programs: Program[],
    /** Record every frame, for a check. The live canvas doesn't, so it can run all class. */
    private readonly keep = true,
  ) {}

  // --- running ---

  /** p5.js starts: its names become globals, and setup() runs. The program's own `after`. */
  begin(rt: Runtime): void {
    this.bind(rt);
    this.started = isCallable(rt.lookup('setup')) || isCallable(rt.lookup('draw'));
    if (!this.started) return;
    this.open(0);
    const setup = rt.lookup('setup');
    if (isCallable(setup)) {
      this.phase = 'setup';
      this.sync(rt);
      rt.call(setup, undefined, []);
    }
    this.phase = 'event';
    rt.holdAsks("prompt() and confirm() can't run once the sketch is drawing, because draw() runs about 60 times a second. Ask at the top of your code, above setup(), and save the answer in a variable.");
  }

  /** One frame: the input since the last one, with its event functions, then draw(). */
  step(rt: Runtime, events: readonly InputEvent[], watch?: readonly string[]): void {
    if (!this.started) return;
    const frame = this.open(++this.ticks);
    for (const e of events) this.apply(rt, e);
    frame.mouse = [this.mouseX, this.mouseY];
    frame.pressed = this.pressed;
    frame.keys = [...this.down.values()];
    const draw = rt.lookup('draw');
    if (isCallable(draw) && (this.looping || this.due)) {
      this.due = false;
      this.frameCount++;
      this.style.m = IDENTITY;
      this.sinceCover = [];
      this.phase = 'draw';
      this.sync(rt);
      rt.call(draw, undefined, []);
      this.phase = 'event';
      frame.drew = true;
    }
    this.pmouseX = this.mouseX;
    this.pmouseY = this.mouseY;
    if (watch?.length) frame.vars = Object.fromEntries(watch.map((name) => [name, toPlain(rt.lookup(name))]));
  }

  /** A hidden run: setup(), then the frames in `input`. */
  play(rt: Runtime, input: SketchInput = {}): void {
    this.begin(rt);
    if (!this.started) return;
    const frames = Math.max(0, Math.min(Math.floor(input.frames ?? DEFAULT_FRAMES), 2000));
    const due: InputEvent[][] = Array.from({ length: frames + 1 }, () => []);
    const at = (n: number, e: InputEvent) => {
      if (n >= 1 && n <= frames) due[Math.floor(n)].push(e);
    };
    for (const [n, x, y] of input.mouse ?? []) at(n, { t: 'move', x, y });
    for (const [key, a] of input.keys ?? []) at(a, { t: 'keydown', key });
    for (const [a] of input.press ?? []) at(a, { t: 'down' });
    for (const [, b] of input.press ?? []) at(b, { t: 'up' });
    for (const [key, , b] of input.keys ?? []) at(b, { t: 'keyup', key });
    for (let n = 1; n <= frames; n++) this.step(rt, due[n], input.watch);
  }

  private open(n: number): SketchFrame {
    const frame: SketchFrame = { n, shapes: [], mouse: [this.mouseX, this.mouseY], pressed: this.pressed, keys: [...this.down.values()], drew: false };
    this.frame = frame;
    if (this.keep) this.frames.push(frame);
    return frame;
  }

  private apply(rt: Runtime, e: InputEvent): void {
    switch (e.t) {
      case 'move':
        if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
        this.mouseX = e.x;
        this.mouseY = e.y;
        this.fire(rt, this.pressed ? 'mouseDragged' : 'mouseMoved');
        return;
      case 'down':
        if (this.pressed) return;
        this.pressed = true;
        this.fire(rt, 'mousePressed');
        return;
      case 'up':
        if (!this.pressed) return;
        this.pressed = false;
        this.fire(rt, 'mouseReleased');
        this.fire(rt, 'mouseClicked');
        return;
      case 'keydown': {
        // p5.js ignores the repeats a held key sends, so keyPressed() runs once a press.
        const id = keyCodeOf(e.key) || e.key;
        if (this.down.has(id)) return;
        this.down.set(id, e.key);
        this.key = e.key;
        this.keyCode = keyCodeOf(e.key);
        this.fire(rt, 'keyPressed');
        return;
      }
      case 'keyup': {
        const id = keyCodeOf(e.key) || e.key;
        if (!this.down.has(id)) return;
        this.down.delete(id);
        this.key = e.key;
        this.keyCode = keyCodeOf(e.key);
        this.fire(rt, 'keyReleased');
        return;
      }
    }
  }

  private fire(rt: Runtime, name: (typeof CALLBACKS)[number]): void {
    const f = rt.lookup(name);
    if (!isCallable(f)) return;
    this.sync(rt);
    rt.call(f, undefined, []);
  }

  /** Puts p5.js's variables where the student's code reads them. */
  private sync(rt: Runtime): void {
    rt.global('width', this.w);
    rt.global('height', this.h);
    rt.global('mouseX', this.mouseX);
    rt.global('mouseY', this.mouseY);
    rt.global('pmouseX', this.pmouseX);
    rt.global('pmouseY', this.pmouseY);
    rt.global('mouseIsPressed', this.pressed);
    rt.global('mouseButton', this.pressed ? 'left' : 0);
    rt.global('keyIsPressed', this.down.size > 0);
    rt.global('key', this.key);
    rt.global('keyCode', this.keyCode);
    rt.global('frameCount', this.frameCount);
    rt.global('deltaTime', 1000 / (this.fps ?? 60));
  }

  // --- what a run leaves ---

  /** Shapes drawn since the last call, and whether the canvas changed size, for the live canvas. */
  drain(): { shapes: Shape[]; resized: boolean } {
    const out = { shapes: this.pending, resized: this.resized };
    this.pending = [];
    this.resized = false;
    return out;
  }

  state(): SketchState {
    const reads = (name: string) => this.programs.some((p) => new RegExp(`\\b${name}\\b`).test(p.source));
    return {
      w: this.w,
      h: this.h,
      made: this.made,
      started: this.started,
      drawn: this.frameCount,
      looping: this.started && this.looping && this.frameCount > 0,
      still: this.still.length > MAX_STILL ? this.still.slice(-MAX_STILL) : [...this.still],
      ...(this.stillCut || this.still.length > MAX_STILL ? { cut: true } : {}),
      ...(['mouseX', 'mouseY', 'mouseIsPressed', 'mousePressed', 'mouseClicked', 'mouseReleased', 'mouseDragged', 'mouseMoved'].some(reads) ? { mouse: true } : {}),
      ...(['keyIsDown', 'keyIsPressed', 'keyPressed', 'keyReleased', 'keyCode'].some(reads) || /\bkey\b/.test(this.programs.map((p) => p.source).join('\n')) ? { keys: true } : {}),
      ...(this.fps ? { fps: this.fps } : {}),
    };
  }

  view(): SketchView {
    return new SketchView({ w: this.w, h: this.h, made: this.made }, this.frames, this.started, this.cut);
  }

  /** What p5.js would let pass without a word, or with only a console warning. */
  notes(): LintNote[] {
    const out = staticNotes(this.programs);
    for (const c of this.styleCalls.values()) {
      if (c.used) continue;
      this.note('unused-style', c, `${c.kind}() on this line colors nothing, because no shape is drawn after it. ${c.kind}() sets the color for the shapes that come after it, so move this line above the shape it's for.`);
    }
    for (const d of this.drawers.values()) {
      if (d.seen) continue;
      const s = d.first;
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      this.note('off-canvas', s, `The ${KIND_WORD[s.kind]} on this line is drawn outside the ${this.w} by ${this.h} canvas, around x = ${round1(cx)} and y = ${round1(cy)}, so it never shows. x counts from the left edge, and y counts down from the top.`);
    }
    if (this.started && !this.made && this.drawers.size) {
      const first = [...this.drawers.values()][0].first;
      this.note('no-canvas', first, 'This sketch never calls createCanvas(), so p5.js uses a small canvas, 100 by 100. Put createCanvas(400, 400); at the start of setup().');
    }
    return [...out, ...this.log.values()];
  }

  /** Plainer help for an error the sketch knows more about. */
  explain(e: JsError): string | undefined {
    const name = /^(\w+) is not (?:defined|a function)$/.exec(e.msg)?.[1];
    if (!name) return undefined;
    if (e.code === 'not-defined') {
      if (!this.bound && P5_NAMES.has(name)) {
        return `${name} belongs to p5.js, and p5.js starts only after the top of your code has run. Use ${name} inside setup() or draw(). You can still declare a variable up top, with let x; and give it its value in setup().`;
      }
      if (name === 'mousePressed' || name === 'mouseClicked') return `${name} is the name of a function p5.js runs when the mouse is clicked, and your code doesn't have one. To check whether the mouse button is down right now, use mouseIsPressed.`;
      if (name === 'keyPressed') return 'keyPressed is the name of a function p5.js runs when a key is pressed, and your code doesn\'t have one. To check whether a key is down right now, use keyIsPressed, or keyIsDown() for one key.';
      const arrow = /^(?:arrow_?)?(up|down|left|right)(?:_?arrow|_?key)?$/i.exec(name)?.[1]?.toUpperCase();
      if (arrow && this.bound) return `p5.js has nothing called ${name}. For the ${arrow.toLowerCase()} arrow key, use ${arrow}_ARROW, as in keyIsDown(${arrow}_ARROW).`;
      const near = closestName(name, P5_NAMES);
      if (near && this.bound) {
        const caps = near.toLowerCase() === name.toLowerCase();
        return `p5.js has nothing called ${name}. Did you mean ${near}?${caps ? ' JavaScript treats capital and lowercase letters as different.' : ''}`;
      }
      return undefined;
    }
    if (e.code === 'not-a-function' && (P5_VARIABLES as readonly string[]).includes(name)) {
      return `${name} is a variable that p5.js keeps up to date, not a function, so it takes no ( ). Write ${name} with nothing after it.`;
    }
    return undefined;
  }

  // --- notes ---

  private note(rule: string, at: Pick<Pos, 'file' | 'line'>, text: string): void {
    const key = `${rule}:${placeKey(at)}`;
    if (!this.log.has(key)) this.log.set(key, { rule, file: at.file, line: at.line, text });
  }

  /** The numbers a shape function was given, or undefined if they can't draw anything. */
  private nums(rt: Runtime, fn: string, args: Value[], from = 0): number[] | undefined {
    const w = WORDS[fn];
    const at = rt.at();
    if (args.length < w.need) {
      const n = w.need - from;
      this.note('shape-args', at, `${fn}() needs ${fn === 'text' ? '3 values' : `${n} numbers`}: ${w.say}. This line gives it ${args.length}, so nothing was drawn.`);
      return undefined;
    }
    if (args.length > w.most && fn !== 'createCanvas') {
      this.note('shape-args', at, `${fn}() takes ${w.need === w.most ? w.need : `${w.need} to ${w.most}`} numbers: ${w.say}. This line gives it ${args.length}, and p5.js ignores the extra.${fn === 'circle' ? ' For an oval, use ellipse(x, y, width, height).' : ''}`);
    }
    const out: number[] = [];
    for (let i = from; i < Math.min(args.length, w.most); i++) {
      const a = args[i];
      const which = `its ${ORDINAL[i]} value${w.names[i] ? `, ${w.names[i]},` : ''}`;
      if (typeof a === 'number') {
        if (Number.isNaN(a)) {
          this.note('shape-args', at, `${fn}() got NaN (not a number) as ${which} so nothing was drawn. A variable in it may not have a value yet, or may hold text.`);
          return undefined;
        }
        out.push(a);
        continue;
      }
      if (typeof a === 'string' && a.trim() !== '' && Number.isFinite(Number(a))) {
        this.note('shape-args', at, `${fn}() needs numbers, and ${which} is the string "${a}". Take the quotes off. A number in quotes is text.`);
        out.push(Number(a));
        continue;
      }
      this.note('shape-args', at, `${fn}() needs numbers, and ${which} is ${shown(a)}, so nothing was drawn.`);
      return undefined;
    }
    return out;
  }

  /** A color from fill(), stroke(), background(), or color(): gray, gray and alpha, red green blue, or a CSS string. */
  private color(rt: Runtime, fn: string, args: Value[]): Rgba | undefined {
    const at = rt.at();
    const bad = (what: string) => {
      this.note('color-args', at, `${fn}() needs a color: one number from 0 to 255 for a gray, three numbers for red, green, and blue, or a color name in quotes, like "tomato". This line gives it ${what}.`);
      return undefined;
    };
    if (!args.length) return bad('nothing');
    let [a, ...rest] = args;
    if (a instanceof ColorHost) return a.rgba;
    if (a instanceof JsArray) [a, ...rest] = a.items;
    if (typeof a === 'string' && !Number.isFinite(Number(a))) {
      const c = parseColor(a);
      if (!c) {
        const near = closestColor(a);
        this.note('color-unknown', at, `p5.js doesn't know the color "${a}", so it uses white.${near ? ` Did you mean "${near}"?` : ' Use a color name like "tomato", a code like "#ff6347", or three numbers for red, green, and blue.'}`);
        return [255, 255, 255, 255];
      }
      if (rest.length && typeof rest[0] === 'number' && Number.isFinite(rest[0])) return [c[0], c[1], c[2], clampChannel(rest[0])];
      return c;
    }
    const all = [a, ...rest].slice(0, 4);
    const n: number[] = [];
    for (const v of all) {
      const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (Number.isNaN(x)) return bad(typeof v === 'number' ? 'NaN (not a number). A variable in it may not have a value yet' : shown(v));
      n.push(clampChannel(x));
    }
    if (n.length === 1) return [n[0], n[0], n[0], 255];
    if (n.length === 2) return [n[0], n[0], n[0], n[1]];
    if (n.length === 3) return [n[0], n[1], n[2], 255];
    return [n[0], n[1], n[2], n[3]];
  }

  // --- drawing ---

  private add(rt: Runtime, kind: ShapeKind, g: number[], extra: Partial<Shape> = {}, pts?: number[]): void {
    const at = rt.at();
    const s = this.style;
    const covering = kind === 'background' || kind === 'clear';
    const m = covering ? IDENTITY : s.m;
    const [x, y, w, h] = covering ? [0, 0, this.w, this.h] : boxOf(m, pts ?? g);
    const shape: Shape = { kind, g, ...(m === IDENTITY ? {} : { m }), x, y, w, h, fill: covering ? null : s.fill, stroke: covering ? null : s.stroke, weight: s.weight, ...extra, file: at.file, line: at.line };
    this.paint(shape);
    if (covering) return;
    const fills = kind !== 'line' && kind !== 'point' && !!s.fill;
    const strokes = !!s.stroke && s.weight > 0 && (kind !== 'text' || s.strokeSet);
    if (fills && s.fillFrom) this.styleCalls.get(s.fillFrom)!.used = true;
    if (strokes && s.strokeFrom) this.styleCalls.get(s.strokeFrom)!.used = true;
    const key = placeKey(at);
    let d = this.drawers.get(key);
    if (!d) this.drawers.set(key, (d = { first: shape, seen: false }));
    if (!d.seen && (fills || strokes || kind === 'point') && x <= this.w && y <= this.h && x + w >= 0 && y + h >= 0) d.seen = true;
    this.sinceCover.push(shape);
  }

  /** Puts a shape on the canvas: in this frame's record, the still, and the live canvas's queue. */
  private paint(shape: Shape): void {
    if (this.keep && this.frame) {
      if (this.recorded < MAX_RECORDED) {
        this.frame.shapes.push(shape);
        this.recorded++;
      } else this.cut = true;
    }
    if (!this.keep) this.pending.push(shape);
    const covers = shape.kind === 'clear' || (shape.kind === 'background' && shape.fill![3] >= 255);
    if (covers) {
      this.still = [shape];
      this.stillCut = false;
    } else {
      this.still.push(shape);
      if (this.still.length > MAX_STILL * 2) {
        this.still = this.still.slice(-MAX_STILL);
        this.stillCut = true;
      }
    }
  }

  private setColor(rt: Runtime, kind: 'fill' | 'stroke', args: Value[]): void {
    const c = this.color(rt, kind, args);
    if (!c) return;
    const at = rt.at();
    const key = placeKey(at);
    if (!this.styleCalls.has(key)) this.styleCalls.set(key, { kind, file: at.file, line: at.line, used: false });
    if (kind === 'fill') {
      this.style.fill = c;
      this.style.fillFrom = key;
    } else {
      this.style.stroke = c;
      this.style.strokeFrom = key;
      this.style.strokeSet = true;
    }
  }

  private canvas(rt: Runtime, fn: 'createCanvas' | 'resizeCanvas', args: Value[]): void {
    if (args[2] === 'webgl') rt.notAvailable('3D drawing with WEBGL is not available in this editor. Write createCanvas(400, 400) with only the width and the height.');
    const n = this.nums(rt, fn, args.slice(0, 2));
    if (!n) return;
    const at = rt.at();
    if (fn === 'createCanvas' && this.phase === 'draw') this.note('canvas-in-draw', at, 'createCanvas() runs every time draw() does, and each call starts a new blank canvas. Call it once, at the start of setup().');
    let [w, h] = n.map((v) => Math.floor(v));
    if (w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) {
      this.note('canvas-size', at, `A canvas in this editor can be 1 to ${MAX_SIDE} wide and tall, so this one is ${Math.min(Math.max(w, 1), MAX_SIDE)} by ${Math.min(Math.max(h, 1), MAX_SIDE)}.`);
      w = Math.min(Math.max(w, 1), MAX_SIDE);
      h = Math.min(Math.max(h, 1), MAX_SIDE);
    }
    this.w = w;
    this.h = h;
    this.resized = true;
    if (fn === 'createCanvas') {
      this.made = true;
      this.style = defaults();
      this.stack = [];
    }
    this.add(rt, 'clear', []);
    rt.global('width', w);
    rt.global('height', h);
  }

  private shape(rt: Runtime, fn: 'circle' | 'ellipse' | 'rect' | 'square', args: Value[]): void {
    const n = this.nums(rt, fn, args);
    if (!n) return;
    const s = this.style;
    if (fn === 'circle' || fn === 'ellipse') {
      const [x, y, w] = n;
      const h = fn === 'ellipse' && n.length > 3 ? n[3] : w;
      const g = placed(s.ellipseMode, x, y, w, h);
      this.add(rt, fn, g, {}, corners(g));
      return;
    }
    const [x, y, w] = n;
    const h = fn === 'rect' && n.length > 3 ? n[3] : w;
    const r = fn === 'rect' ? n[4] : n[3];
    const g = placed(s.rectMode, x, y, w, h);
    this.add(rt, fn, g, r ? { r } : {}, corners(g));
  }

  private poly(rt: Runtime, fn: 'line' | 'point' | 'triangle' | 'quad', args: Value[]): void {
    const n = this.nums(rt, fn, args);
    if (!n) return;
    if (fn === 'point') {
      const half = Math.max(this.style.weight, 1) / 2;
      this.add(rt, fn, n, {}, [n[0] - half, n[1] - half, n[0] + half, n[1] + half]);
      return;
    }
    this.add(rt, fn, n);
  }

  private text(rt: Runtime, args: Value[]): void {
    const at = rt.at();
    if (args[0] === undefined) {
      this.note('shape-args', at, `text() needs the text to show first, then x and y. ${args.length ? 'Its first value here is undefined, a variable with no value yet' : 'This line gives it nothing'}, so nothing was drawn.`);
      return;
    }
    const n = this.nums(rt, 'text', args, 1);
    if (!n) return;
    const str = rt.str(args[0]);
    const s = this.style;
    const [x, y] = n;
    const width = 0.6 * s.textSize * Math.max(...str.split('\n').map((l) => l.length), 1);
    const tall = s.textSize * str.split('\n').length;
    const left = s.alignH === 'center' ? x - width / 2 : s.alignH === 'right' ? x - width : x;
    const top = s.alignV === 'top' ? y : s.alignV === 'middle' ? y - tall / 2 : s.alignV === 'bottom' ? y - tall : y - s.textSize * 0.8;
    this.add(rt, 'text', [x, y], { text: str, size: s.textSize, align: [s.alignH, s.alignV], ...(s.strokeSet ? { outline: true } : {}) }, [left, top, left + width, top + tall]);
  }

  private background(rt: Runtime, args: Value[]): void {
    const c = this.color(rt, 'background', args);
    if (!c) return;
    const at = rt.at();
    if (c[3] >= 255) {
      const hidden = this.sinceCover.find((s) => s.kind !== 'background' && s.kind !== 'clear');
      if (hidden && this.phase !== 'event') this.note('background-covers', at, `background() on this line paints over the whole canvas, so it covers the ${KIND_WORD[hidden.kind]} drawn on line ${hidden.line}. Anything drawn before background() doesn't show. Call background() first.`);
      this.sinceCover = [];
    }
    this.add(rt, 'background', [], { fill: c });
  }

  private turn(rt: Runtime, v: Value): number {
    const n = rt.num(v);
    return this.angle === 'degrees' ? (n * Math.PI) / 180 : n;
  }

  // --- p5.js's names ---

  private bind(rt: Runtime): void {
    this.bound = true;
    const def = (name: string, run: (args: Value[]) => Value) => rt.global(name, new JsNative(name, (_self, args) => run(args)));
    const num = (v: Value) => rt.num(v);
    for (const [name, v] of Object.entries(CONSTANTS)) rt.global(name, v);
    rt.global('windowWidth', 400);
    rt.global('windowHeight', 400);
    this.sync(rt);
    for (const name of LEFT_OUT) def(name, () => rt.notAvailable(`${name}() is part of p5.js, but it is not available in this editor. The labs use shapes, colors, text, the mouse, and the keys.`));

    def('createCanvas', (a) => (this.canvas(rt, 'createCanvas', a), undefined));
    def('resizeCanvas', (a) => (this.canvas(rt, 'resizeCanvas', a), undefined));
    def('background', (a) => (this.background(rt, a), undefined));
    def('clear', () => (this.add(rt, 'clear', []), undefined));
    def('fill', (a) => (this.setColor(rt, 'fill', a), undefined));
    def('stroke', (a) => (this.setColor(rt, 'stroke', a), undefined));
    def('noFill', () => ((this.style.fill = null), (this.style.fillFrom = undefined), undefined));
    def('noStroke', () => ((this.style.stroke = null), (this.style.strokeFrom = undefined), undefined));
    def('strokeWeight', (a) => {
      const w = num(a[0]);
      if (Number.isFinite(w) && w >= 0) this.style.weight = w;
      else this.note('shape-args', rt.at(), `strokeWeight() needs one number, 0 or more: how thick lines and outlines are. This line gives it ${shown(a[0])}.`);
      return undefined;
    });
    for (const fn of ['circle', 'ellipse', 'rect', 'square'] as const) def(fn, (a) => (this.shape(rt, fn, a), undefined));
    for (const fn of ['line', 'point', 'triangle', 'quad'] as const) def(fn, (a) => (this.poly(rt, fn, a), undefined));
    def('text', (a) => (this.text(rt, a), undefined));
    def('textSize', (a) => {
      if (!a.length) return this.style.textSize;
      const n = num(a[0]);
      if (Number.isFinite(n) && n > 0) this.style.textSize = n;
      return undefined;
    });
    def('textAlign', (a) => {
      const h = a[0];
      if (h === 'left' || h === 'center' || h === 'right') this.style.alignH = h;
      const v = a[1];
      if (v === 'top' || v === 'bottom' || v === 'alphabetic') this.style.alignV = v;
      else if (v === 'center') this.style.alignV = 'middle';
      return undefined;
    });
    def('rectMode', (a) => ((this.style.rectMode = typeof a[0] === 'string' ? a[0] : 'corner'), undefined));
    def('ellipseMode', (a) => ((this.style.ellipseMode = typeof a[0] === 'string' ? a[0] : 'center'), undefined));
    def('push', () => (this.stack.push({ ...this.style }), undefined));
    def('pop', () => {
      const s = this.stack.pop();
      if (s) this.style = s;
      return undefined;
    });
    def('translate', (a) => ((this.style.m = multiply(this.style.m, [1, 0, 0, 1, num(a[0]), num(a[1] ?? 0)])), undefined));
    def('rotate', (a) => {
      const t = this.turn(rt, a[0]);
      this.style.m = multiply(this.style.m, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]);
      return undefined;
    });
    def('scale', (a) => {
      const sx = num(a[0]);
      const sy = a.length > 1 ? num(a[1]) : sx;
      this.style.m = multiply(this.style.m, [sx, 0, 0, sy, 0, 0]);
      return undefined;
    });
    def('angleMode', (a) => {
      if (a[0] === 'degrees' || a[0] === 'radians') this.angle = a[0];
      return undefined;
    });
    def('color', (a) => new ColorHost(this.color(rt, 'color', a) ?? [255, 255, 255, 255]));
    def('frameRate', (a) => {
      if (!a.length) return this.fps ?? 60;
      const n = num(a[0]);
      if (Number.isFinite(n) && n > 0) this.fps = Math.min(n, 60);
      return undefined;
    });
    def('noLoop', () => ((this.looping = false), undefined));
    def('loop', () => ((this.looping = true), undefined));
    def('redraw', () => ((this.due = true), undefined));
    def('isLooping', () => this.looping);
    def('millis', () => Math.round((this.frameCount * 1000) / (this.fps ?? 60)));
    def('keyIsDown', (a) => {
      const k = a[0];
      if (typeof k === 'number') return this.down.has(k);
      if (typeof k === 'string') {
        if (k.length === 1 || Object.hasOwn(KEY_CODES, k)) return this.down.has(keyCodeOf(k));
        const meant = ({ left: 'LEFT_ARROW', right: 'RIGHT_ARROW', up: 'UP_ARROW', down: 'DOWN_ARROW', enter: 'ENTER', space: '" "' } as Record<string, string>)[k.toLowerCase()] ?? (k.toUpperCase() === k && Object.hasOwn(CONSTANTS, k) ? k : undefined);
        this.note('key-code', rt.at(), `keyIsDown() takes a key code like LEFT_ARROW, with no quotes, or one letter in quotes, like "a". "${k}" is neither, so it is never down.${meant && meant !== k ? ` Try keyIsDown(${meant}).` : meant ? ` Take the quotes off: keyIsDown(${meant}).` : ''}`);
        return false;
      }
      this.note('key-code', rt.at(), 'keyIsDown() takes a key code like LEFT_ARROW, with no quotes, or one letter in quotes, like "a".');
      return false;
    });

    // Math. p5.js's trig follows angleMode().
    const math = rt.lookup('Math');
    const rand = math instanceof JsNamespace ? math.props.get('random') : undefined;
    const r = () => (rand ? num(rt.call(rand, undefined, [])) : 0.5);
    def('random', (a) => {
      if (!a.length) return r();
      if (a[0] instanceof JsArray) return a[0].items.length ? a[0].items[Math.floor(r() * a[0].items.length)] : undefined;
      let lo = 0;
      let hi = num(a[0]);
      if (a.length > 1) [lo, hi] = [num(a[0]), num(a[1])];
      if (lo > hi) [lo, hi] = [hi, lo];
      return lo + r() * (hi - lo);
    });
    def('dist', (a) => Math.hypot(num(a[2]) - num(a[0]), num(a[3]) - num(a[1])));
    def('constrain', (a) => Math.max(Math.min(num(a[0]), num(a[2])), num(a[1])));
    def('map', (a) => {
      const [v, a1, a2, b1, b2] = a.slice(0, 5).map(num);
      const out = b1 + ((v - a1) * (b2 - b1)) / (a2 - a1);
      return a[5] ? (b1 < b2 ? Math.max(Math.min(out, b2), b1) : Math.max(Math.min(out, b1), b2)) : out;
    });
    def('lerp', (a) => num(a[0]) + (num(a[1]) - num(a[0])) * num(a[2]));
    for (const [name, f] of [['abs', Math.abs], ['ceil', Math.ceil], ['floor', Math.floor], ['sqrt', Math.sqrt]] as const) def(name, (a) => f(num(a[0])));
    def('round', (a) => {
      const d = a.length > 1 ? Math.pow(10, num(a[1])) : 1;
      return Math.round(num(a[0]) * d) / d;
    });
    def('sq', (a) => num(a[0]) * num(a[0]));
    def('pow', (a) => Math.pow(num(a[0]), num(a[1])));
    const list = (a: Value[]) => (a[0] instanceof JsArray ? a[0].items : a).map(num);
    def('min', (a) => Math.min(...list(a)));
    def('max', (a) => Math.max(...list(a)));
    def('sin', (a) => Math.sin(this.turn(rt, a[0])));
    def('cos', (a) => Math.cos(this.turn(rt, a[0])));
    def('tan', (a) => Math.tan(this.turn(rt, a[0])));
    def('atan2', (a) => {
      const t = Math.atan2(num(a[0]), num(a[1]));
      return this.angle === 'degrees' ? (t * 180) / Math.PI : t;
    });
    def('radians', (a) => (num(a[0]) * Math.PI) / 180);
    def('degrees', (a) => (num(a[0]) * 180) / Math.PI);
    const con = rt.lookup('console');
    const log = con instanceof JsNamespace ? con.props.get('log') : undefined;
    def('print', (a) => (log ? rt.call(log, undefined, a) : undefined));
  }
}
