import { describe, expect, test } from 'vitest';
import { jsModel, type JsState } from '../../demos/js';
import type { JsSpec } from '../../demos/types';
import { p5MoveLab } from './index';
import { BOUNCE_DONE, CORNERS_DONE, FOLLOW_DONE, PRESS_DONE, SLIDE_DONE, WRAP_DONE } from './solution';

const spec = (step: string): JsSpec => p5MoveLab.steps.find((s) => s.id === step)!.demos!.find((d) => d.kind === 'js') as JsSpec;

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

/** A sketch with these top-level lines and this draw() body. */
const sk = (top: string, draw: string, setupMore = '') => `${top}${top ? '\n' : ''}function setup() {\n  createCanvas(400, 400);\n${setupMore}}\n\nfunction draw() {\n${draw
  .split('\n')
  .map((l) => (l ? `  ${l}` : l))
  .join('\n')}\n}\n`;

describe('every starter runs with no notes', () => {
  for (const step of p5MoveLab.steps) {
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

right('follow', [
  ['the answer key', FOLLOW_DONE],
  ['an ellipse and a color', sk('', 'background(20, 20, 60);\nfill("gold");\nellipse(mouseX, mouseY, 60, 30);')],
]);

wrong('follow', [
  ['the trail left in', sk('', 'circle(mouseX, mouseY, 40);', '  background("black");\n'), 'The circle leaves a trail.'],
  ['background after the circle', sk('', 'circle(mouseX, mouseY, 40);\nbackground("black");'), 'paints over the circle every frame'],
  ['x and y swapped', sk('', 'background("black");\ncircle(mouseY, mouseX, 40);'), 'x and y swapped'],
  ['only mouseX', sk('', 'background("black");\ncircle(mouseX, 200, 40);'), 'but not up and down'],
  ['a fixed circle', sk('', 'background("black");\ncircle(200, 200, 40);'), 'stays at (200, 200) when the mouse moves'],
  ['in setup', 'function setup() {\n  createCanvas(400, 400);\n  background("black");\n  circle(mouseX, mouseY, 40);\n}\n\nfunction draw() {\n}\n', 'drawn in setup(), which runs once'],
  ['mouseX() called', sk('', 'background("black");\ncircle(mouseX(), mouseY, 40);'), 'mouseX is a variable that p5.js keeps up to date, not a function'],
  ['mousex in lower case', sk('', 'background("black");\ncircle(mousex, mouseY, 40);'), 'Did you mean mouseX?'],
]);

right('slide', [
  ['the answer key', SLIDE_DONE],
  ['x += 1 and y++', sk('let x = 0;\nlet y = 0;', 'background("black");\ncircle(x, 200, 50);\ncircle(200, y, 50);\nx += 1;\ny++;')],
]);

wrong('slide', [
  ['nothing changes x', sk('let x = 0;', 'background("black");\ncircle(x, 200, 50);'), 'The circle stays in place.'],
  ['let x inside draw', sk('', 'let x = 0;\nbackground("black");\ncircle(x, 200, 50);\nx = x + 3;'), 'starts over every frame'],
  ['x + 3 with no =', sk('let x = 0;', 'background("black");\ncircle(x, 200, 50);\nx + 3;'), 'The circle stays in place.'],
  ['moving left', sk('let x = 400;', 'background("black");\ncircle(x, 200, 50);\nx = x - 3;'), 'slides to the left'],
  ['no second circle', sk('let x = 0;', 'background("black");\ncircle(x, 200, 50);\nx = x + 3;'), 'Now make a second circle that slides down.'],
  ['second circle still', sk('let x = 0;\nlet y = 0;', 'background("black");\ncircle(x, 200, 50);\nx = x + 3;\ncircle(200, y, 50);'), 'Your second circle stays in place.'],
]);

right('wrap', [
  ['the answer key', WRAP_DONE],
  ['slides in from off the canvas', sk('let x = 0;', 'background("black");\ncircle(x, 200, 50);\nx = x + 3;\nif (x > width + 25) {\n  x = -25;\n}')],
  ['400 and >=', sk('let x = 0;', 'background("black");\nif (x >= 400) {\n  x = 0;\n}\ncircle(x, 200, 50);\nx = x + 5;')],
]);

wrong('wrap', [
  ['no if', WRAP_DONE.replace('  if (x > width) {\n    x = 0;\n  }\n', ''), 'goes off the right edge and never comes back'],
  ['wraps at the middle', WRAP_DONE.replace('x > width', 'x > 200'), 'before it reaches the right edge at 400'],
  ['stops at the edge', WRAP_DONE.replace('    x = 0;', '    x = width;'), 'The circle stops at x = 400.'],
  ['=== instead of =', WRAP_DONE.replace('    x = 0;', '    x === 0;'), 'goes off the right edge and never comes back'],
  ['goes back to the middle', WRAP_DONE.replace('    x = 0;', '    x = 200;'), 'goes back to x = 200, not to the left edge'],
]);

right('bounce', [
  ['the answer key', BOUNCE_DONE],
  ['speed = -speed in one if', sk('let x = 200;\nlet speed = 4;', 'background("black");\ncircle(x, 200, 50);\nx = x + speed;\nif (x > width - 25 || x < 25) {\n  speed = -speed;\n}')],
]);

wrong('bounce', [
  ['no ifs', code('', ''), 'goes off the right edge and keeps going'],
  ['only the right wall', code('if (x > width) {\n  speed = -3;\n}', ''), 'then goes off the left edge'],
  ['at the middles', code('if (x > width) {\n  speed = -3;\n}', 'if (x < 0) {\n  speed = 3;\n}'), 'half of it goes past the right wall'],
  ['turns too soon', code('if (x > 300) {\n  speed = -3;\n}', 'if (x < 25) {\n  speed = 3;\n}'), 'turns around at x = 30'],
]);

function code(a: string, b: string): string {
  return sk('let x = 200;\nlet speed = 3;', `background("black");\ncircle(x, 200, 50);\nx = x + speed;\n${a}\n${b}`);
}

right('press', [
  ['the answer key', PRESS_DONE],
  ['a bigger circle', BOUNCE_DONE.replace('  circle(x, 200, 50);', '  if (mouseIsPressed) {\n    fill("red");\n    circle(x, 200, 80);\n  } else {\n    fill("white");\n    circle(x, 200, 50);\n  }')],
]);

wrong('press', [
  ['no if', BOUNCE_DONE, 'The circle is the same color with the button up and down.'],
  ['no else', BOUNCE_DONE.replace('  circle(x, 200, 50);', '  if (mouseIsPressed) {\n    fill("red");\n  }\n  circle(x, 200, 50);'), 'keeps its new color after the button comes up'],
  ['only the fill', BOUNCE_DONE.replace('  circle(x, 200, 50);', '  if (mouseIsPressed) {\n    fill("red");\n  } else {\n    fill("white");\n  }\n  circle(x, 200, 50);'), 'Only the fill changes so far.'],
  ['mousePressed as a test', BOUNCE_DONE.replace('  circle(x, 200, 50);', '  if (mousePressed) {\n    fill("red");\n  }\n  circle(x, 200, 50);'), 'mousePressed'],
  ['mouseIsPressed()', BOUNCE_DONE.replace('  circle(x, 200, 50);', '  if (mouseIsPressed()) {\n    fill("red");\n  }\n  circle(x, 200, 50);'), 'mouseIsPressed is a variable that p5.js keeps up to date, not a function'],
]);

right('corners', [['the answer key', CORNERS_DONE]]);

const CORNERS = (more: string) => CORNERS_DONE.split('  if (y > height - 25)')[0].replace('  y = y + ySpeed;\n', '') + more + '}\n';
wrong('corners', [
  ['no y motion', CORNERS(''), 'The ball moves only left and right.'],
  ['off the bottom', CORNERS('  y = y + ySpeed;\n'), 'goes past the bottom wall'],
  ['a new color every frame', CORNERS('  y = y + ySpeed;\n  fill(random(255), random(255), random(255));\n  if (y > height - 25) {\n    ySpeed = -2;\n  }\n  if (y < 25) {\n    ySpeed = 2;\n  }\n').replace(/\n    fill\(random\(255\), random\(255\), random\(255\)\);/g, ''), 'changes color almost every frame'],
]);
