import type { JsCheckCtx } from '../../demos/types';
import { at, center, differ, ROUND, type Shape, type SketchInput, type SketchView } from '../../sketch';
import { BROKE, check, hasNote, playedError, sketch, UNKNOWN_COLOR } from '../sketch';

/**
 * Starting code and checks for p5-move. A check plays the sketch in a hidden
 * run, frame by frame, with a mouse it moves itself, and judges where the
 * shapes went. It reads the code only to name a mistake.
 */


const NO_DRAW = 'Keep `function draw() { }` in your code. p5.js runs it again and again, and that is what makes things move.';

/** A hidden run, or why the sketch can't be judged. */
function play(c: JsCheckCtx, input: SketchInput): SketchView | string {
  if (!c.ok) return BROKE;
  if (!c.fn('draw')) return NO_DRAW;
  if (hasNote(c, 'color-unknown')) return UNKNOWN_COLOR;
  const r = c.run({ sketch: input });
  if (r.status === 'limit') return 'Your sketch ran too long in one frame. Read the message under the output, fix it, and press Run.';
  if (!r.ok || !r.sketch) return playedError(r);
  return r.sketch;
}

/** Where one line's circle was in each frame that drew it. */
interface Step {
  n: number;
  x: number;
  y: number;
  s: Shape;
}

/** Each line that drew a circle in draw(), and where its circle went, frame by frame. */
function paths(v: SketchView): Step[][] {
  const by = new Map<string, Step[]>();
  for (const f of v.drawn) {
    for (const s of f.shapes) {
      if (!ROUND.includes(s.kind)) continue;
      const key = `${s.file}:${s.line}`;
      const [x, y] = center(s);
      if (!by.get(key)?.some((p) => p.n === f.n)) by.set(key, [...(by.get(key) ?? []), { n: f.n, x, y, s }]);
    }
  }
  return [...by.values()];
}

const moves = (p: Step[], axis: 'x' | 'y') => p.some((q) => Math.abs(q[axis] - p[0][axis]) > 0.5);

// --- step 1: follow the mouse ------------------------------------------------

export const FOLLOW_START = sketch(`function setup() {
  createCanvas(400, 400);
  background("black");
}

function draw() {
  // Draw a circle at the mouse here.

}
`);

/** The mouse in the hidden run: it moves to three places. */
const MOUSE: [number, number, number][] = [
  [1, 100, 300],
  [10, 250, 80],
  [20, 320, 200],
];
const mouseAt = (n: number) => MOUSE.filter((m) => m[0] <= n).pop()!;

export const FOLLOWS = check(
  'follows',
  'Draw a circle at the mouse',
  (c) => {
    const v = play(c, { frames: 30, mouse: MOUSE });
    if (typeof v === 'string') return v;
    const ps = paths(v);
    const hits = (p: Step[]) => p.filter((q) => [5, 15, 25].includes(q.n)).every((q) => Math.abs(q.x - mouseAt(q.n)[1]) < 0.5 && Math.abs(q.y - mouseAt(q.n)[2]) < 0.5) && p.filter((q) => [5, 15, 25].includes(q.n)).length === 3;
    if (ps.some(hits)) return undefined;
    if (!ps.length) {
      if (v.setup?.shapes.some((s) => ROUND.includes(s.kind))) return 'Your circle is drawn in setup(), which runs once, before the mouse moves. Put it inside draw().';
      return 'Add a circle inside draw(), at `mouseX` and `mouseY`.';
    }
    const p = ps[0];
    const q = p.find((s) => s.n === 15) ?? p[p.length - 1];
    const [, mx, my] = mouseAt(q.n);
    if (Math.abs(q.x - my) < 0.5 && Math.abs(q.y - mx) < 0.5 && mx !== my) return 'Your circle has x and y swapped. Put `mouseX` first and `mouseY` second.';
    if (!moves(p, 'x') && !moves(p, 'y')) return `Your circle stays at ${at(q.x, q.y)} when the mouse moves. Use \`mouseX\` and \`mouseY\` for its x and y.`;
    if (!moves(p, 'y')) return 'Your circle follows the mouse left and right, but not up and down. Use `mouseY` for its y.';
    if (!moves(p, 'x')) return 'Your circle follows the mouse up and down, but not left and right. Use `mouseX` for its x.';
    return `With the mouse at ${at(mx, my)}, your circle's middle is at ${at(q.x, q.y)}. Use \`mouseX\` and \`mouseY\` themselves for x and y.`;
  },
  ['`mouseX` and `mouseY` go where the circle\'s x and y numbers go.', 'Inside draw(), write `circle(mouseX, mouseY, 40);`'],
);

export const CLEAN = check(
  'clean',
  'Paint the background in every frame',
  (c) => {
    const v = play(c, { frames: 30, mouse: MOUSE });
    if (typeof v === 'string') return v;
    const f = v.frame(15);
    const shapes = f?.shapes ?? [];
    const bg = shapes.findIndex((s) => s.kind === 'background' && s.fill![3] >= 255);
    const circle = shapes.findIndex((s) => ROUND.includes(s.kind));
    if (bg >= 0 && (circle < 0 || bg < circle)) return undefined;
    if (bg > circle) return '`background()` comes after the circle in draw(), so it paints over the circle every frame. Move it above the circle.';
    return 'The circle leaves a trail. Move `background("black");` from setup() into draw(), above the circle.';
  },
  ['Cut the `background("black");` line out of setup(), and paste it as the first line inside draw().'],
  true,
);

// --- step 2: slide -----------------------------------------------------------

export const SLIDE_START = sketch(`let x = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("black");
  circle(x, 200, 50);
}
`);

/** A path that moves one way along an axis by the same amount each frame. */
function steady(p: Step[], axis: 'x' | 'y'): number | undefined {
  if (p.length < 5) return undefined;
  const d = p[1][axis] - p[0][axis];
  if (Math.abs(d) < 0.1) return undefined;
  for (let i = 2; i < Math.min(p.length, 20); i++) if (Math.abs(p[i][axis] - p[i - 1][axis] - d) > 0.01) return undefined;
  return d;
}

const RESET = (name: string) => `\`${name}\` is made inside draw(), so it starts over every frame. Keep \`let ${name} = 0;\` at the top of your code, above setup().`;

export const SLIDES = check(
  'slides',
  'Make the circle slide to the right',
  (c) => {
    if (c.declarations().some((d) => d.name === 'x' && d.scope !== 'top')) return RESET('x');
    const v = play(c, { frames: 30 });
    if (typeof v === 'string') return v;
    const ps = paths(v);
    if (ps.some((p) => (steady(p, 'x') ?? 0) > 0)) return undefined;
    if (ps.some((p) => (steady(p, 'x') ?? 0) < 0)) return 'Your circle slides to the left. Add to `x` to move it right: `x = x + 3;`';
    if (!ps.length) return 'Keep the circle inside draw(), at x: `circle(x, 200, 50);`';
    if (ps.some((p) => moves(p, 'x'))) return 'Your circle moves, but not by the same amount each frame. Add the same number to `x` every frame: `x = x + 3;`';
    return 'The circle stays in place. In draw(), below the circle, add `x = x + 3;` so x grows each frame.';
  },
  ['`x = x + 3;` takes the value of x, adds 3, and puts the answer back in x.', 'Put `x = x + 3;` inside draw(), on the line below the circle.'],
);

export const DOWN = check(
  'down',
  'Make a second circle slide down',
  (c) => {
    if (c.declarations().some((d) => d.name === 'y' && d.scope !== 'top')) return RESET('y');
    const v = play(c, { frames: 30 });
    if (typeof v === 'string') return v;
    const ps = paths(v);
    if (ps.some((p) => (steady(p, 'y') ?? 0) > 0)) return undefined;
    if (ps.some((p) => (steady(p, 'y') ?? 0) < 0)) return 'Your second circle slides up. Add to `y` to move it down.';
    if (ps.length < 2) return 'Now make a second circle that slides down. At the top, add `let y = 0;`. In draw(), draw `circle(200, y, 50);` and add to y.';
    return 'Your second circle stays in place. Below it in draw(), add to y: `y = y + 2;`';
  },
  ['At the top of your code, under `let x = 0;`, add `let y = 0;`.', 'In draw(), add `circle(200, y, 50);` and, below it, `y = y + 2;`.'],
  true,
);

// --- step 3: wrap around -----------------------------------------------------

export const WRAP_START = sketch(`let x = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("black");
  circle(x, 200, 50);
  x = x + 3;
}
`);

/** The circle that moves along x the most: the one the step is about. */
function mover(v: SketchView): Step[] | undefined {
  let best: Step[] | undefined;
  let most = 0;
  for (const p of paths(v)) {
    const xs = p.map((q) => q.x);
    const range = Math.max(...xs) - Math.min(...xs);
    if (range > most) [best, most] = [p, range];
  }
  return best;
}

/** How fast the circle moves: its biggest change in one frame, short of a jump. */
const pace = (p: Step[]) => Math.max(1, ...p.slice(1).map((q, i) => Math.abs(q.x - p[i].x)).filter((d) => d < 40));

export const WRAPS = check(
  'wraps',
  'Send the circle back to the left edge',
  (c) => {
    const v = play(c, { frames: 900 });
    if (typeof v === 'string') return v;
    const p = mover(v);
    const w = v.canvas.w;
    if (!p) return 'Keep the circle that slides, with `x = x + 3;` in draw().';
    const jump = p.findIndex((q, i) => i > 0 && p[i - 1].x - q.x > 40);
    if (jump < 0) {
      const last = p[p.length - 1];
      if (last.x > w + 30) return 'The circle goes off the right edge and never comes back. After the line that changes x, add an `if`: when x is greater than `width`, set x back to 0.';
      if (Math.abs(last.x - p[p.length - 2].x) < 0.5) return `The circle stops at x = ${Math.round(last.x)}. Set x back to 0, so it starts over at the left.`;
      return 'The circle never goes back to the left edge. When x is greater than `width`, set x to 0.';
    }
    const top = p[jump - 1].x;
    const back = p[jump].x;
    if (top < w - 30) return `Your circle goes back when x is about ${Math.round(top)}, before it reaches the right edge at ${w}. Compare x with \`width\`.`;
    if (back > 30) return `The circle goes back to x = ${Math.round(back)}, not to the left edge. Set x to 0.`;
    return undefined;
  },
  ['The if goes in draw(), after `x = x + 3;`.', '`width` is the canvas width, so `x > width` is true once the circle passes the right edge.', 'Write `if (x > width) {`, then `x = 0;` on the next line, then `}`.'],
);

// --- step 4: bounce ----------------------------------------------------------

export const BOUNCE_START = sketch(`let x = 200;
let speed = 3;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("black");
  circle(x, 200, 50);
  x = x + speed;
}
`);

/** The frames where the circle turns around, and which way it was going. */
function turns(p: Step[]): { at: number; x: number; was: 'right' | 'left' }[] {
  const out: { at: number; x: number; was: 'right' | 'left' }[] = [];
  let dir = 0;
  for (let i = 1; i < p.length; i++) {
    const d = Math.sign(p[i].x - p[i - 1].x);
    if (!d) continue;
    if (dir && d !== dir) out.push({ at: i - 1, x: p[i - 1].x, was: dir > 0 ? 'right' : 'left' });
    dir = d;
  }
  return out;
}

function bounce(c: JsCheckCtx): { p: Step[]; w: number; right?: number; left?: number; off?: 'right' | 'left' } | string {
  const v = play(c, { frames: 600 });
  if (typeof v === 'string') return v;
  const p = mover(v);
  if (!p) return 'Keep the circle that slides, with `x = x + speed;` in draw().';
  const t = turns(p);
  const w = v.canvas.w;
  const right = t.find((q) => q.was === 'right')?.x;
  const left = t.find((q) => q.was === 'left' && (right === undefined || t.indexOf(q) > 0))?.x;
  const last = p[p.length - 1].x;
  const off = last > w + 30 ? 'right' : last < -30 ? 'left' : undefined;
  return { p, w, right, left, off };
}

export const RIGHT = check(
  'right',
  'Turn around at the right wall',
  (c) => {
    const b = bounce(c);
    if (typeof b === 'string') return b;
    if (b.right === undefined) {
      if (b.off === 'right') return 'The circle goes off the right edge and keeps going. Add an `if`: when x is greater than `width`, set speed to -3.';
      return 'The circle never turns around at the right wall. When x is greater than `width`, set speed to -3.';
    }
    if (b.right < b.w - 30 - 2 * pace(b.p)) return `Your circle turns around at x = ${Math.round(b.right)}, before it reaches the right wall at ${b.w}. Compare x with \`width\`.`;
    return undefined;
  },
  ['After `x = x + speed;`, add `if (x > width) {`.', 'Inside the if, write `speed = -3;`. Then close it with `}`.'],
);

export const LEFT = check(
  'left',
  'Turn around at the left wall too',
  (c) => {
    const b = bounce(c);
    if (typeof b === 'string') return b;
    if (b.left === undefined) {
      if (b.off === 'left') return 'The circle bounces off the right wall, then goes off the left edge. Add a second `if`: when x is less than 0, set speed to 3.';
      return 'The circle never turns around at the left wall. When x is less than 0, set speed to 3.';
    }
    if (b.left > 30 + 2 * pace(b.p)) return `Your circle turns around at x = ${Math.round(b.left)}, before it reaches the left wall at 0.`;
    return undefined;
  },
  ['Add a second if below the first one: `if (x < 0) {`.', 'Inside it, write `speed = 3;` so the circle goes right again.'],
);

export const EDGE = check(
  'edge',
  'Turn as soon as the edge of the circle touches a wall',
  (c) => {
    const b = bounce(c);
    if (typeof b === 'string') return b;
    if (b.right === undefined || b.left === undefined) return 'The circle has to bounce off both walls first.';
    const r = b.p[0].s.w / 2;
    const slack = 2 * pace(b.p) + 1;
    if (b.right > b.w - r + slack) return `The circle's middle gets to x = ${Math.round(b.right)} before it turns, so half of it goes past the right wall. Its edge is ${r} from its middle, so turn when x is greater than \`width - ${r}\`.`;
    if (b.left < r - slack) return `The circle's middle gets to x = ${Math.round(b.left)} before it turns, so half of it goes past the left wall. Turn when x is less than ${r}.`;
    if (b.right < b.w - r - slack) return `Your circle turns at x = ${Math.round(b.right)}, a little before its edge touches the right wall. Use \`width - ${r}\`.`;
    if (b.left > r + slack) return `Your circle turns at x = ${Math.round(b.left)}, a little before its edge touches the left wall. Use ${r}.`;
    return undefined;
  },
  ['The circle is 50 wide, so its edge is 25 from its middle.', 'For the right wall, use `x > width - 25`. For the left wall, use `x < 25`.'],
);

// --- step 5: press -----------------------------------------------------------

export const PRESS_START = sketch(`let x = 200;
let speed = 3;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("black");
  circle(x, 200, 50);
  x = x + speed;

  if (x > width - 25) {
    speed = -3;
  }
  if (x < 25) {
    speed = 3;
  }
}
`);

/** The mouse goes down on frame 10 and up on frame 25. */
const PRESS: SketchInput = { frames: 40, mouse: [[1, 200, 200]], press: [[10, 25]] };

/**
 * The moving circle in a frame: the one from the line that drew it before, or
 * the only circle, since an if and an else can draw it from two lines.
 */
function circleIn(v: SketchView, n: number, line: number): Shape | undefined {
  const round = (v.frame(n)?.shapes ?? []).filter((s) => ROUND.includes(s.kind));
  return round.find((s) => s.line === line) ?? (round.length === 1 ? round[0] : undefined);
}

export const PRESS_COLOR = check(
  'press-color',
  'Change the color while the mouse button is down',
  (c) => {
    const v = play(c, PRESS);
    if (typeof v === 'string') return v;
    const p = mover(v) ?? paths(v)[0];
    if (!p) return 'Keep the circle in draw().';
    const line = p[0].s.line;
    const [up, down, again] = [5, 15, 32].map((n) => circleIn(v, n, line));
    if (!up || !down || !again) return 'Draw the circle in every frame, as before.';
    if (!differ(up.fill, down.fill)) {
      if (c.uses('mouseIsPressed').length) return 'The circle is the same color with the button up and down. Inside `if (mouseIsPressed)`, call `fill()` with a new color, above the circle.';
      return 'The circle is the same color with the button up and down. In draw(), above the circle, use `if (mouseIsPressed)` to pick a fill.';
    }
    if (differ(up.fill, again.fill)) return 'The circle keeps its new color after the button comes up, because a fill stays until the next `fill()`. Add an `else` that sets the first color back.';
    return undefined;
  },
  ['`mouseIsPressed` is true while the button is down, so `if (mouseIsPressed) {` runs its code only then.', 'Put the if above the circle. Inside it, call `fill("tomato");`. In the else, call `fill("white");`.'],
);

export const PRESS_MORE = check(
  'press-more',
  'Change one more thing while the mouse button is down',
  (c) => {
    const v = play(c, PRESS);
    if (typeof v === 'string') return v;
    const p = mover(v) ?? paths(v)[0];
    if (!p) return 'Keep the circle in draw().';
    const line = p[0].s.line;
    const look = (n: number) => {
      const ball = circleIn(v, n, line);
      return (v.frame(n)?.shapes ?? []).map((s) => {
        const style = [s.kind, s.stroke?.join(), s.weight, s.r, s.text, s.size];
        // The moving circle's place changes anyway, and its fill is the last check.
        if (s === ball) return JSON.stringify([...style, s.w, s.h]);
        return JSON.stringify([...style, s.fill?.join(), s.x, s.y, s.w, s.h]);
      });
    };
    const [a, b] = [look(5), look(15)];
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) return undefined;
    return 'Only the fill changes so far. Inside your if, change one more thing, like the background color, the outline, or the size of the circle.';
  },
  ['The if can hold more than one line. Add `background("navy");` inside it, below the fill.', 'To change the size, give the circle a variable size: `circle(x, 200, size);`, and set `size` in the if and in the else.'],
  true,
);

// --- optional: bounce in two directions ----------------------------------------

export const CORNERS_START = sketch(`let x = 200;
let y = 100;
let xSpeed = 3;
let ySpeed = 2;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("black");
  circle(x, y, 50);
  x = x + xSpeed;

  if (x > width - 25) {
    xSpeed = -3;
  }
  if (x < 25) {
    xSpeed = 3;
  }

  // Make y change too, and bounce off the top and the bottom.

}
`);

function corners(c: JsCheckCtx): { p: Step[]; v: SketchView } | string {
  const v = play(c, { frames: 900 });
  if (typeof v === 'string') return v;
  const p = paths(v).sort((a, b) => b.length - a.length)[0];
  if (!p) return 'Keep the circle in draw().';
  return { p, v };
}

export const Y_MOVES = check(
  'y-moves',
  'Move the ball up and down too',
  (c) => {
    const r = corners(c);
    if (typeof r === 'string') return r;
    return moves(r.p, 'y') ? undefined : 'The ball moves only left and right. In draw(), add `ySpeed` to `y` each frame.';
  },
  ['Below `x = x + xSpeed;`, add `y = y + ySpeed;`.'],
);

export const Y_BOUNCE = check(
  'y-bounce',
  'Bounce off the top and the bottom',
  (c) => {
    const r = corners(c);
    if (typeof r === 'string') return r;
    const ys = r.p.map((q) => q.y);
    const h = r.v.canvas.h;
    const rad = r.p[0].s.h / 2;
    const slack = 2 * Math.max(1, ...r.p.slice(1).map((q, i) => Math.abs(q.y - r.p[i].y)).filter((d) => d < 40)) + 1;
    if (Math.max(...ys) > h - rad + slack) return 'The ball goes past the bottom wall. When y is greater than `height - 25`, set ySpeed to -2.';
    if (Math.min(...ys) < rad - slack) return 'The ball goes past the top wall. When y is less than 25, set ySpeed to 2.';
    if (Math.max(...ys) < h - rad - slack) return 'The ball turns before it touches the bottom wall. Use `height - 25`.';
    if (Math.min(...ys) > rad + slack) return 'The ball turns before it touches the top wall. Use 25.';
    return undefined;
  },
  ['These ifs look like the ones for x, with y, ySpeed, and `height`.', '`if (y > height - 25) { ySpeed = -2; }` and `if (y < 25) { ySpeed = 2; }`'],
);

export const NEW_COLOR = check(
  'new-color',
  'Pick a new color each time the ball bounces',
  (c) => {
    const r = corners(c);
    if (typeof r === 'string') return r;
    let changes = 0;
    for (let i = 1; i < r.p.length; i++) if (differ(r.p[i].s.fill, r.p[i - 1].s.fill)) changes++;
    if (changes < 3) return 'The ball keeps one color. Inside each if, pick a new color with `fill(random(255), random(255), random(255));`.';
    if (changes > r.p.length / 4) return 'The ball changes color almost every frame. Pick the new color only inside the ifs, where it bounces.';
    return undefined;
  },
  ['`random(255)` gives a random number from 0 up to 255, so `fill(random(255), random(255), random(255))` mixes a random color.', 'A fill stays until the next `fill()`, so call it inside the ifs, and the ball keeps that color until the next bounce.'],
);

