import { describe, expect, test } from 'vitest';
import { jsModel, type JsState } from '../../demos/js';
import type { JsSpec } from '../../demos/types';
import { p5GameLab } from './index';
import { KEYS_DONE, TARGET_DONE, TIMER_DONE, WALLS_DONE, WIN_DONE } from './solution';

const spec = (step: string): JsSpec => p5GameLab.steps.find((s) => s.id === step)!.demos!.find((d) => d.kind === 'js') as JsSpec;

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

describe('every starter runs with no notes', () => {
  for (const step of p5GameLab.steps) {
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

const ARROW = (key: string, change: string) => `  if (keyIsDown(${key})) {\n    ${change};\n  }\n`;
const keys = (...ifs: string[]) => KEYS_DONE.replace(/  if \(keyIsDown[\s\S]*?\n\n  \/\/ The player/, `${ifs.join('')}\n  // The player`);

right('keys', [
  ['the answer key', KEYS_DONE],
  ['keyCode numbers and += ', keys(ARROW('39', 'x += 5'), ARROW('37', 'x -= 5'), ARROW('38', 'y -= 5'), ARROW('40', 'y += 5'))],
]);

wrong('keys', [
  ['only right', keys(ARROW('RIGHT_ARROW', 'x = x + 4')), "Holding the left arrow doesn't move the player."],
  ['up goes down', keys(ARROW('RIGHT_ARROW', 'x = x + 4'), ARROW('LEFT_ARROW', 'x = x - 4'), ARROW('UP_ARROW', 'y = y + 4'), ARROW('DOWN_ARROW', 'y = y + 4')), 'Holding the up arrow moves the player the wrong way. y counts down from the top'],
  ['up moves x', keys(ARROW('RIGHT_ARROW', 'x = x + 4'), ARROW('LEFT_ARROW', 'x = x - 4'), ARROW('UP_ARROW', 'x = x - 4'), ARROW('DOWN_ARROW', 'y = y + 4')), 'Holding the up arrow moves the player sideways.'],
  ['a misspelled key name', keys(ARROW('RIGHT_ARROW', 'x = x + 4'), ARROW('LEFT_ARROW', 'x = x - 4'), ARROW('UP_ARROW', 'y = y - 4'), ARROW('DOWN', 'y = y + 4')), 'p5.js has nothing called DOWN. For the down arrow key, use DOWN_ARROW, as in keyIsDown(DOWN_ARROW).'],
  ['key === "down"', keys(ARROW('RIGHT_ARROW', 'x = x + 4'), ARROW('LEFT_ARROW', 'x = x - 4'), ARROW('UP_ARROW', 'y = y - 4'), '  if (keyIsPressed && key === "down") {\n    y = y + 4;\n  }\n'), 'When that key is pressed, key is "ArrowDown", not "down".'],
]);

const walls = (...ifs: string[]) => WALLS_DONE.replace(/  \/\/ Stay on the canvas\.[\s\S]*?\n\n  \/\/ The player/, `  // Stay on the canvas.\n${ifs.join('')}\n  // The player`);
const W = (test: string, set: string) => `  if (${test}) {\n    ${set};\n  }\n`;

right('walls', [
  ['the answer key', WALLS_DONE],
  ['at the middle, with 0 and width', walls(W('x > width', 'x = width'), W('x < 0', 'x = 0'), W('y > height', 'y = height'), W('y < 0', 'y = 0'))],
  ['constrain()', walls('  x = constrain(x, 20, width - 20);\n  y = constrain(y, 20, height - 20);\n')],
]);

wrong('walls', [
  ['no walls', walls(), 'Holding the right arrow takes the player past the right edge'],
  ['only left and right', walls(W('x > width', 'x = width'), W('x < 0', 'x = 0')), 'Holding the up arrow takes the player past the top edge, to y = '],
  ['wrapping around', walls(W('x > width', 'x = 0'), W('x < 0', 'x = width'), W('y > height', 'y = height'), W('y < 0', 'y = 0')), 'jumps to the other side'],
  ['stops too soon', walls(W('x > 300', 'x = 300'), W('x < 0', 'x = 0'), W('y > height', 'y = height'), W('y < 0', 'y = 0')), 'the player stops at x = 300, before it reaches the right edge'],
]);

const catchIf = (body: string, test = 'dist(x, y, tx, ty) < 35') => TARGET_DONE.replace(/  \/\/ A catch\n[\s\S]*?\n  }\n/, `  // A catch\n  if (${test}) {\n${body}  }\n`);

right('target', [
  ['the answer key', TARGET_DONE],
  ['score++ and width', catchIf('    score++;\n    tx = random(20, width - 20);\n    ty = random(20, height - 20);\n', 'dist(x, y, tx, ty) <= 35')],
]);

wrong('target', [
  ['no catch', TARGET_DONE.replace(/  \/\/ A catch\n[\s\S]*?\n  }\n/, ''), 'The player is on the target, and `score` stays 0.'],
  ['the target stays', catchIf('    score = score + 1;\n'), 'After a catch, the target stays where it is'],
  ['only tx moves', catchIf('    score = score + 1;\n    tx = random(30, 370);\n'), 'After a catch, the target only moves left or right.'],
  ['off the canvas', catchIf('    score = score + 1;\n    tx = random(400, 800);\n    ty = random(30, 370);\n'), 'off the canvas'],
  ['too far counts', catchIf('    score = score + 1;\n    tx = random(30, 370);\n    ty = random(30, 370);\n', 'dist(x, y, tx, ty) < 60'), 'The score goes up when the circles are 45 apart'],
  ['> instead of <', catchIf('    score = score + 1;\n    tx = random(30, 370);\n    ty = random(30, 370);\n', 'dist(x, y, tx, ty) > 35'), 'The player is on the target, and `score` stays 0.'],
  ['moves every frame', TARGET_DONE.replace('    tx = random(30, 370);\n    ty = random(30, 370);\n  }\n', '  }\n  tx = random(30, 370);\n  ty = random(30, 370);\n'), 'The target moves in every frame'],
  ['no score text', TARGET_DONE.replace('  text("Score: " + score, 20, 35);\n', ''), 'Show the score with `text()`'],
  ['score in quotes', TARGET_DONE.replace('"Score: " + score', '"Score: score"'), 'Your text says "Score: score", and it doesn\'t show the score.'],
]);

right('win', [
  ['the answer key', WIN_DONE],
  ['=== 5 and noLoop first', WIN_DONE.replace('if (score >= 5) {\n    textSize(48);\n    text("You win!", 100, 210);\n    noLoop();', 'if (score === 5) {\n    noLoop();\n    text("Winner", 150, 200);')],
]);

wrong('win', [
  ['no win', TARGET_DONE, 'The score reached 5, and the game kept going.'],
  ['stops at once', WIN_DONE.replace('if (score >= 5) {', 'if (score >= 0) {'), 'The game stops before the score reaches 5.'],
  ['no message', WIN_DONE.replace('    text("You win!", 100, 210);\n', ''), 'the game stops with no message'],
  ['noLoop() misspelled', WIN_DONE.replace('noLoop()', 'noloop()'), 'when the check played it, line 39 stopped with an error: noloop is not defined. p5.js has nothing called noloop. Did you mean noLoop?'],
]);

right('timer', [['the answer key', TIMER_DONE]]);

wrong('timer', [
  ['no countdown', TIMER_DONE.replace('    timeLeft = timeLeft - 1;\n', ''), 'timeLeft stays the same.'],
  ['every frame', TIMER_DONE.replace('  if (frameCount % 60 === 0) {\n    timeLeft = timeLeft - 1;\n  }\n', '  timeLeft = timeLeft - 1;\n'), 'timeLeft goes down in every frame'],
  ['not shown', TIMER_DONE.replace('  text("Time: " + timeLeft, 270, 35);\n', ''), 'Show `timeLeft` with `text()`'],
  ['no stop', TIMER_DONE.replace('    noLoop();\n  }\n`', '').replace(/  if \(timeLeft <= 0\) \{[\s\S]*?noLoop\(\);\n  }\n/, ''), 'Time runs out, and the game keeps going.'],
]);
