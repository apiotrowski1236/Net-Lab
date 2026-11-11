import { describe, expect, it } from 'vitest';
import { JsCheckCtx, jsModel, startLive, type JsState } from '../demos/js';
import type { JsCheck, JsSpec } from '../demos/types';
import type { SketchInput } from './types';

/** Runs a sketch the way the editor's Run does, and returns the state. */
function run(code: string, extra: Partial<JsSpec> = {}): JsState {
  const spec: JsSpec = { kind: 'js', id: 't', title: 'T', files: [{ name: 'sketch.js', text: code }], sketch: true, ...extra };
  return jsModel.apply(spec, jsModel.init(spec), { run: true });
}

/** A hidden run, the way a check makes one. */
function hidden(code: string, input: SketchInput = {}) {
  let out: ReturnType<JsCheckCtx['run']> | undefined;
  const check: JsCheck = {
    id: 'c',
    label: 'c',
    test(c) {
      out = c.run({ sketch: input });
      return undefined;
    },
  };
  run(code, { checks: [check] });
  return out!;
}

const rules = (s: JsState) => (s.notes ?? []).map((n) => n.rule);
const texts = (s: JsState) => (s.notes ?? []).map((n) => n.text);

describe('a sketch starts the way p5.js starts one', () => {
  it('runs setup once, then draw once a frame, with frameCount counting draws', () => {
    const r = hidden('let n = 0;\nfunction setup() {\n  createCanvas(200, 100);\n  console.log("setup", frameCount);\n}\nfunction draw() {\n  n = n + 1;\n}\n', { frames: 5, watch: ['n'] });
    expect(r.text).toBe('setup 0');
    expect(r.sketch!.canvas).toEqual({ w: 200, h: 100, made: true });
    expect(r.sketch!.frames.map((f) => f.vars?.n)).toEqual([undefined, 1, 2, 3, 4, 5]);
    expect(r.vars.n).toBe(5);
  });

  it('stops p5.js names at the top of the code, with p5.js help', () => {
    const s = run('createCanvas(400, 400);\ncircle(10, 10, 5);\n');
    expect(s.last!.error!.msg).toBe('createCanvas is not defined');
    expect(s.last!.error!.help).toMatch(/^createCanvas belongs to p5.js, and p5.js starts only after the top of your code has run\. Use createCanvas inside setup\(\) or draw\(\)/);
    const w = run('let x = width / 2;\nfunction setup() {}\n');
    expect(w.last!.error!.help).toMatch(/^width belongs to p5.js/);
  });

  it('notes code with no setup or draw', () => {
    const s = run('let x = 5;\n');
    expect(s.last!.status).toBe('ok');
    expect(rules(s)).toContain('no-sketch');
    expect(s.last!.sketch!.started).toBe(false);
  });

  it('uses a 100 by 100 canvas with no createCanvas, and says so', () => {
    const s = run('function setup() {\n  circle(50, 50, 20);\n}\n');
    expect(s.last!.sketch).toMatchObject({ w: 100, h: 100, made: false });
    expect(rules(s)).toContain('no-canvas');
  });
});

describe('shapes, as p5.js places them', () => {
  const one = (line: string, before = '') => hidden(`function setup() {\n  createCanvas(400, 400);\n  ${before}\n  ${line}\n}\n`, { frames: 0 }).sketch!.shapes()[0];

  it('centers circles and ellipses, and puts rect corners at x, y', () => {
    expect(one('circle(100, 50, 40);')).toMatchObject({ kind: 'circle', x: 80, y: 30, w: 40, h: 40 });
    expect(one('ellipse(100, 50, 40);')).toMatchObject({ kind: 'ellipse', w: 40, h: 40 });
    expect(one('ellipse(100, 50, 40, 20);')).toMatchObject({ x: 80, y: 40, w: 40, h: 20 });
    expect(one('rect(10, 20, 30, 40);')).toMatchObject({ kind: 'rect', x: 10, y: 20, w: 30, h: 40 });
    expect(one('rect(10, 20, 30);')).toMatchObject({ w: 30, h: 30 });
    expect(one('square(10, 20, 30);')).toMatchObject({ kind: 'square', w: 30, h: 30 });
    expect(one('rect(100, 100, 40, 20);', 'rectMode(CENTER);')).toMatchObject({ x: 80, y: 90 });
    expect(one('triangle(0, 10, 20, 0, 40, 30);')).toMatchObject({ x: 0, y: 0, w: 40, h: 30 });
  });

  it('starts with a white fill, a black stroke 1 thick, and keeps style across frames', () => {
    expect(one('circle(1, 1, 1);')).toMatchObject({ fill: [255, 255, 255, 255], stroke: [0, 0, 0, 255], weight: 1 });
    const r = hidden('function setup() {\n  createCanvas(100, 100);\n}\nfunction draw() {\n  circle(50, 50, 10);\n  fill("red");\n}\n', { frames: 2 });
    expect(r.sketch!.shapes('circle').map((s) => s.fill)).toEqual([
      [255, 255, 255, 255],
      [255, 0, 0, 255],
    ]);
  });

  it('reads colors the way p5.js does', () => {
    const fill = (args: string) => one('circle(1, 1, 1);', `fill(${args});`).fill;
    expect(fill('200')).toEqual([200, 200, 200, 255]);
    expect(fill('0, 100')).toEqual([0, 0, 0, 100]);
    expect(fill('255, 0, 0')).toEqual([255, 0, 0, 255]);
    expect(fill('300, -5, 0, 128')).toEqual([255, 0, 0, 128]);
    expect(fill('"skyblue"')).toEqual([135, 206, 235, 255]);
    expect(fill('"#f00"')).toEqual([255, 0, 0, 255]);
    expect(fill('"#00ff0080"')).toEqual([0, 255, 0, 128]);
    expect(fill('"rgb(1, 2, 3)"')).toEqual([1, 2, 3, 255]);
    expect(fill('color(10, 20, 30)')).toEqual([10, 20, 30, 255]);
    expect(one('circle(1, 1, 1);', 'noFill();').fill).toBeNull();
  });

  it('moves shapes with translate and rotate, and resets the transform before each draw', () => {
    const r = hidden('function setup() {\n  createCanvas(400, 400);\n  angleMode(DEGREES);\n}\nfunction draw() {\n  translate(100, 50);\n  rect(0, 0, 10, 20);\n  rotate(90);\n  rect(0, 0, 10, 20);\n}\n', { frames: 2 });
    const [a, b, c] = r.sketch!.shapes('rect');
    expect(a).toMatchObject({ x: 100, y: 50, w: 10, h: 20 });
    expect(b.x).toBeCloseTo(80);
    expect(b.w).toBeCloseTo(20);
    expect(b.h).toBeCloseTo(10);
    expect(c).toMatchObject({ x: 100, y: 50 });
  });

  it('notes a shape with too few numbers, or a NaN, and draws nothing', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n  circle(100, 100);\n  let size;\n  circle(100, 100, size + 1);\n  circle("100", 100, 20);\n}\n');
    expect(texts(s)).toEqual(
      expect.arrayContaining([
        'circle() needs 3 numbers: x, y, and the diameter (how wide the circle is). This line gives it 2, so nothing was drawn.',
        'circle() got NaN (not a number) as its third value, the diameter, so nothing was drawn. A variable in it may not have a value yet, or may hold text.',
        'circle() needs numbers, and its first value, x, is the string "100". Take the quotes off. A number in quotes is text.',
      ]),
    );
    expect(s.last!.sketch!.still.filter((x) => x.kind === 'circle')).toHaveLength(1);
  });

  it('notes a color p5.js does not know, and uses white', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n  fill("bleu");\n  circle(10, 10, 10);\n}\n');
    expect(texts(s)).toContain('p5.js doesn\'t know the color "bleu", so it uses white. Did you mean "blue"?');
    expect(s.last!.sketch!.still.find((x) => x.kind === 'circle')!.fill).toEqual([255, 255, 255, 255]);
  });
});

describe('notes on mistakes p5.js lets pass', () => {
  it('a fill after the last shape', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n  circle(200, 200, 50);\n  fill("red");\n}\n');
    expect((s.notes ?? []).find((n) => n.rule === 'unused-style')).toMatchObject({ line: 4, text: "fill() on this line colors nothing, because no shape is drawn after it. fill() sets the color for the shapes that come after it, so move this line above the shape it's for." });
  });

  it('a fill at the end of draw is used by the next frame, so it is not noted', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n}\nfunction draw() {\n  circle(200, 200, 50);\n  fill("red");\n}\n');
    expect(rules(s)).not.toContain('unused-style');
  });

  it('a background that covers shapes drawn before it', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n}\nfunction draw() {\n  circle(200, 200, 50);\n  background(220);\n}\n');
    expect((s.notes ?? []).find((n) => n.rule === 'background-covers')).toMatchObject({ line: 6 });
    expect(texts(s)).toContain("background() on this line paints over the whole canvas, so it covers the circle drawn on line 5. Anything drawn before background() doesn't show. Call background() first.");
  });

  it('a shape that is never on the canvas', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n  circle(500, 200, 50);\n  circle(380, 200, 50);\n}\n');
    expect((s.notes ?? []).filter((n) => n.rule === 'off-canvas')).toEqual([{ rule: 'off-canvas', file: 'sketch.js', line: 3, text: 'The circle on this line is drawn outside the 400 by 400 canvas, around x = 500 and y = 200, so it never shows. x counts from the left edge, and y counts down from the top.' }]);
  });

  it('a variable declared inside draw that never builds up', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n}\nfunction draw() {\n  background(220);\n  let x = 0;\n  x = x + 2;\n  circle(x, 200, 50);\n}\n');
    expect((s.notes ?? []).find((n) => n.rule === 'reset-in-draw')).toMatchObject({ line: 6, text: 'x is declared inside draw(), so it starts over at 0 each time draw() runs, about 60 times a second, and it never builds up. Move let x = 0; to the top of your code, above setup(), and keep the line that changes it inside draw().' });
  });

  it('a misspelled setup or draw', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n}\nfunction Draw() {\n  circle(1, 1, 1);\n}\n');
    expect(texts(s)).toContain('p5.js runs a function only if it has the exact name it looks for, so it never runs Draw(). Did you mean draw()? Capital and lowercase letters count.');
    const k = run('function setup() {}\nfunction keypress() {}\n');
    expect(texts(k)).toContain('p5.js runs a function only if it has the exact name it looks for, so it never runs keypress(). Did you mean keyPressed()?');
  });

  it('a variable named like one of p5.js\'s', () => {
    const s = run('let width = 50;\nfunction setup() {\n  createCanvas(400, 400);\n}\n');
    expect((s.notes ?? []).find((n) => n.rule === 'p5-name')).toMatchObject({ line: 1 });
  });

  it('an event function used as a test', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n}\nfunction draw() {\n  if (mousePressed) {\n    circle(1, 1, 1);\n  }\n}\nfunction mousePressed() {}\n');
    expect((s.notes ?? []).find((n) => n.rule === 'callback-as-test')).toMatchObject({ line: 5 });
    const undef = run('function setup() {\n  createCanvas(400, 400);\n}\nfunction draw() {\n  if (mousePressed) {\n    circle(1, 1, 1);\n  }\n}\n');
    expect(undef.last!.error!.help).toMatch(/^mousePressed is the name of a function p5.js runs when the mouse is clicked/);
  });

  it('mouseIsPressed called like a function', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n}\nfunction draw() {\n  if (mouseIsPressed()) {\n    circle(1, 1, 1);\n  }\n}\n');
    expect(s.last!.error!.help).toBe('mouseIsPressed is a variable that p5.js keeps up to date, not a function, so it takes no ( ). Write mouseIsPressed with nothing after it.');
  });

  it('key compared with a word', () => {
    const s = run('function setup() {}\nfunction keyPressed() {\n  if (key === "left") {\n    print("left");\n  }\n}\n');
    expect(texts(s)).toContain('When that key is pressed, key is "ArrowLeft", not "left". Compare with "ArrowLeft", or use keyIsDown(LEFT_ARROW).');
  });

  it('a starter with only setup and a shape has no notes', () => {
    const s = run('function setup() {\n  createCanvas(400, 400);\n  background("lavender");\n  circle(200, 200, 100);\n}\n');
    expect(s.notes).toBeUndefined();
  });
});

describe('input, frame by frame', () => {
  const game = `let x = 200;
let clicks = 0;
let typed = "";
function setup() {
  createCanvas(400, 400);
}
function draw() {
  if (keyIsDown(LEFT_ARROW)) {
    x = x - 5;
  }
  if (mouseIsPressed) {
    fill("red");
  } else {
    fill("white");
  }
  circle(mouseX, mouseY, 20);
}
function mousePressed() {
  clicks = clicks + 1;
}
function keyPressed() {
  typed = typed + key;
}
`;
  it('moves the mouse, holds the button and keys, and calls the event functions once a press', () => {
    const r = hidden(game, { frames: 10, mouse: [[3, 50, 60]], press: [[4, 6]], keys: [['ArrowLeft', 2, 5]], watch: ['x', 'clicks'] });
    const v = r.sketch!;
    expect(v.frames.slice(1).map((f) => f.vars!.x)).toEqual([200, 195, 190, 185, 185, 185, 185, 185, 185, 185]);
    expect(v.frame(2)!.shapes[0]).toMatchObject({ x: -10, y: -10 });
    expect(v.frame(3)!.shapes[0]).toMatchObject({ x: 40, y: 50 });
    expect(v.frames.slice(1).map((f) => f.shapes[0].fill![1])).toEqual([255, 255, 255, 0, 0, 255, 255, 255, 255, 255]);
    expect(r.vars.clicks).toBe(1);
    expect(r.vars.typed).toBe('ArrowLeft');
  });

  it('a click inside one frame calls mousePressed', () => {
    expect(hidden(game, { frames: 3, press: [[2, 2]] }).vars.clicks).toBe(1);
  });

  it('runs draw once after noLoop in setup, and again after redraw', () => {
    const r = hidden('let n = 0;\nfunction setup() {\n  noLoop();\n}\nfunction draw() {\n  n = n + 1;\n}\nfunction mousePressed() {\n  redraw();\n}\n', { frames: 5, press: [[3, 4]] });
    expect(r.vars.n).toBe(2);
  });

  it('stops prompt in draw with help', () => {
    const s = run('function setup() {}\nfunction draw() {\n  let name = prompt("Name?");\n}\n');
    expect(s.last!.error).toMatchObject({ code: 'ask-held', msg: "prompt() can't be used here." });
  });

  it('gives random the run\'s seed, so a check sees the same numbers each time', () => {
    const code = 'let a;\nfunction setup() {\n  a = random(10, 20);\n}\n';
    const one = hidden(code).vars.a as number;
    expect(one).toBeGreaterThanOrEqual(10);
    expect(one).toBeLessThan(20);
    expect(hidden(code).vars.a).toBe(one);
  });

  it('stops an endless loop in draw', () => {
    const r = hidden('function setup() {}\nfunction draw() {\n  while (true) {}\n}\n');
    expect(r.status).toBe('limit');
  });
});

describe('the live canvas', () => {
  const spec: JsSpec = { kind: 'js', id: 't', title: 'T', files: [], sketch: true };
  it('runs setup, then a frame at a time, handing over what each frame drew', () => {
    const live = startLive(spec, { files: [{ name: 'sketch.js', text: 'let x = 0;\nfunction setup() {\n  createCanvas(300, 200);\n  print("hi");\n}\nfunction draw() {\n  background(0);\n  x = x + 1;\n  circle(x, mouseY, 10);\n}\n' }], runs: 1, answers: [] })!;
    expect(live.first.status).toBe('ok');
    expect(live.first.lines.map((l) => l.text)).toEqual(['hi']);
    expect(live.sketch.drain().resized).toBe(true);
    live.step([{ t: 'move', x: 5, y: 70 }]);
    const { shapes } = live.sketch.drain();
    expect(shapes.map((s) => s.kind)).toEqual(['background', 'circle']);
    expect(shapes[1]).toMatchObject({ x: -4, y: 65 });
    for (let i = 0; i < 1000; i++) live.step([]);
    expect(live.sketch.frames).toHaveLength(0);
    expect(live.sketch.drain().shapes).toHaveLength(2000);
  });

  it('stops for good on an error in a frame, with help', () => {
    const live = startLive(spec, { files: [{ name: 'sketch.js', text: 'function setup() {}\nfunction draw() {\n  if (mouseIsPressed) {\n    circel(1, 1, 1);\n  }\n}\n' }], runs: 1, answers: [] })!;
    expect(live.step([]).status).toBe('ok');
    const r = live.step([{ t: 'down' }]);
    expect(r.status).toBe('error');
    expect(r.error!.help).toBe('p5.js has nothing called circel. Did you mean circle?');
  });

  it('gives each frame its own step budget', () => {
    const live = startLive(spec, { files: [{ name: 'sketch.js', text: 'let n = 0;\nfunction setup() {}\nfunction draw() {\n  for (let i = 0; i < 1000; i++) {\n    n = n + 1;\n  }\n}\n' }], runs: 1, answers: [] })!;
    for (let i = 0; i < 300; i++) expect(live.step([]).status).toBe('ok');
    const stuck = startLive(spec, { files: [{ name: 'sketch.js', text: 'function setup() {}\nfunction draw() {\n  let i = 0;\n  while (i < 10) {\n    i = i;\n  }\n}\n' }], runs: 1, answers: [] })!;
    expect(stuck.step([]).status).toBe('limit');
  });
});

describe('arrow key names', () => {
  it('points a bare arrow name at the p5.js constant', () => {
    const s = run('function setup() {\n  createCanvas(100, 100);\n}\nfunction draw() {\n  if (keyIsDown(UP)) {\n    circle(1, 1, 1);\n  }\n}\n');
    expect(s.last!.error!.help).toBe('p5.js has nothing called UP. For the up arrow key, use UP_ARROW, as in keyIsDown(UP_ARROW).');
    const t = run('function setup() {\n  createCanvas(100, 100);\n}\nfunction draw() {\n  if (keyIsDown(ArrowLeft)) {\n    circle(1, 1, 1);\n  }\n}\n');
    expect(t.last!.error!.help).toContain('use LEFT_ARROW');
  });
});
