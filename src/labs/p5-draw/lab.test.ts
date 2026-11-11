import { describe, expect, test } from 'vitest';
import { jsModel, type JsState } from '../../demos/js';
import type { JsSpec } from '../../demos/types';
import { p5DrawLab } from './index';
import { CANVAS_DONE, FACE_DONE, LIGHT_DONE, PAINT_DONE, PICTURE_DONE, STAMP_DONE } from './solution';

const spec = (step: string): JsSpec => p5DrawLab.steps.find((s) => s.id === step)!.demos!.find((d) => d.kind === 'js') as JsSpec;

/** Types `code` into sketch.js and presses Run. */
function attempt(step: string, code: string): JsState {
  const s = spec(step);
  return jsModel.apply(s, jsModel.apply(s, jsModel.init(s), { edit: 'sketch.js', code }), { run: true });
}

/** Everything the student reads about this attempt: the error's help, the notes, and the first unmet check. */
const said = (s: JsState): string[] => [...(s.last?.error?.help ? [s.last.error.help] : []), ...(s.notes ?? []).map((n) => n.text), ...(s.checks ?? []).filter((c) => !c.ok && c.note).map((c) => c.note!)];
const allPassed = (s: JsState) => (s.checks ?? []).length > 0 && s.checks!.every((c) => c.ok);

type Case = [name: string, code: string, words: string];

function wrong(step: string, cases: Case[]) {
  describe(`${step}: a wrong attempt gets a note that names it`, () => {
    for (const [name, code, words] of cases) {
      test(name, () => {
        const s = attempt(step, code);
        expect(said(s).join('\n')).toContain(words);
        expect(allPassed(s)).toBe(false);
      });
    }
  });
}

function right(step: string, cases: [name: string, code: string][]) {
  describe(`${step}: correct code passes with no notes`, () => {
    for (const [name, code] of cases) {
      test(name, () => {
        const s = attempt(step, code);
        expect(s.last?.status).toBe('ok');
        expect(s.checks?.filter((c) => !c.ok).map((c) => c.note)).toEqual([]);
        expect(s.notes).toBeUndefined();
      });
    }
  });
}

const setup = (body: string, top = '') => `${top}function setup() {\n  createCanvas(400, 400);\n${body
  .split('\n')
  .map((l) => (l ? `  ${l}` : l))
  .join('\n')}\n}\n`;

describe('every starter runs with no notes', () => {
  for (const step of p5DrawLab.steps) {
    for (const d of step.demos ?? []) {
      test(step.id, () => {
        const sp = d as JsSpec;
        const s = jsModel.apply(sp, jsModel.init(sp), { run: true });
        expect(s.last?.status).toBe('ok');
        expect(s.notes).toBeUndefined();
        expect(allPassed(s)).toBe(false);
      });
    }
  }
});

right('canvas', [
  ['the answer key', CANVAS_DONE],
  ['a gray number and width / 2', setup('background(90);\ncircle(width / 2, height / 2, 60);')],
  ['three numbers for the color', setup('background(30, 120, 200);\nfill("gold");\ncircle(200, 200, 300);')],
]);

wrong('canvas', [
  ['the starter gray', setup('background(220);\ncircle(200, 200, 100);'), 'Change `220`'],
  ['a circle in a corner', setup('background("pink");\ncircle(50, 50, 100);'), "Your circle's middle is at (50, 50). The middle of this 400 by 400 canvas is (200, 200)."],
  ['a circle under the background', setup('circle(200, 200, 100);\nbackground("pink");'), 'the background paints over it'],
  ['no circle yet', setup('background("pink");'), 'Add a circle inside setup'],
  ['a misspelled color', setup('background("skyblu");\ncircle(200, 200, 100);'), 'Did you mean "skyblue"?'],
  ['drawing outside setup', 'createCanvas(400, 400);\nbackground("pink");\n', 'createCanvas belongs to p5.js'],
  ['a misspelled function', setup('background("pink");\ncirlce(200, 200, 100);'), 'Did you mean circle?'],
  ['no setup at all', 'function setUp() {\n  createCanvas(400, 400);\n}\n', 'Did you mean setup()?'],
]);

right('shapes', [
  ['the answer key', LIGHT_DONE],
  ['smaller circles, closer together', setup('background("skyblue");\nrect(150, 50, 100, 300);\ncircle(200, 150, 50);\ncircle(200, 200, 50);\ncircle(200, 250, 50);')],
  ['their own box', setup('background("skyblue");\nrect(20, 20, 80, 240);\ncircle(60, 60, 60);\ncircle(60, 140, 60);\ncircle(60, 220, 60);')],
]);

const BOX = 'background("skyblue");\nrect(150, 50, 100, 300);\n';
wrong('shapes', [
  ['circles before the box', setup('background("skyblue");\ncircle(200, 110, 70);\ncircle(200, 200, 70);\ncircle(200, 290, 70);\nrect(150, 50, 100, 300);'), 'so it covers the circle'],
  ['a circle outside the box', setup(`${BOX}circle(200, 110, 70);\ncircle(200, 200, 70);\ncircle(300, 290, 70);`), 'has its middle at (300, 290), outside the box. The box covers x from 150 to 250 and y from 50 to 350.'],
  ['two circles', setup(`${BOX}circle(200, 110, 70);\ncircle(200, 200, 70);`), 'The box has 2 circles in it so far.'],
  ['not in a column', setup(`${BOX}circle(180, 110, 40);\ncircle(220, 200, 40);\ncircle(200, 290, 40);`), 'Give all three circles the same x'],
  ['overlapping', setup(`${BOX}circle(200, 110, 70);\ncircle(200, 150, 70);\ncircle(200, 290, 70);`), 'overlap'],
  ['too big for the box', setup(`${BOX}circle(200, 110, 120);\ncircle(200, 230, 110);\ncircle(200, 330, 80);`), 'sticks out past the edge of the box'],
  ['the box deleted', setup('background("skyblue");\ncircle(200, 110, 70);'), 'Keep the `rect()` line.'],
]);

const LIGHTS = (a: string, b: string, c: string) => setup(`background("skyblue");\nfill("dimgray");\nrect(150, 50, 100, 300);\n${a}circle(200, 110, 70);\n${b}circle(200, 200, 70);\n${c}circle(200, 290, 70);\nnoStroke();\nrect(0, 0, 1, 1);`);

right('color', [
  ['the answer key', PAINT_DONE],
  ['number colors and amber', setup('background("skyblue");\nnoStroke();\nfill(40);\nrect(150, 50, 100, 300);\nfill(230, 30, 30);\ncircle(200, 110, 70);\nfill("orange");\ncircle(200, 200, 70);\nfill(0, 200, 80);\ncircle(200, 290, 70);')],
  ['CSS hex colors and a colored stroke', setup('background("skyblue");\nstroke("white");\nfill("#333");\nrect(150, 50, 100, 300);\nfill("#ff0000");\ncircle(200, 110, 70);\nfill("#ffd700");\ncircle(200, 200, 70);\nfill("#00aa00");\ncircle(200, 290, 70);')],
]);

wrong('color', [
  ['fill after the box', setup('background("skyblue");\nrect(150, 50, 100, 300);\nfill("dimgray");\ncircle(200, 110, 70);'), 'The box is still white.'],
  ['one fill for all the lights', LIGHTS('fill("red");\n', '', ''), 'All three circles are red. A fill stays until the next `fill()`'],
  ['the lights upside down', LIGHTS('fill("green");\n', 'fill("yellow");\n', 'fill("red");\n'), 'The top circle is green. Make it red'],
  ['a fill under each light', setup('background("skyblue");\nfill("dimgray");\nrect(150, 50, 100, 300);\ncircle(200, 110, 70);\nfill("red");\ncircle(200, 200, 70);\nfill("yellow");\ncircle(200, 290, 70);\nfill("green");'), 'colors nothing, because no shape is drawn after it'],
  ['outlines unchanged', setup('background("skyblue");\nfill("dimgray");\nrect(150, 50, 100, 300);\nfill("red");\ncircle(200, 110, 70);\nfill("yellow");\ncircle(200, 200, 70);\nfill("green");\ncircle(200, 290, 70);'), 'The outlines are still thin and black.'],
]);

right('picture', [
  ['the answer key', PICTURE_DONE],
  ['text and lines count', setup('background("black");\nstroke("white");\nline(0, 300, 400, 300);\nstroke("red");\nline(0, 310, 400, 310);\nnoStroke();\nfill("yellow");\ntextSize(40);\ntext("Hi!", 20, 60);\nfill("white");\ncircle(300, 80, 50);\ncircle(320, 70, 10);\nellipse(200, 200, 100, 40);')],
]);

wrong('picture', [
  ['too few shapes', setup('background("white");\nfill("red");\ncircle(100, 100, 50);\nrect(10, 10, 20, 20);'), 'Your picture shows 2 shapes so far. Add 4 more.'],
  ['shapes off the canvas', setup('background("white");\ncircle(100, 100, 50);\ncircle(150, 100, 50);\ncircle(200, 100, 50);\ncircle(250, 100, 50);\ncircle(800, 100, 50);\ncircle(900, 100, 50);'), '2 shapes are off the canvas'],
  ['one kind', setup('background("white");\nfill("red");\ncircle(50, 50, 40);\nfill("blue");\ncircle(100, 50, 40);\ncircle(150, 50, 40);\ncircle(200, 50, 40);\nellipse(250, 50, 40, 20);\ncircle(300, 50, 40);'), 'Every shape in your picture is a round shape.'],
  ['two colors', setup('background("white");\nfill("red");\ncircle(50, 50, 40);\nrect(100, 50, 40, 40);\ncircle(150, 50, 40);\nfill("blue");\ncircle(200, 50, 40);\ncircle(250, 50, 40);\ncircle(300, 50, 40);'), 'Your shapes use 2 colors so far'],
]);

const FACE = (head: string, l: string, r: string, m: string) => `let x = 100;\nlet y = 200;\n\nfunction setup() {\n  createCanvas(400, 400);\n  background("lavender");\n  fill("gold");\n  ${head};\n  fill("black");\n  ${l};\n  ${r};\n  ${m};\n}\n`;
const HEAD = 'circle(x, y, 160)';
const L = 'circle(x - 30, y - 20, 20)';
const R = 'circle(x + 30, y - 20, 20)';
const M = 'line(x - 30, y + 40, x + 30, y + 40)';

right('move', [
  ['the answer key', FACE_DONE],
  ['moved with y instead', FACE(HEAD, L, R, M).replace('let x = 100;\nlet y = 200;', 'let x = 200;\nlet y = 120;')],
  ['a different face', `let x = 150;\nlet y = 250;\n\nfunction setup() {\n  createCanvas(400, 400);\n  background("lavender");\n  fill("pink");\n  ellipse(x, y, 140, 170);\n  fill("white");\n  ellipse(x - 30, y - 20, 30, 20);\n  ellipse(x + 30, y - 20, 30, 20);\n  rect(x - 25, y + 30, 50, 10);\n}\n`],
]);

wrong('move', [
  ['the head left alone', FACE('circle(200, 200, 160)', L, R, M), 'The face circle stays in the same place'],
  ['an eye left alone', FACE(HEAD, 'circle(170, 180, 20)', R, M), 'The circle from line 10 stays in place'],
  ['an eye with only x', FACE(HEAD, 'circle(x - 30, 180, 20)', R, M), 'moves left and right with `x`, but not up and down'],
  ['half the mouth', FACE(HEAD, L, R, 'line(x - 30, y + 40, 230, 240)'), 'One end of the line from line 12 moves'],
  ['multiplying', FACE(HEAD, 'circle(x * 0.85, y - 20, 20)', R, M), 'not the same way as the face'],
  ['x not changed', FACE(HEAD, L, R, M).replace('let x = 100;', 'let x = 200;'), 'Now change the 200'],
  ['x moved into setup', `function setup() {\n  let x = 100;\n  let y = 200;\n  createCanvas(400, 400);\n  circle(x, y, 160);\n}\n`, 'Keep the variable named `x` at the top of your code.'],
  ['off the canvas', FACE(HEAD, L, R, M).replace('let x = 100;', 'let x = 900;'), 'The middle of the face is off the canvas at (900, 200).'],
]);

right('stamp', [['the answer key', STAMP_DONE]]);

const STAMP = (calls: string, extra = '', params = 'x, y', skin = '"gold"') => `function setup() {\n  createCanvas(400, 400);\n  background("lavender");\n${calls}}\n\nfunction drawFace(${params}) {\n  fill(${skin});\n  circle(x, y, 100);\n  fill("black");\n  circle(x - 20, y - 10, 12);\n  circle(x + 20, y - 10, 12);\n${extra}}\n`;

wrong('stamp', [
  ['one face', STAMP('  drawFace(100, 200);\n'), 'Your sketch draws 1 face.'],
  ['overlapping faces', STAMP('  drawFace(100, 200);\n  drawFace(150, 200);\n  drawFace(300, 200);\n'), 'overlap'],
  ['no mouth', STAMP('  drawFace(80, 200);\n  drawFace(200, 200);\n  drawFace(320, 200);\n'), 'Add a mouth inside `drawFace`'],
  ['one color', STAMP('  drawFace(80, 200);\n  drawFace(200, 200);\n  drawFace(320, 200);\n', '  line(x - 20, y + 25, x + 20, y + 25);\n'), 'All the faces are the same color.'],
  ['two the same', STAMP('  drawFace(80, 200, "red");\n  drawFace(200, 200, "red");\n  drawFace(320, 200, "blue");\n', '  line(x - 20, y + 25, x + 20, y + 25);\n', 'x, y, skin', 'skin'), 'Two of the faces are the same color.'],
]);
