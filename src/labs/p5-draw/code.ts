import type { JsCheckCtx } from '../../demos/types';
import { at, backgroundAt, differ, hueOf, named, ROUND, BOXES, showing, center, type Hue, type Rgba, type Shape, type SketchView } from '../../sketch';
import { BROKE, check, hasNote, playedError, sketch, UNKNOWN_COLOR } from '../sketch';

/**
 * Starting code and checks for p5-draw. Each check reads what the sketch drew,
 * from the student's own Run or a hidden one with other values, and reads the
 * code only to name a mistake.
 */


const NO_SETUP = 'Keep your drawing code inside `function setup() { }`. p5.js runs what is inside it when the sketch starts.';
const keepName = (name: string) => `Keep the variable named \`${name}\` at the top of your code. The face has to read it.`;

/** The student's own Run, or why it can't be judged. */
function own(c: JsCheckCtx): SketchView | string {
  if (!c.ok) return BROKE;
  if (!c.sketch?.started) return NO_SETUP;
  if (hasNote(c, 'color-unknown')) return UNKNOWN_COLOR;
  return c.sketch;
}

const isGray = (c: Rgba, v: number) => Math.abs(c[0] - v) < 4 && Math.abs(c[1] - v) < 4 && Math.abs(c[2] - v) < 4;
const area = (s: Shape) => s.w * s.h;
const biggest = (list: Shape[]) => list.reduce<Shape | undefined>((a, s) => (!a || area(s) > area(a) ? s : a), undefined);
const inside = (s: Shape, box: Shape, slack = 0) => {
  const [x, y] = center(s);
  return x >= box.x - slack && x <= box.x + box.w + slack && y >= box.y - slack && y <= box.y + box.h + slack;
};
const sticksOut = (s: Shape, box: Shape) => s.x < box.x - 2 || s.y < box.y - 2 || s.x + s.w > box.x + box.w + 2 || s.y + s.h > box.y + box.h + 2;
const span = (box: Shape) => `x from ${Math.round(box.x)} to ${Math.round(box.x + box.w)} and y from ${Math.round(box.y)} to ${Math.round(box.y + box.h)}`;

// --- step 1: the canvas ------------------------------------------------------

export const CANVAS_START = sketch(`function setup() {
  createCanvas(400, 400);
  background(220);
}
`);

export const BACKGROUND = check(
  'background',
  'Change the background color',
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    const bg = backgroundAt(v, 0);
    if (!bg) return 'Keep the line `background(220);` in setup, and change its color.';
    if (isGray(bg, 220)) return 'Change `220` in `background(220)` to a color name in quotes, like `"skyblue"`.';
    return undefined;
  },
  ['A color name goes in quotes: `background("skyblue");`', 'Any color name from CSS works, such as `"tomato"`, `"gold"`, or `"navy"`.'],
  true,
);

export const MIDDLE = check(
  'middle',
  'Draw a circle in the middle of the canvas',
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    const round = showing(v, ROUND);
    const mid = [v.canvas.w / 2, v.canvas.h / 2];
    if (!round.length) {
      if (v.shapes(ROUND).length) return 'Your circle is drawn before `background()`, and the background paints over it. Code runs from top to bottom, so put the circle on a line below `background()`.';
      return 'Add a circle inside setup, on a line below `background()`.';
    }
    if (round.some((s) => Math.hypot(center(s)[0] - mid[0], center(s)[1] - mid[1]) <= 8)) return undefined;
    const s = round[round.length - 1];
    return `Your circle's middle is at ${at(...center(s))}. The middle of this ${v.canvas.w} by ${v.canvas.h} canvas is ${at(mid[0], mid[1])}.`;
  },
  ['`circle()` takes three numbers: x, y, and the diameter, which is how wide the circle is.', 'The canvas is 400 wide, so its middle is at x = 200. It is 400 tall, so its middle is at y = 200.', 'Write `circle(200, 200, 100);` on the line below `background()`.'],
);

// --- step 2: a traffic light -------------------------------------------------

export const SHAPES_START = sketch(`function setup() {
  createCanvas(400, 400);
  background("skyblue");

  // The box of the traffic light
  rect(150, 50, 100, 300);

  // Three circles go here, one above the other, inside the box.

}
`);

/** The box: the biggest rectangle on the canvas. */
const boxOf = (v: SketchView) => biggest(showing(v, BOXES));

export const BOX = check(
  'box',
  'Keep the box',
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    if (!boxOf(v)) return v.shapes(BOXES).length ? 'Your box is drawn before `background()`, so the background covers it. Put the `rect()` line below `background()`.' : 'Keep the `rect()` line. It draws the box of the traffic light.';
    return undefined;
  },
  ['The starting code had `rect(150, 50, 100, 300);` below `background()`.'],
);

/**
 * Three circles inside the box, top to bottom, not overlapping. Returns them
 * from the top down, or what to fix.
 */
function lightsOf(v: SketchView): Shape[] | string {
  const all = v.visible(v.last?.n ?? 0);
  const box = boxOf(v)!;
  const after = all.slice(all.indexOf(box) + 1);
  const round = showing(v, ROUND);
  const covered = round.find((s) => !after.includes(s) && inside(s, box));
  if (covered) return `The box is drawn after ${named(covered)}, so it covers the circle. Code runs from top to bottom, so put the circles on lines below \`rect()\`.`;
  const lights = round.filter((s) => after.includes(s) && inside(s, box));
  const out = round.find((s) => !inside(s, box));
  if (lights.length < 3) {
    if (out) return `${cap(named(out))} has its middle at ${at(...center(out))}, outside the box. The box covers ${span(box)}.`;
    return lights.length ? `The box has ${lights.length} ${lights.length === 1 ? 'circle' : 'circles'} in it so far. A traffic light needs 3.` : 'Add three circles below the `rect()` line.';
  }
  if (lights.length > 3) return `The box has ${lights.length} circles in it. A traffic light has 3.`;
  const xs = lights.map((s) => center(s)[0]);
  if (Math.max(...xs) - Math.min(...xs) > 10) return 'Give all three circles the same x, so they line up from top to bottom.';
  const down = [...lights].sort((a, b) => center(a)[1] - center(b)[1]);
  for (let i = 1; i < 3; i++) {
    const [a, b] = [down[i - 1], down[i]];
    if (center(b)[1] - center(a)[1] < (a.h + b.h) / 2 - 3) return `${cap(named(a))} and ${named(b)} overlap. Move them farther apart, or make them smaller.`;
  }
  const poke = down.find((s) => sticksOut(s, box));
  if (poke) return `${cap(named(poke))} sticks out past the edge of the box. Make it smaller, or move it. The box covers ${span(box)}.`;
  return down;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const LIGHTS = check(
  'lights',
  'Put three circles in the box, one above the other',
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    if (!boxOf(v)) return BOX.test(c);
    const r = lightsOf(v);
    return typeof r === 'string' ? r : undefined;
  },
  ['The box covers x from 150 to 250. Its middle is at x = 200, so give every circle x = 200.', 'The box covers y from 50 to 350. Space the circles out inside that, such as y = 110, 200, and 290.', 'Try `circle(200, 110, 70);`. Then add two more, with y = 200 and y = 290.'],
);

// --- step 3: color -----------------------------------------------------------

export const COLOR_START = sketch(`function setup() {
  createCanvas(400, 400);
  background("skyblue");

  // The box of the traffic light
  rect(150, 50, 100, 300);

  // The lights
  circle(200, 110, 70);
  circle(200, 200, 70);
  circle(200, 290, 70);
}
`);

const WHITE: Rgba = [255, 255, 255, 255];

export const BOX_COLOR = check(
  'box-color',
  'Give the box a color',
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    const box = boxOf(v);
    if (!box) return BOX.test(c);
    if (box.fill && differ(box.fill, WHITE)) return undefined;
    if (!box.fill) return 'Your box has no fill, so the sky shows through it. Put `fill("dimgray");` on the line above `rect()`, and take out `noFill()`.';
    return 'The box is still white. `fill()` changes only the shapes drawn after it, so put a `fill()` on the line above `rect()`.';
  },
  ['Put `fill("dimgray");` on the line above `rect()`.'],
);

const WANT: Hue[] = ['red', 'yellow', 'green'];
const PLACE = ['top', 'middle', 'bottom'];

export const LIGHT_COLORS = check(
  'light-colors',
  'Make the lights red, yellow, and green, from the top down',
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    if (!boxOf(v)) return BOX.test(c);
    const lights = lightsOf(v);
    if (typeof lights === 'string') return `${lights} The traffic light needs its three circles, as in the last step.`;
    const hues = lights.map((s) => (s.fill ? hueOf(s.fill) : undefined));
    if (hues.every((h) => h === hues[0]) && lights.every((s) => s.fill && !differ(s.fill, lights[0].fill))) {
      return `All three circles are ${hues[0] ?? 'see-through'}. A fill stays until the next \`fill()\`, so put a new \`fill()\` on the line above each circle.`;
    }
    for (let i = 0; i < 3; i++) {
      const h = hues[i];
      const ok = h === WANT[i] || (i === 1 && h === 'orange');
      if (ok) continue;
      if (!h) return `The ${PLACE[i]} circle has no fill. Put \`fill("${WANT[i]}");\` on the line above it.`;
      return `The ${PLACE[i]} circle is ${h}. Make it ${WANT[i]}, with a \`fill()\` on the line above it.`;
    }
    return undefined;
  },
  ['Each circle needs its own `fill()` on the line above it.', 'The order is `fill()`, then the shape. A `fill()` after a shape changes only the shapes after it.', 'Above the top circle, write `fill("red");`. Do the same with `"yellow"` and `"green"` above the other two.'],
);

export const OUTLINE = check(
  'outline',
  'Change the outlines',
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    const changed = showing(v).some((s) => !s.stroke || s.weight !== 1 || differ(s.stroke, [0, 0, 0, 255]));
    return changed ? undefined : 'The outlines are still thin and black. Try `strokeWeight(4);` or `noStroke();` above your shapes.';
  },
  ['`strokeWeight(5);` makes the outlines of the shapes after it 5 pixels thick.', '`stroke("white");` gives the outlines a color, and `noStroke();` turns them off.'],
  true,
);

// --- step 4: your own picture ------------------------------------------------

export const PICTURE_START = sketch(`function setup() {
  createCanvas(400, 400);
  background("white");

  // Draw your picture here.

}
`);

const MANY_SHAPES = 6;

/** Kinds a student would count as different: a circle and an ellipse are both round. */
const KIND: Record<string, string> = { circle: 'round shape', ellipse: 'round shape', rect: 'rectangle', square: 'rectangle', line: 'line', point: 'point', triangle: 'triangle', quad: 'four-sided shape', text: 'text' };

export const MANY = check(
  'many',
  `Draw at least ${MANY_SHAPES} shapes`,
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    const n = showing(v).length;
    if (n >= MANY_SHAPES) return undefined;
    const hidden = v.shapes().length - n;
    const more = `Your picture shows ${n} ${n === 1 ? 'shape' : 'shapes'} so far. Add ${MANY_SHAPES - n} more.`;
    return hidden > 0 ? `${more} ${hidden === 1 ? 'One shape is' : `${hidden} shapes are`} off the canvas or covered by \`background()\`.` : more;
  },
  ['Plan your picture on paper first, with the x and y of each shape.', 'Each shape is one line of code, like `circle(100, 100, 50);` or `rect(20, 300, 360, 80);`.'],
  true,
);

export const KINDS = check(
  'kinds',
  'Use at least 2 kinds of shape',
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    const kinds = new Set(showing(v).map((s) => KIND[s.kind]));
    if (kinds.size >= 2) return undefined;
    const only = [...kinds][0];
    return `Every shape in your picture is a ${only}. Add a different kind, such as ${only === 'rectangle' ? 'a circle' : 'a rectangle'} or a triangle.`;
  },
  ['`triangle(200, 50, 150, 150, 250, 150);` draws a triangle. The six numbers are the x and y of its three corners.', '`ellipse(200, 300, 160, 60);` draws an oval 160 wide and 60 tall.'],
  true,
);

/** The colors a picture uses: fills, and the stroke of a line or point. */
function colorsOf(shapes: Shape[]): Rgba[] {
  const out: Rgba[] = [];
  for (const s of shapes) {
    const c = s.kind === 'line' || s.kind === 'point' ? s.stroke : s.fill;
    if (c && c[3] > 0 && !out.some((o) => !differ(o, c))) out.push(c);
  }
  return out;
}

export const COLORS = check(
  'colors',
  'Use at least 3 colors',
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    const n = colorsOf(showing(v)).length;
    if (n >= 3) return undefined;
    return `Your shapes use ${n} ${n === 1 ? 'color' : 'colors'} so far, not counting the background. Put a new \`fill()\` above some of your shapes.`;
  },
  ['`fill()` sets the color of the shapes drawn after it, until the next `fill()`.', 'Three numbers mix a color from red, green, and blue: `fill(255, 140, 0)` is orange.'],
  true,
);

// --- step 5: move it with variables ------------------------------------------

export const MOVE_START = sketch(`let x = 200;
let y = 200;

function setup() {
  createCanvas(400, 400);
  background("lavender");

  // The face
  fill("gold");
  circle(200, 200, 160);

  // The eyes
  fill("black");
  circle(170, 180, 20);
  circle(230, 180, 20);

  // The mouth
  line(170, 240, 230, 240);
}
`);

const HOME = { x: 200, y: 200 };
const AWAY = { x: 130, y: 260 };

/** The same code, drawn with the face at home and away. */
function twoRuns(c: JsCheckCtx): { home: Shape[]; away: Shape[] } | string {
  const v = own(c);
  if (typeof v === 'string') return v;
  const a = c.run({ data: HOME, sketch: { frames: 0 } });
  const b = c.run({ data: AWAY, sketch: { frames: 0 } });
  for (const name of ['x', 'y']) if (a.dataMissing.includes(name)) return keepName(name);
  if (!a.ok || !a.sketch) return playedError(a);
  if (!b.ok || !b.sketch) return playedError(b);
  return { home: a.sketch.shapes(), away: b.sketch.shapes() };
}

/** How a shape moved between the two runs: every point it's placed by, shifted by (dx, dy). */
function moved(a: Shape, b: Shape, dx: number, dy: number): 'all' | 'none' | 'x' | 'y' | 'part' | 'other' {
  const n = a.kind === 'circle' || a.kind === 'ellipse' || a.kind === 'rect' || a.kind === 'square' || a.kind === 'text' || a.kind === 'point' ? 1 : a.g.length / 2;
  let all = 0;
  let none = 0;
  let onlyX = 0;
  let onlyY = 0;
  for (let i = 0; i < n; i++) {
    const ex = b.g[2 * i] - a.g[2 * i];
    const ey = b.g[2 * i + 1] - a.g[2 * i + 1];
    const okX = Math.abs(ex - dx) < 0.5;
    const okY = Math.abs(ey - dy) < 0.5;
    const stillX = Math.abs(ex) < 0.5;
    const stillY = Math.abs(ey) < 0.5;
    if (okX && okY) all++;
    else if (stillX && stillY) none++;
    else if (okX && stillY) onlyX++;
    else if (stillX && okY) onlyY++;
  }
  const sameSize = a.kind === 'line' || a.kind === 'triangle' || a.kind === 'quad' || (a.g[2] === b.g[2] && a.g[3] === b.g[3]);
  if (all === n && sameSize) return 'all';
  if (none === n) return 'none';
  if (onlyX === n) return 'x';
  if (onlyY === n) return 'y';
  if (all + none === n) return 'part';
  return 'other';
}

const DX = AWAY.x - HOME.x;
const DY = AWAY.y - HOME.y;

export const FACE = check(
  'face',
  'Draw the face circle at x and y',
  (c) => {
    const r = twoRuns(c);
    if (typeof r === 'string') return r;
    const face = biggest(r.away.filter((s) => ROUND.includes(s.kind)));
    if (!face) return 'Keep the big gold circle. It is the face.';
    const [fx, fy] = center(face);
    if (Math.abs(fx - AWAY.x) < 0.5 && Math.abs(fy - AWAY.y) < 0.5) return undefined;
    const home = biggest(r.home.filter((s) => ROUND.includes(s.kind)))!;
    const [hx, hy] = center(home);
    if (Math.abs(fx - hx) < 0.5 && Math.abs(fy - hy) < 0.5) return 'The face circle stays in the same place when `x` and `y` change. Write it as `circle(x, y, 160)`.';
    return `When \`x\` is ${AWAY.x} and \`y\` is ${AWAY.y}, the face's middle should be at ${at(AWAY.x, AWAY.y)}, and it is at ${at(fx, fy)}. Use \`x\` and \`y\` themselves for the face circle.`;
  },
  ['The face circle is `circle(200, 200, 160)`. Swap the first 200 for `x` and the second for `y`.'],
);

export const ALL = check(
  'all',
  'Make the eyes and the mouth move with the face',
  (c) => {
    const r = twoRuns(c);
    if (typeof r === 'string') return r;
    if (r.home.length !== r.away.length) return 'Your sketch draws a different number of shapes when `x` changes. Draw the same shapes every time, placed with `x` and `y`.';
    for (let i = 0; i < r.home.length; i++) {
      const [a, b] = [r.home[i], r.away[i]];
      const m = moved(a, b, DX, DY);
      if (m === 'all') continue;
      const what = named(b);
      if (m === 'none') return `${cap(what)} stays in place when \`x\` and \`y\` change. Write its numbers with \`x\` and \`y\`, like \`x - 30\`.`;
      if (m === 'x') return `${cap(what)} moves left and right with \`x\`, but not up and down. Use \`y\` for its y numbers too.`;
      if (m === 'y') return `${cap(what)} moves up and down with \`y\`, but not left and right. Use \`x\` for its x numbers too.`;
      if (m === 'part') return `One end of ${what} moves and the other doesn't. Use \`x\` and \`y\` for both ends.`;
      return `${cap(what)} moves, but not the same way as the face, so the face comes apart. Add to or subtract from \`x\` and \`y\`, like \`x - 30\`, and keep the size numbers as they are.`;
    }
    return undefined;
  },
  ['The left eye is 30 to the left of the middle and 20 above it, so it is `circle(x - 30, y - 20, 20)`.', 'The right eye is 30 to the right of the middle, so its x is `x + 30`.', 'The mouth goes from 30 left of the middle to 30 right of it, 40 below: `line(x - 30, y + 40, x + 30, y + 40)`.'],
);

export const MOVED = check(
  'moved',
  'Change x to move the face',
  (c) => {
    const v = own(c);
    if (typeof v === 'string') return v;
    const x = c.vars.x;
    const y = c.vars.y;
    if (typeof x !== 'number' || typeof y !== 'number') return keepName(typeof x !== 'number' ? 'x' : 'y');
    if (x === HOME.x && y === HOME.y) return 'Now change the 200 in `let x = 200;` to another number, and press Run.';
    if (x < 0 || x > v.canvas.w || y < 0 || y > v.canvas.h) return `The middle of the face is off the canvas at ${at(x, y)}. Keep \`x\` and \`y\` between 0 and ${v.canvas.w}.`;
    return undefined;
  },
  ['Change `let x = 200;` to `let x = 100;` and press Run.'],
  true,
);

// --- optional: draw it three times -------------------------------------------

export const STAMP_START = sketch(`function setup() {
  createCanvas(400, 400);
  background("lavender");
  drawFace(100, 200);
}

function drawFace(x, y) {
  fill("gold");
  circle(x, y, 100);
  fill("black");
  circle(x - 20, y - 10, 12);
  circle(x + 20, y - 10, 12);
}
`);

/**
 * What the student's drawFace drew. The face circle is the biggest shape, and
 * the line that draws it draws one for each call.
 */
function faces(c: JsCheckCtx): { perCall: number; faceLine: Shape[] } | string {
  const v = own(c);
  if (typeof v === 'string') return v;
  const fn = c.fn('drawFace');
  if (!fn) return 'Keep the function named `drawFace`.';
  const src = c.source(fn.file);
  const lineOf = (off: number) => src.slice(0, off).split('\n').length;
  const [from, to] = [lineOf(fn.node.off), lineOf(fn.node.end)];
  const shapes = v.shapes().filter((s) => s.file === fn.file && s.line >= from && s.line <= to);
  if (!shapes.length) return 'Your `drawFace` drew nothing. Call it from setup, like `drawFace(100, 200);`.';
  const byLine = new Map<number, Shape[]>();
  for (const s of shapes) byLine.set(s.line, [...(byLine.get(s.line) ?? []), s]);
  const faceLine = [...byLine.values()].reduce((a, b) => (area(b[0]) > area(a[0]) ? b : a));
  return { perCall: shapes.length / faceLine.length, faceLine };
}

export const THREE = check(
  'three',
  'Draw three faces that do not overlap',
  (c) => {
    const f = faces(c);
    if (typeof f === 'string') return f;
    const v = c.sketch!;
    if (f.faceLine.length < 3) return `Your sketch draws ${f.faceLine.length} ${f.faceLine.length === 1 ? 'face' : 'faces'}. Call \`drawFace\` again in setup, with new numbers, until there are 3.`;
    const off = f.faceLine.find((s) => !v.onCanvas(s));
    if (off) return `One face is off the canvas, at ${at(...center(off))}. Keep x and y between 0 and ${v.canvas.w}.`;
    for (let i = 0; i < f.faceLine.length; i++) {
      for (let j = i + 1; j < f.faceLine.length; j++) {
        const [a, b] = [f.faceLine[i], f.faceLine[j]];
        const gap = Math.hypot(center(a)[0] - center(b)[0], center(a)[1] - center(b)[1]);
        if (gap < (a.w + b.w) / 2 - 3) return `The faces at ${at(...center(a))} and ${at(...center(b))} overlap. Move one of them farther away.`;
      }
    }
    return undefined;
  },
  ['Each call draws one face. `drawFace(300, 200);` draws one at (300, 200).', 'The faces are 100 wide, so keep their middles at least 100 apart.'],
);

export const MOUTH = check(
  'mouth',
  'Give every face a mouth, inside drawFace',
  (c) => {
    const f = faces(c);
    if (typeof f === 'string') return f;
    if (f.perCall >= 4) return undefined;
    return 'Each face has a face circle and two eyes so far. Add a mouth inside `drawFace`, placed with `x` and `y`, and every face gets one.';
  },
  ['The mouth is one more line inside `drawFace`, below the eyes.', 'Try `line(x - 20, y + 25, x + 20, y + 25);`.'],
);

export const OWN_COLORS = check(
  'own-colors',
  'Give each face its own color',
  (c) => {
    const f = faces(c);
    if (typeof f === 'string') return f;
    const n = colorsOf(f.faceLine).length;
    if (n >= f.faceLine.length) return undefined;
    return n === 1 ? 'All the faces are the same color. Give `drawFace` a third parameter for the color, and use it in `fill()`.' : 'Two of the faces are the same color. Give each call its own color.';
  },
  ['Add a third parameter: `function drawFace(x, y, skin)`. Then change `fill("gold")` to `fill(skin)`.', 'Each call now needs a color too: `drawFace(100, 200, "pink");`.'],
);
