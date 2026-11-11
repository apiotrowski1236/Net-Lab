import type { JsCheckCtx } from '../../demos/types';
import { at, center, ROUND, type Shape, type SketchInput, type SketchView } from '../../sketch';
import { BROKE, check, hasNote, playedError, sketch, UNKNOWN_COLOR } from '../sketch';

/**
 * Starting code and checks for p5-game. A check plays the game in a hidden
 * run: it holds down arrow keys, or puts the player on the target with `data`,
 * and reads the player's place from the variables x and y.
 */


const NO_DRAW = 'Keep `function draw() { }` in your code. p5.js runs it again and again, and that is what runs the game.';
const keepName = (name: string) => `Keep the variable named \`${name}\` at the top of your code. The game reads it.`;

type Run = ReturnType<JsCheckCtx['run']>;

/** A hidden run of the game, or why it can't be judged. */
function play(c: JsCheckCtx, input: SketchInput, data?: Record<string, number>): (Run & { sketch: SketchView }) | string {
  if (!c.ok) return BROKE;
  if (!c.fn('draw')) return NO_DRAW;
  if (hasNote(c, 'color-unknown')) return UNKNOWN_COLOR;
  const r = c.run({ sketch: input, data });
  for (const name of Object.keys(data ?? {})) if (r.dataMissing.includes(name)) return keepName(name);
  if (r.status === 'limit') return 'Your game ran too long in one frame. Read the message under the output, fix it, and press Run.';
  if (!r.ok || !r.sketch) return playedError(r);
  return r as Run & { sketch: SketchView };
}

/** A variable's value at the end of frame n. */
const val = (v: SketchView, n: number, name: string): unknown => v.frame(n)?.vars?.[name];
const num = (v: SketchView, n: number, name: string): number | undefined => {
  const x = val(v, n, name);
  return typeof x === 'number' ? x : undefined;
};

// --- step 1: the arrow keys --------------------------------------------------

const MOVE_PLAYER = `function movePlayer() {
  if (keyIsDown(RIGHT_ARROW)) {
    x = x + 4;
  }
  if (keyIsDown(LEFT_ARROW)) {
    x = x - 4;
  }
  if (keyIsDown(UP_ARROW)) {
    y = y - 4;
  }
  if (keyIsDown(DOWN_ARROW)) {
    y = y + 4;
  }

  // Stay on the canvas.
  if (x > width - 20) {
    x = width - 20;
  }
  if (x < 20) {
    x = 20;
  }
  if (y > height - 20) {
    y = height - 20;
  }
  if (y < 20) {
    y = 20;
  }
}
`;

export const KEYS_START = sketch(`let x = 200;
let y = 200;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("midnightblue");

  // Move the player with the arrow keys.
  if (keyIsDown(RIGHT_ARROW)) {
    x = x + 4;
  }

  // The player
  fill("gold");
  circle(x, y, 40);
}
`);

const ARROWS = [
  { key: 'ArrowRight', name: 'right arrow', code: 'RIGHT_ARROW', axis: 'x', sign: 1 },
  { key: 'ArrowLeft', name: 'left arrow', code: 'LEFT_ARROW', axis: 'x', sign: -1 },
  { key: 'ArrowUp', name: 'up arrow', code: 'UP_ARROW', axis: 'y', sign: -1 },
  { key: 'ArrowDown', name: 'down arrow', code: 'DOWN_ARROW', axis: 'y', sign: 1 },
] as const;

/** Each arrow is held for 10 frames, one after another, with the player in the middle. A variable is read at the end of a frame, from frame 1. */
const HOLD: SketchInput = { frames: 60, keys: ARROWS.map((a, i) => [a.key, 2 + i * 14, 12 + i * 14] as [string, number, number]), watch: ['x', 'y'] };

export const ARROW_KEYS = check(
  'arrows',
  'Move the player with all four arrow keys',
  (c) => {
    const r = play(c, HOLD, { x: 200, y: 200 });
    if (typeof r === 'string') return r;
    const v = r.sketch;
    for (const [i, a] of ARROWS.entries()) {
      const [from, to] = [1 + i * 14, 11 + i * 14];
      const d = { x: (num(v, to, 'x') ?? 0) - (num(v, from, 'x') ?? 0), y: (num(v, to, 'y') ?? 0) - (num(v, from, 'y') ?? 0) };
      const other = a.axis === 'x' ? 'y' : 'x';
      const along = d[a.axis] * a.sign;
      if (along > 0 && Math.abs(d[other]) < 0.5) continue;
      if (along < 0) return `Holding the ${a.name} moves the player the wrong way.${a.axis === 'y' ? ' y counts down from the top, so going up makes y smaller, and going down makes it bigger.' : ' Going left makes x smaller.'}`;
      if (Math.abs(d[other]) >= 0.5) return `Holding the ${a.name} moves the player ${other === 'x' ? 'sideways' : 'up or down'}. Change \`${a.axis}\` for the ${a.name}.`;
      return `Holding the ${a.name} doesn't move the player. Add an if with \`keyIsDown(${a.code})\`.`;
    }
    // The player is drawn before or after x changes in a frame, so it is near x, not always on it.
    const player = v.frame(10)?.shapes.find((s) => ROUND.includes(s.kind) && Math.abs(center(s)[0] - (num(v, 10, 'x') ?? NaN)) <= 4.5 && Math.abs(center(s)[1] - (num(v, 10, 'y') ?? NaN)) <= 4.5);
    if (!player) return 'Draw the player at x and y: `circle(x, y, 40);`';
    return undefined;
  },
  ['Copy the if for the right arrow, and change it for the left arrow: `keyIsDown(LEFT_ARROW)` and `x = x - 4;`.', 'Up and down change y. y counts down from the top, so up is `y = y - 4;`.'],
);

// --- step 2: the walls -------------------------------------------------------

export const WALLS_START = sketch(`let x = 200;
let y = 200;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("midnightblue");

  // Move the player with the arrow keys.
  if (keyIsDown(RIGHT_ARROW)) {
    x = x + 4;
  }
  if (keyIsDown(LEFT_ARROW)) {
    x = x - 4;
  }
  if (keyIsDown(UP_ARROW)) {
    y = y - 4;
  }
  if (keyIsDown(DOWN_ARROW)) {
    y = y + 4;
  }

  // Stay on the canvas here.

  // The player
  fill("gold");
  circle(x, y, 40);
}
`);

/** Each arrow held for 150 frames, long enough to cross the canvas. */
const LONG: SketchInput = { frames: 600, keys: ARROWS.map((a, i) => [a.key, 1 + i * 150, 150 + i * 150] as [string, number, number]), watch: ['x', 'y'] };

export const WALLS = check(
  'walls',
  'Keep the player on the canvas',
  (c) => {
    const r = play(c, LONG, { x: 200, y: 200 });
    if (typeof r === 'string') return r;
    const v = r.sketch;
    const size = { x: v.canvas.w, y: v.canvas.h };
    for (const [i, a] of ARROWS.entries()) {
      const vals: number[] = [];
      for (let n = i * 150 + 1; n < 150 + i * 150; n++) vals.push(num(v, n, a.axis) ?? NaN);
      const wall = a.sign > 0 ? size[a.axis] : 0;
      const edge = a.sign > 0 ? `${a.axis === 'x' ? 'right' : 'bottom'} edge` : `${a.axis === 'x' ? 'left' : 'top'} edge`;
      const far = a.sign > 0 ? Math.max(...vals) : Math.min(...vals);
      const jumped = vals.some((q, j) => j > 0 && (q - vals[j - 1]) * a.sign < -20);
      if (jumped) return `Holding the ${a.name}, the player jumps to the other side when it reaches the ${edge}. Set ${a.axis} to the edge instead, so it stops there.`;
      const name = a.axis === 'x' ? 'width' : 'height';
      if ((far - wall) * a.sign > 6) return `Holding the ${a.name} takes the player past the ${edge}, to ${a.axis} = ${Math.round(far)}. When ${a.axis} is ${a.sign > 0 ? `greater than \`${name}\`, set ${a.axis} to \`${name}\`` : `less than 0, set ${a.axis} to 0`}.`;
      if ((wall - far) * a.sign > 25) return `Holding the ${a.name}, the player stops at ${a.axis} = ${Math.round(far)}, before it reaches the ${edge}.`;
    }
    return undefined;
  },
  ['After the ifs for the keys, add one more: `if (x > width) {`, with `x = width;` inside it.', 'Do the same for the left edge with `x < 0`, and for the top and the bottom with y and `height`.', 'To stop the player before it goes halfway off, use `width - 20` and 20. Its edge is 20 from its middle.'],
);

// --- step 3: the target ------------------------------------------------------

export const TARGET_START = sketch(`let x = 200;
let y = 200;
let tx = 100;
let ty = 100;
let score = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("midnightblue");
  movePlayer();

  // The target
  fill("tomato");
  circle(tx, ty, 30);

  // The player
  fill("gold");
  circle(x, y, 40);

  // Check for a catch here.

  // Show the score here.

}

${MOVE_PLAYER}`);

const GAME = ['x', 'y', 'tx', 'ty', 'score'];

/** The player sits on the target, at (200, 200) and (210, 200), with this score. */
const onTarget = (c: JsCheckCtx, score = 0, frames = 6) => play(c, { frames, watch: GAME }, { x: 200, y: 200, tx: 210, ty: 200, score });

export const CATCH = check(
  'catch',
  'Add 1 to score when the player touches the target',
  (c) => {
    const r = onTarget(c);
    if (typeof r === 'string') return r;
    const s1 = num(r.sketch, 1, 'score');
    if (s1 === undefined) return keepName('score');
    if (s1 === 0) return 'The player is on the target, and `score` stays 0. Add an if: when `dist(x, y, tx, ty)` is less than 35, add 1 to `score`.';
    if (s1 !== 1) return `One catch made \`score\` go up by ${s1}. Add 1 to it: \`score = score + 1;\``;
    const far = play(c, { frames: 6, watch: GAME }, { x: 60, y: 60, tx: 300, ty: 300, score: 0 });
    if (typeof far === 'string') return far;
    if (num(far.sketch, 5, 'score') !== 0) return 'The score goes up when the player is far from the target. Add 1 only when `dist(x, y, tx, ty)` is less than 35.';
    const near = play(c, { frames: 3, watch: GAME }, { x: 200, y: 200, tx: 245, ty: 200, score: 0 });
    if (typeof near === 'string') return near;
    if (num(near.sketch, 1, 'score') !== 0) return 'The score goes up when the circles are 45 apart, and they do not touch yet. They touch when the distance is less than 35.';
    return undefined;
  },
  ['`dist(x, y, tx, ty)` is the distance from the middle of the player to the middle of the target.', 'Write `if (dist(x, y, tx, ty) < 35) {`, and inside it, `score = score + 1;`.'],
);

export const MOVE_TARGET = check(
  'move-target',
  'Move the target to a new place after each catch',
  (c) => {
    const r = onTarget(c);
    if (typeof r === 'string') return r;
    const v = r.sketch;
    const [tx, ty] = [num(v, 1, 'tx'), num(v, 1, 'ty')];
    if (tx === undefined || ty === undefined) return keepName(tx === undefined ? 'tx' : 'ty');
    if (tx === 210 && ty === 200) return 'After a catch, the target stays where it is, so the score keeps going up while the player sits on it. Inside your if, set `tx` and `ty` to `random(30, 370)`.';
    if (tx === 210 || ty === 200) return `After a catch, the target only moves ${tx === 210 ? 'up or down' : 'left or right'}. Give both \`tx\` and \`ty\` a new value.`;
    if (tx < 0 || tx > v.canvas.w || ty < 0 || ty > v.canvas.h) return `After a catch, the target moved to ${at(tx, ty)}, off the canvas. Use \`random(30, 370)\` so it lands on the canvas.`;
    for (let n = 2; n <= 5; n++) {
      const caught = num(v, n, 'score') !== num(v, n - 1, 'score');
      if (!caught && (num(v, n, 'tx') !== num(v, n - 1, 'tx') || num(v, n, 'ty') !== num(v, n - 1, 'ty'))) return 'The target moves in every frame, not only after a catch. Put the lines that move it inside the if.';
    }
    return undefined;
  },
  ['`random(30, 370)` gives a new random number from 30 up to 370 each time it runs.', 'Inside the if, below the score line, write `tx = random(30, 370);` and `ty = random(30, 370);`.'],
);

/** Text on the canvas at the end of frame n. */
const textsAt = (v: SketchView, n: number): Shape[] => v.visible(n).filter((s) => s.kind === 'text' && v.onCanvas(s));

export const SCORE = check(
  'score',
  'Show the score on the canvas',
  (c) => {
    const r = play(c, { frames: 2, watch: GAME }, { x: 60, y: 60, tx: 300, ty: 300, score: 7 });
    if (typeof r === 'string') return r;
    const v = r.sketch;
    const texts = textsAt(v, 1);
    if (texts.some((t) => /(^|\D)7(\D|$)/.test(t.text ?? ''))) return undefined;
    if (!texts.length) {
      if (v.shapes('text').length) return 'Your text is drawn before `background()`, or off the canvas, so it does not show. Put it near the end of draw().';
      return 'Show the score with `text()`, near the end of draw(): `text("Score: " + score, 20, 30);`';
    }
    return `Your text says "${texts[0].text}", and it doesn't show the score. Join the score on with \`+\`: \`"Score: " + score\`.`;
  },
  ['`text()` takes the words, then x and y.', '`"Score: " + score` joins the words and the number into one piece of text.', 'Write `text("Score: " + score, 20, 30);` near the end of draw(). `textSize(24);` above it makes it bigger.'],
);

// --- step 4: win -------------------------------------------------------------

export const WIN_START = sketch(`let x = 200;
let y = 200;
let tx = 100;
let ty = 100;
let score = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("midnightblue");
  movePlayer();

  // The target
  fill("tomato");
  circle(tx, ty, 30);

  // The player
  fill("gold");
  circle(x, y, 40);

  // A catch
  if (dist(x, y, tx, ty) < 35) {
    score = score + 1;
    tx = random(30, 370);
    ty = random(30, 370);
  }

  // The score
  fill("white");
  textSize(24);
  text("Score: " + score, 20, 35);

  // Win at 5 here.

}

${MOVE_PLAYER}`);

/** The frame where draw() last ran. */
const lastDrawn = (v: SketchView) => v.drawn[v.drawn.length - 1]?.n ?? 0;

export const STOPS = check(
  'stops',
  'Stop the game when the score reaches 5',
  (c) => {
    const r = onTarget(c, 4, 10);
    if (typeof r === 'string') return r;
    const v = r.sketch;
    if (num(v, 1, 'score') !== 5) return 'Keep the code that adds 1 to the score after a catch.';
    if (lastDrawn(v) > 3) return 'The score reached 5, and the game kept going. Add an if: when `score` is 5 or more, call `noLoop()`.';
    const early = play(c, { frames: 10, watch: GAME }, { x: 60, y: 60, tx: 300, ty: 300, score: 3 });
    if (typeof early === 'string') return early;
    if (lastDrawn(early.sketch) < 10) return 'The game stops before the score reaches 5. Call `noLoop()` only inside an if that checks the score.';
    return undefined;
  },
  ['`noLoop()` tells p5.js to stop running draw(), so the game freezes.', 'Write `if (score >= 5) {`, and put `noLoop();` inside it.'],
);

export const MESSAGE = check(
  'message',
  'Show a message when the player wins',
  (c) => {
    const before = play(c, { frames: 3, watch: GAME }, { x: 60, y: 60, tx: 300, ty: 300, score: 3 });
    if (typeof before === 'string') return before;
    const plain = (t: Shape) => (t.text ?? '').replace(/\d+/g, '#');
    const usual = new Set(textsAt(before.sketch, 2).map(plain));
    const r = onTarget(c, 4, 10);
    if (typeof r === 'string') return r;
    const end = textsAt(r.sketch, lastDrawn(r.sketch));
    if (end.some((t) => !usual.has(plain(t)))) return undefined;
    return 'When the score reaches 5, the game stops with no message. Inside the same if, show one with `text()`, like `text("You win!", 130, 200);`.';
  },
  ['Put the message inside the if that calls `noLoop()`.', '`textSize(40);` above it makes the message big.'],
);

// --- optional: a timer -------------------------------------------------------

export const TIMER_START = sketch(WIN_START[0].text.replace('let score = 0;\n', 'let score = 0;\nlet timeLeft = 20;\n').replace('  // Win at 5 here.\n', `  // Win at 5
  if (score >= 5) {
    textSize(48);
    text("You win!", 100, 210);
    noLoop();
  }

  // The timer goes here.
`));

/** A long game where the player never moves, so only the timer can end it. */
const IDLE = (c: JsCheckCtx) => play(c, { frames: 1800, watch: ['timeLeft', 'score'] }, { x: 60, y: 60, tx: 300, ty: 300, score: 0 });

export const COUNTS = check(
  'counts',
  'Count timeLeft down by 1 each second',
  (c) => {
    const r = IDLE(c);
    if (typeof r === 'string') return r;
    const v = r.sketch;
    const t = [1, 61, 121, 181].map((n) => num(v, n, 'timeLeft'));
    if (t.some((q) => q === undefined)) return keepName('timeLeft');
    const steps = t.slice(1).map((q, i) => (t[i] as number) - (q as number));
    if (steps.every((d) => d === 0)) return 'timeLeft stays the same. When `frameCount % 60 === 0`, take 1 from it.';
    const quick = (t[0] as number) - (num(v, 11, 'timeLeft') ?? 0);
    if (quick >= 5) return 'timeLeft goes down in every frame, about 60 times a second. Take 1 from it only once a second, when `frameCount % 60 === 0`.';
    if (steps.some((d) => Math.abs(d - 1) > 0.05)) return 'timeLeft should go down by 1 each second. Take 1 from it when `frameCount % 60 === 0`.';
    return undefined;
  },
  ['`frameCount` counts the frames since the sketch started, about 60 each second.', '`frameCount % 60` is the remainder after dividing by 60. It is 0 once every 60 frames.', 'Write `if (frameCount % 60 === 0) {`, and inside it, `timeLeft = timeLeft - 1;`.'],
);

export const TIME_SHOWN = check(
  'time-shown',
  'Show the time left on the canvas',
  (c) => {
    const r = IDLE(c);
    if (typeof r === 'string') return r;
    const v = r.sketch;
    const left = num(v, 130, 'timeLeft');
    if (textsAt(v, 130).some((t) => new RegExp(`(^|\\D)${left}(\\D|$)`).test(t.text ?? ''))) return undefined;
    return 'Show `timeLeft` with `text()`, the way the score shows, at another spot on the canvas.';
  },
  ['Try `text("Time: " + timeLeft, 280, 35);`.'],
);

export const TIME_UP = check(
  'time-up',
  "Stop the game with a message when time runs out",
  (c) => {
    const r = IDLE(c);
    if (typeof r === 'string') return r;
    const v = r.sketch;
    const end = lastDrawn(v);
    if (end >= 1800) return 'Time runs out, and the game keeps going. When `timeLeft` reaches 0, show a message and call `noLoop()`.';
    if ((num(v, end, 'timeLeft') ?? 1) > 0) return 'The game stops before time runs out. Call `noLoop()` only when `timeLeft` is 0 or less.';
    const before = textsAt(v, Math.max(1, end - 2)).map((t) => (t.text ?? '').replace(/\d+/g, '#'));
    if (!textsAt(v, end).some((t) => !before.includes((t.text ?? '').replace(/\d+/g, '#')))) return 'The game stops when time runs out, with no message. Show one with `text()`, like `text("Time\'s up!", 100, 210);`.';
    return undefined;
  },
  ['This if looks like the one for winning: `if (timeLeft <= 0) {`.', 'Inside it, show a message with `text()`, then call `noLoop();`.'],
);
