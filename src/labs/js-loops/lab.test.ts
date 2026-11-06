import { describe, expect, test } from 'vitest';
import { findCurriculum } from '../../curricula';
import { jsModel, type JsState } from '../../demos/js';
import type { JsCheck, JsSpec } from '../../demos/types';
import { LabSession } from '../../runtime/session';
import { buildReport } from '../../store/report';
import { findLab } from '../index';
import { playStep } from '../solution';
import { jsLoopsLab, WATCH_STEPS } from './index';
import { COUNTDOWN, DOOR, DOUBLE, FINALS, GUESS, GUESS_STRINGS, jsLoopsSolution, PRIZES, REPORT, SCORES, TABLE } from './solution';

const editors = jsLoopsLab.steps.flatMap((s) => (s.demos ?? []).filter((d): d is JsSpec => d.kind === 'js'));
const editor = (id: string) => editors.find((d) => d.id === id)!;

/** Writes the code and presses Run, gives these answers, then presses Stop if a prompt is still up. */
function attempt(s: JsSpec, code: string, answers: (string | null)[] = []): JsState {
  let state = jsModel.apply(s, jsModel.init(s), { edit: 'script.js', code });
  state = jsModel.apply(s, state, { run: true });
  for (const answer of answers) state = jsModel.apply(s, state, { answer });
  return jsModel.apply(s, state, { stop: true });
}

const noteFor = (s: JsSpec, code: string, answers: (string | null)[] = []) => attempt(s, code, answers).checks?.find((c) => !c.ok)?.note;

const swap = (code: string, ...pairs: [string, string][]) =>
  pairs.reduce((out, [from, to]) => {
    if (!out.includes(from)) throw new Error(`The answer key has no "${from}"`);
    return out.replace(from, to);
  }, code);

function expectCorrect(s: JsSpec, code: string, answers: (string | null)[] = []) {
  const state = attempt(s, code, answers);
  expect(state.last?.status === 'ok' || answers.length === 0, 'the run finished').toBe(true);
  expect(state.checks?.filter((c) => !c.ok).map((c) => `${c.id}: ${c.note}`)).toEqual([]);
  expect(state.notes?.map((n) => n.text) ?? []).toEqual([]);
}

/** One table per step: what the student wrote, and the note they should get, word for word. */
function wrong(id: string, cases: [string, string, string][]) {
  test.each(cases)(`${id}: %s`, (_, code, note) => {
    expect(noteFor(editor(id), code)).toBe(note);
  });
}

function right(id: string, cases: [string, string][]) {
  test.each(cases)(`${id}: %s`, (_, code) => expectCorrect(editor(id), code));
}

describe('the lab', () => {
  test('is a lesson with no network in the Intro CS course', () => {
    expect(jsLoopsLab.build).toBeUndefined();
    expect(jsLoopsLab).toMatchObject({ id: 'js-loops', unit: 0, codehs: [], ced: [] });
    expect(findLab('js-loops')).toBe(jsLoopsLab);
    expect(findCurriculum('intro')?.labs).toContain('js-loops');
  });

  test('has 10 steps through submit, then one optional challenge with no points', () => {
    const ids = jsLoopsLab.steps.map((s) => s.id);
    expect(ids.indexOf('submit')).toBe(9);
    expect(jsLoopsLab.steps[8].id).toBe('reflect');
    const extra = jsLoopsLab.steps.slice(10);
    expect(extra.map((s) => s.title)).toEqual(['Optional extra challenge: the token table']);
    expect(extra.every((s) => s.extra)).toBe(true);
  });

  test('asks at most one question in a step', () => {
    for (const s of jsLoopsLab.steps) expect(s.questions?.length ?? 0).toBeLessThanOrEqual(1);
  });

  test('gives every check a hint ladder that ends in code', () => {
    const checks = editors.flatMap((d) => d.checks as JsCheck[]);
    expect(checks.length).toBeGreaterThan(15);
    for (const c of checks) {
      expect(c.hints?.length ?? 0, c.id).toBeGreaterThanOrEqual(2);
      expect(c.hints![c.hints!.length - 1], c.id).toMatch(/`[^`]+`/);
    }
  });

  test('puts the real work in the report', () => {
    const now = Date.now();
    const s = new LabSession(jsLoopsLab, { labId: jsLoopsLab.id, labVersion: jsLoopsLab.version, studentId: 's', startedAt: now, updatedAt: now, activeMs: 0, step: 0, maxStep: 0, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] });
    for (const step of jsLoopsLab.steps) {
      playStep(s, jsLoopsSolution[step.id]);
      s.goTo(s.progress.step + 1);
    }
    const report = buildReport(jsLoopsLab, s.progress, { id: 's', name: 'Sam', period: '1', createdAt: 0 }, 'submitted');
    expect(report.code?.map((c) => c.step)).toEqual(['guess', 'double', 'scores', 'report', 'finals', 'table']);
    expect(report.code?.[0].files[0].text).toBe(GUESS);
  });
});

describe('starting code', () => {
  test.each(['countdown', 'prizes', 'door', 'guess', 'double', 'scores', 'finals', 'table'])('%s draws no note', (id) => {
    const s = editor(id);
    let state = jsModel.apply(s, jsModel.init(s), { run: true });
    for (const answer of ['pixel']) state = jsModel.apply(s, state, { answer });
    expect(state.last?.status).toBe('ok');
    expect(state.notes).toBeUndefined();
  });

  test('the report is broken on purpose, and leaves the student to find each bug', () => {
    const s = editor('report');
    const state = jsModel.apply(s, jsModel.init(s), { run: true });
    expect(state.last?.limit).toMatchObject({ why: 'loop', line: 18, text: 'The loop on line 18 ran 100,000 times without stopping. Its condition is lights > 0, and lights stayed 100 the whole time.' });
    expect(state.notes).toBeUndefined();
    expect(state.last?.lines.map((l) => l.text)).toEqual(['Total: 20', 'Booth 1: 40', 'Booth 2: 15', 'Booth 3: 25', 'Booth 4: 20', 'Booth 5: undefined']);
  });

  test('the report has total start over in the steps the student is sent to watch', () => {
    const s = editor('report');
    let state = jsModel.apply(s, jsModel.init(s), { stepping: true });
    for (let seek = 1; seek <= WATCH_STEPS; seek++) state = jsModel.apply(s, state, { seek });
    expect(jsModel.facts(s, state).far).toBe(WATCH_STEPS);
  });

  test('the report sends the student to the move its goal waits for', () => {
    const step = jsLoopsLab.steps.find((x) => x.id === 'report')!;
    expect(step.body).toContain(`Move ${WATCH_STEPS + 1}`);
  });

  test('a loop that never ran says so, and no longer asks for a print that is already there', () => {
    expect(noteFor(editor('countdown'), swap(COUNTDOWN, ['count >= 0', 'count <= 3']))).toBe('Your loop never ran, because its condition was false the first time. A loop runs while its condition is true, so change the condition.');
    expect(noteFor(editor('prizes'), swap(PRIZES, ['price <= maxPrice', 'price >= maxPrice']))).toBe('Your loop never ran, because its condition was false the first time. A loop runs while its condition is true, so change the condition.');
  });
});

describe('answer key', () => {
  test.each([
    ['countdown', COUNTDOWN, []],
    ['prizes', PRIZES, []],
    ['door', DOOR, ['open', 'pixel']],
    ['double', DOUBLE, []],
    ['scores', SCORES, []],
    ['report', REPORT, []],
    ['finals', FINALS, []],
    ['table', TABLE, []],
  ] as [string, string, string[]][])('%s passes with no notes', (id, code, answers) => expectCorrect(editor(id), code, answers));

  test('the guessing game plays through', () => {
    const s = editor('guess');
    let state = { ...jsModel.init(s), runs: 1 };
    state = jsModel.apply(s, state, { edit: 'script.js', code: GUESS });
    state = jsModel.apply(s, state, { run: true });
    for (const answer of ['5', '9', '8']) state = jsModel.apply(s, state, { answer });
    expect(state.last?.lines.filter((l) => l.kind === 'log').map((l) => l.text)).toEqual(['Too low', 'Too high', 'You got it in 3 guesses']);
    expect(state.checks?.every((c) => c.ok)).toBe(true);
    expect(state.notes).toBeUndefined();
  });
});

describe('a loop that never gets an acceptable answer', () => {
  test('tells the student why, under the prompt, after one answer', () => {
    const s = editor('guess');
    let state = jsModel.apply(s, jsModel.apply(s, jsModel.init(s), { edit: 'script.js', code: GUESS_STRINGS }), { run: true });
    expect(state.notes).toBeUndefined();
    state = jsModel.apply(s, state, { answer: '5' });
    expect(state.waiting?.message).toBe('Guess again');
    expect(state.notes?.[0].text).toBe('prompt() always gives back a string, and a string is never === to a number, so guess !== secret is always true. Fix it on each line with a prompt(), like this: let age = Number(prompt("How old are you?"));');
  });

  test('Stop ends the run, and the step says what to change', () => {
    const state = attempt(editor('guess'), GUESS_STRINGS, ['5']);
    expect(state.waiting).toBeUndefined();
    expect(state.checks?.[0].note).toBe('`prompt()` gives back a string, and a string is never `===` to a number, so the right guess never matches `secret`. Write `guess = Number(prompt("Your guess"));`');
  });
});

describe('step 1: the countdown', () => {
  const up = '`count` keeps going up, so the condition stays true and the loop never ends. Write `count = count - 1;` to make it go down.';
  const still = '`count` never changes, so the loop never ends. Writing `count - 1` calculates an answer and throws it away. Write `count = count - 1;` inside the loop.';
  wrong('countdown', [
    ['the starting code', 'let count = 1;\nwhile (count <= 3) {\n  console.log(count);\n  count = count + 1;\n}\n', 'These numbers go up. Start `count` at 10, and make it go down by 1 on each pass.'],
    ['updating in the wrong direction', swap(COUNTDOWN, ['count - 1', 'count + 1']), up],
    ['i > 0 where i >= 0 was needed', swap(COUNTDOWN, ['count >= 0', 'count > 0']), 'Your countdown stops at 1, so 0 never prints. `count > 0` ends the loop one pass too soon.'],
    ['i - 1 with no assignment', swap(COUNTDOWN, ['count = count - 1;', 'count - 1;']), still],
    ['a missing update', swap(COUNTDOWN, ['  count = count - 1;\n', '']), still],
    ['a semicolon after the header', swap(COUNTDOWN, ['while (count >= 0) {', 'while (count >= 0); {']), 'There is a semicolon right after a `for`, `while`, or `if` header, so that header has nothing to run. Delete the semicolon.'],
    ['= in the condition', swap(COUNTDOWN, ['count >= 0', 'count = 0']), 'A single `=` in a condition gives the variable a new value and compares nothing. Use `===` or `!==`.'],
    ['the wrong start', swap(COUNTDOWN, ['let count = 10', 'let count = 9']), 'Your countdown starts at 9. Start `count` at 10.'],
    ['typing each number', [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((n) => `console.log(${n});`).join('\n'), 'Print the numbers from a loop, with no separate line of code for each number.'],
    ['Doors open! inside the loop', swap(COUNTDOWN, ['  count = count - 1;\n}\nconsole.log("Doors open!");', '  count = count - 1;\n  console.log("Doors open!");\n}']), '`Doors open!` printed 11 times, because that line is inside the loop. Move it below the closing `}`.'],
    ['Doors open! before the loop', 'console.log("Doors open!");\n' + swap(COUNTDOWN, ['console.log("Doors open!");\n', '']), '`Doors open!` printed before the countdown finished. Move that line below the closing `}` of the loop.'],
    ['no Doors open!', swap(COUNTDOWN, ['console.log("Doors open!");\n', '']), 'Add `console.log("Doors open!");` below the closing `}` of the loop.'],
  ]);
  right('countdown', [
    ['for with i--', 'for (let i = 10; i >= 0; i--) {\n  console.log(i);\n}\nconsole.log("Doors open!");\n'],
    ['count--', swap(COUNTDOWN, ['count = count - 1', 'count--'])],
    ['count -= 1', swap(COUNTDOWN, ['count = count - 1', 'count -= 1'])],
    ['single quotes', swap(COUNTDOWN, ['"Doors open!"', "'Doors open!'"])],
    ['a template literal', swap(COUNTDOWN, ['console.log(count)', 'console.log(`${count}`)'], ['"Doors open!"', '`Doors open!`'])],
    ['var and a condition the other way around', swap(COUNTDOWN, ['let count', 'var count'], ['count >= 0', '0 <= count'])],
    ['a condition of count > -1', swap(COUNTDOWN, ['count >= 0', 'count > -1'])],
  ]);
});

describe('step 2: the prize wall', () => {
  wrong('prizes', [
    ['the starting code', 'let maxPrice = 300;\n\nfor (let price = 50; price <= maxPrice; price = price + 1) {\n  console.log(price);\n}\n', 'Your prices go up by 1. Change the last part of the `for` header so that `price` goes up by 50.'],
    ['price + 50 with no assignment', swap(PRIZES, ['price = price + 50', 'price + 50']), '`price` never changes, so the loop never ends. Writing `price + 50` calculates an answer and throws it away. Write `price = price + 50` in the header.'],
    ['< where <= was needed', swap(PRIZES, ['price <= maxPrice', 'price < maxPrice']), 'Your list stops one price short of `maxPrice`. `price < maxPrice` ends the loop too soon. Use `price <= maxPrice`.'],
    ['a fixed number in the condition', swap(PRIZES, ['price <= maxPrice', 'price <= 300']), 'The check tried `maxPrice` set to 200, and your list went past 200. Use `maxPrice` in the condition, with no fixed number.'],
    ['a renamed maxPrice', PRIZES.replaceAll('maxPrice', 'limit'), 'Keep the variable named `maxPrice`. Your code has to read it, so that it works on any value.'],
    ['a semicolon after the header', swap(PRIZES, ['price + 50) {', 'price + 50); {']), 'There is a semicolon right after a `for`, `while`, or `if` header, so that header has nothing to run. Delete the semicolon.'],
    ['the wrong start', swap(PRIZES, ['let price = 50', 'let price = 0']), 'The first price should be 50, and yours is 0. Start `price` at 50.'],
    ['the total reset inside the loop', swap(PRIZES, ['  total = total + price;', '  total = 0;\n  total = total + price;']), 'Your total is only the last price, so it starts over on every pass. Move `total = 0` above the loop, so that it runs one time.'],
    ['let total inside the loop', swap(PRIZES, ['let total = 0;\n', ''], ['  total = total + price;', '  let total = 0;\n  total = total + price;']), '`let total` is inside the loop, so `total` disappears at the closing `}`. Move `let total = 0;` above the loop.'],
    ['a second let total inside the loop', swap(PRIZES, ['  total = total + price;', '  let total = 0;\n  total = total + price;']), 'Your total stays at 0, because `let total` inside the loop makes a second variable. Leave out the word `let` inside the loop.'],
    ['total + price with no assignment', swap(PRIZES, ['total = total + price;', 'total + price;']), 'Your total stays at 0, so the prices never get added. Write `total = total + price;` inside the loop.'],
    ['printing the total inside the loop', swap(PRIZES, ['  total = total + price;\n}\n\nconsole.log(total);', '  total = total + price;\n  console.log(total);\n}']), 'Your total prints on every pass, because that `console.log` is inside the loop. Move it below the closing `}`, so that only the final total prints.'],
    ['no total', swap(PRIZES, ['console.log(total);\n', '']), 'Add up the prices in a variable named `total`, then print `total` after the loop.'],
    ['typing the total', swap(PRIZES, ['console.log(total);', 'console.log(1050);']), 'With `maxPrice` set to 200, one of each prize costs 500 tokens, and your code printed 1050. Add `price` to `total` inside the loop.'],
  ]);
  right('prizes', [
    ['while', 'let maxPrice = 300;\nlet total = 0;\nlet price = 50;\nwhile (price <= maxPrice) {\n  console.log(price);\n  total = total + price;\n  price = price + 50;\n}\nconsole.log(total);\n'],
    ['price += 50', swap(PRIZES, ['price = price + 50', 'price += 50'])],
    ['total += price', swap(PRIZES, ['total = total + price', 'total += price'])],
    ['const maxPrice', swap(PRIZES, ['let maxPrice', 'const maxPrice'])],
    ['another name for the total', PRIZES.replaceAll('total', 'cost')],
    ['a label with +', swap(PRIZES, ['console.log(total)', 'console.log("One of each costs " + total)'])],
    ['a label with a template literal', swap(PRIZES, ['console.log(total)', 'console.log(`Total: ${total} tokens`)'])],
    ['single quotes in a label', swap(PRIZES, ['console.log(total)', "console.log('Total: ' + total)"])],
  ]);

  test('commas in the header get the editor\'s own help', () => {
    const state = attempt(editor('prizes'), swap(PRIZES, ['let price = 50; price <= maxPrice; price = price + 50', 'let price = 50, price <= maxPrice, price = price + 50']));
    expect(state.last?.error?.type).toBe('SyntaxError');
    expect(state.last?.error?.help).toBe('A for loop header uses semicolons between its three parts, not commas. Write it like this: for (let i = 0; i < 5; i++)');
  });
});

describe('step 3: the door code', () => {
  const lost = 'The answer from the `prompt()` inside the loop is never saved, so `code` keeps the first wrong answer. Write `code = prompt("Try again");`';
  wrong('door', [
    ['the starting if', swap(DOOR, ['while (code', 'if (code']), 'The door opened after two wrong answers, because an `if` asks only one more time. Use a loop that keeps asking.'],
    ['a loop that never asks again', swap(DOOR, ['  code = prompt("That is not the code. Try again.");\n', '  console.log("Try again");\n']), 'The loop never asks again, so `code` stays wrong and the loop cannot end. Put `code = prompt("Try again");` inside the loop.'],
    ['an answer that is not saved', swap(DOOR, ['  code = prompt(', '  prompt(']), lost],
    ['let code inside the loop', swap(DOOR, ['  code = prompt(', '  let code = prompt(']), '`let code` inside the loop makes a second variable, so the condition never sees the new answer. Leave out the word `let` inside the loop.'],
    ['= in the condition', swap(DOOR, ['code !== "pixel"', 'code = "pixel"']), 'A single `=` in a condition gives the variable a new value and compares nothing. Use `===` or `!==`.'],
    ['the condition the wrong way around', swap(DOOR, ['code !== "pixel"', 'code === "pixel"']), 'The door opened on a wrong answer. The condition has to be true while the code is wrong, so use `code !== "pixel"`.'],
    ['a semicolon after the header', swap(DOOR, ['"pixel") {', '"pixel"); {']), 'There is a semicolon right after a `for`, `while`, or `if` header, so that header has nothing to run. Delete the semicolon.'],
    ['the welcome inside the loop', swap(DOOR, ['  code = prompt("That is not the code. Try again.");\n}\n\nconsole.log("Welcome to Arcade Night!");', '  code = prompt("That is not the code. Try again.");\n  console.log("Welcome to Arcade Night!");\n}']), 'The welcome printed 2 times, because that line is inside the loop. Move it below the closing `}`.'],
    ['no welcome', swap(DOOR, ['console.log("Welcome to Arcade Night!");\n', '']), 'Keep the line that prints `Welcome to Arcade Night!` below the loop.'],
    ['no prompt', 'console.log("Welcome to Arcade Night!");\n', 'Ask for the code with `prompt()`.'],
  ]);

  const ok = (code: string) => expectCorrect(editor('door'), code, ['open', 'please', 'pixel']);
  test('the answer key style, with two wrong answers', () => ok(DOOR));
  test('do...while', () => ok('let code;\ndo {\n  code = prompt("Code?");\n} while (code !== "pixel");\nconsole.log("Welcome to Arcade Night!");\n'));
  test('an empty start', () => ok('let code = "";\nwhile (code !== "pixel") {\n  code = prompt("Code?");\n}\nconsole.log("Welcome to Arcade Night!");\n'));
  test('!= and single quotes', () => ok("let code = prompt('Code?');\nwhile (code != 'pixel') {\n  code = prompt('Again');\n}\nconsole.log('Welcome to Arcade Night!');\n"));
  test('for with no counter', () => ok('let code = prompt("Code?");\nfor (; code !== "pixel"; ) {\n  code = prompt("Again");\n}\nconsole.log(`Welcome to Arcade Night!`);\n'));
  test('a flag', () => ok('let inside = false;\nwhile (!inside) {\n  let code = prompt("Code?");\n  if (code === "pixel") {\n    inside = true;\n  }\n}\nconsole.log("Welcome to Arcade Night!");\n'));
});

describe('step 4: the guessing game', () => {
  const never = 'The loop never asks again, so the guess stays the same and the loop cannot end. Put a `prompt()` inside the loop, and save its answer.';
  wrong('guess', [
    ['the starting code', '// nothing yet\nlet secret = Math.floor(Math.random() * 10) + 1;\n', 'Ask for a guess with `prompt()`.'],
    ['a loop that never asks again', swap(GUESS, ['  guess = Number(prompt("Guess again"));\n', '']), never],
    ['a prompt() string compared with ===', GUESS_STRINGS, '`prompt()` gives back a string, and a string is never `===` to a number, so the right guess never matches `secret`. Write `guess = Number(prompt("Your guess"));`'],
    ['a new secret inside the loop', swap(GUESS, ['  guesses = guesses + 1;\n', '  guesses = guesses + 1;\n  secret = Math.floor(Math.random() * 10) + 1;\n']), '`secret` gets a new random number inside the loop, so the target keeps moving. Pick `secret` one time, above the loop.'],
    ['let guess inside the loop', swap(GUESS, ['  guess = Number(prompt("Guess again"));', '  let guess = Number(prompt("Guess again"));']), '`let guess` inside the loop makes a second variable, so the condition never sees the new guess. Leave out the word `let` inside the loop.'],
    ['an if in place of the loop', swap(GUESS, ['while (guess !== secret)', 'if (guess !== secret)']), 'The game ended before the player guessed `secret`. An `if` asks one time, so use a `while` loop that runs until the guess matches.'],
    ['a renamed secret', GUESS.replaceAll('secret', 'answer'), 'Keep the variable named `secret`. Your code has to read it, so that it works on any value.'],
    ['no hints', swap(GUESS, ['  if (guess > secret) {\n    console.log("Too high");\n  } else {\n    console.log("Too low");\n  }\n', '']), 'After each wrong guess, print `Too high` or `Too low`.'],
    ['swapped hints', swap(GUESS, ['guess > secret', 'guess < secret']), 'The messages are swapped: a guess above `secret` printed `Too low`. Switch the two messages, or change `>` to `<`.'],
    ['a hint on the right guess', swap(GUESS, ['  if (guess > secret) {\n    console.log("Too high");\n  } else {\n    console.log("Too low");\n  }\n  guess = Number(prompt("Guess again"));\n', '  guess = Number(prompt("Guess again"));\n  if (guess > secret) {\n    console.log("Too high");\n  } else {\n    console.log("Too low");\n  }\n'], ['let guess = Number(prompt("Guess a number from 1 to 10"));', 'let guess = 0;']), 'The right guess printed a message too. Only a wrong guess should print `Too high` or `Too low`, so put them inside the loop, before you ask again.'],
    ['hints that ignore secret', swap(GUESS, ['guess > secret', 'guess > 5']), 'Compare the guess with `secret`, so that the messages work for any secret number.'],
    ['no count', swap(GUESS, ['console.log("You got it in " + guesses + " guesses");\n', '']), 'After the loop, print how many guesses the player made. Use a counter that goes up by 1 for each guess.'],
    ['a counter that stays at 0', swap(GUESS, ['let guesses = 1;', 'let guesses = 0;'], ['  guesses = guesses + 1;\n', '']), 'Your counter stays at 0. Inside the loop, write `guesses = guesses + 1;`'],
    ['a count one short', swap(GUESS, ['let guesses = 1;', 'let guesses = 0;']), 'In a test game of 3 guesses, your code counted 2, so the first guess is missing from your count. If you ask once above the loop, start the counter at 1.'],
    ['a count one long', swap(GUESS, ['let guesses = 1;', 'let guesses = 2;']), 'In a test game of 3 guesses, your code counted 4. If you start the counter at 1, ask for the first guess above the loop, or start the counter at 0.'],
    ['the count inside the loop', swap(GUESS, ['  guesses = guesses + 1;\n}\nconsole.log("You got it in " + guesses + " guesses");', '  guesses = guesses + 1;\n  console.log("You got it in " + guesses + " guesses");\n}']), 'The count prints on every pass, because that `console.log` is inside the loop. Move it below the closing `}`.'],
    ['a typed count', swap(GUESS, ['"You got it in " + guesses + " guesses"', '"You got it in 3 guesses"']), 'Your count has to change with the number of guesses. Use a variable that goes up inside the loop.'],
    ['a fixed secret', swap(GUESS, ['Math.floor(Math.random() * 10) + 1', '7']), '`secret` is the same number on every run. Keep the first line, which picks it with `Math.random()`.'],
    ['a secret that can be 0', swap(GUESS, ['Math.floor(Math.random() * 10) + 1', 'Math.floor(Math.random() * 10)']), '`secret` has to be a whole number from 1 to 10. Keep the first line the way it started.'],
    ['a secret with no Math.floor', swap(GUESS, ['Math.floor(Math.random() * 10) + 1', 'Math.random() * 10 + 1']), '`secret` has to be a whole number from 1 to 10. Keep the first line the way it started.'],
  ]);
  right('guess', [
    ['do...while', 'let secret = Math.floor(Math.random() * 10) + 1;\nlet guess;\nlet guesses = 0;\ndo {\n  guess = Number(prompt("Guess"));\n  guesses++;\n  if (guess > secret) {\n    console.log("Too high");\n  } else if (guess < secret) {\n    console.log("Too low");\n  }\n} while (guess !== secret);\nconsole.log(`Guesses: ${guesses}`);\n'],
    ['a string answer compared with ==', 'const secret = Math.floor(Math.random() * 10) + 1;\nlet guess = prompt("Guess");\nlet guesses = 1;\nwhile (guess != secret) {\n  if (guess > secret) {\n    console.log("Too high!");\n  } else {\n    console.log("too low!");\n  }\n  guess = prompt("Again");\n  guesses += 1;\n}\nconsole.log(guesses);\n'],
    ['Number at the comparison', 'let secret = Math.floor(Math.random() * 10) + 1;\nlet guess = prompt("Guess");\nlet guesses = 1;\nwhile (Number(guess) !== secret) {\n  if (Number(guess) > secret) {\n    console.log("Too high");\n  } else {\n    console.log("Too low");\n  }\n  guess = prompt("Again");\n  guesses = guesses + 1;\n}\nconsole.log("It took " + guesses + " guesses");\n'],
    ['parseInt, single quotes, and the secret in the last line', "let secret = Math.floor(Math.random() * 10) + 1;\nlet guess = parseInt(prompt('Guess'));\nlet guesses = 1;\nwhile (guess !== secret) {\n  if (guess < secret) {\n    console.log('Too low');\n  } else {\n    console.log('Too high');\n  }\n  guess = parseInt(prompt('Again'));\n  guesses++;\n}\nconsole.log('The number was ' + secret + ', and it took you ' + guesses + ' guesses');\n"],
    ['alert for the messages', swap(GUESS, ['console.log("Too high")', 'alert("Too high")'], ['console.log("Too low")', 'alert("Too low")'], ['console.log("You got it in " + guesses + " guesses")', 'alert("You got it in " + guesses + " guesses")'])],
  ]);
});

describe('step 4: a prompt with no Number()', () => {
  test('the note names the prompt that still gives a string', () => {
    const second = swap(GUESS, ['guess = Number(prompt("Guess again"));', 'guess = prompt("Guess again");']);
    expect(noteFor(editor('guess'), second)).toMatch(/^The `prompt\(\)` on line \d+ has no `Number\(\)` around it/);
  });
});

describe('step 5: double the tokens', () => {
  const doubling = (loop: string) => swap(DOUBLE, ['for (let i = 0; i < tokens.length; i++) {\n  tokens[i] = tokens[i] * 2;\n}\n', loop]);
  wrong('double', [
    ['the starting code', 'let tokens = [30, 12, 45, 8, 25];\n', '`tokens` did not change. Inside a loop, give each `tokens[i]` a new value.'],
    ['a renamed array', DOUBLE.replaceAll('tokens', 'coins'), 'Keep the variable named `tokens`. Your code has to read it, so that it works on any value.'],
    ['tokens doubled and never printed', swap(DOUBLE, ['console.log(tokens);\n', '']), 'The numbers changed. After the loop, print `tokens` with `console.log(tokens);`'],
    ['for...of on tokens', doubling('for (let n of tokens) {\n  n = n * 2;\n}\n'), 'A `for...of` loop gives you each number in a new variable, so changing that variable leaves `tokens` the same. Use a `for` loop with an index, and change `tokens[i]`.'],
    ['tokens[i] * 2 with no assignment', swap(DOUBLE, ['tokens[i] = tokens[i] * 2;', 'tokens[i] * 2;']), 'Writing `tokens[i] * 2` calculates an answer and throws it away. Write `tokens[i] = tokens[i] * 2;`'],
    ['replacing the array', swap(DOUBLE, ['tokens[i] = tokens[i] * 2;', 'tokens = tokens[0] * 2;'], ['i < tokens.length', 'i < 1']), '`tokens = ...` replaced the whole array with one number. Write `tokens[i] = tokens[i] * 2;` to change one item.'],
    ['doubling i', swap(DOUBLE, ['tokens[i] = tokens[i] * 2;', 'tokens[i] = i * 2;']), 'You doubled the index `i`, not the number at that index. Write `tokens[i] = tokens[i] * 2;`'],
    ['<= on tokens', swap(DOUBLE, ['i < tokens.length', 'i <= tokens.length']), '`i <= tokens.length` reaches one past the end. Writing to that index makes `tokens` longer, so the loop never catches up and never ends. Use `i < tokens.length`.'],
    ['push in place of changing each number', swap(DOUBLE, ['for (let i = 0; i < tokens.length; i++) {\n  tokens[i] = tokens[i] * 2;', 'let size = tokens.length;\nfor (let i = 0; i < size; i++) {\n  tokens.push(tokens[i] * 2);']), '`tokens` grew. Change each number where it sits with `tokens[i] = tokens[i] * 2;`, and add no new items.'],
    ['a fixed count on tokens', swap(DOUBLE, ['i < tokens.length', 'i < 3']), 'Your loop stops at a fixed number, so it fails on a longer list. Use `tokens.length` in the condition.'],
    ['a typed answer', doubling('tokens = [60, 24, 90, 16, 50];\n'), 'Double the numbers from inside a loop, with no numbers typed in, so that your code works on any list.'],
  ]);
  right('double', [
    ['while with an index', doubling('let i = 0;\nwhile (i < tokens.length) {\n  tokens[i] = tokens[i] * 2;\n  i += 1;\n}\n')],
    ['*= and i += 1', swap(DOUBLE, ['tokens[i] = tokens[i] * 2;', 'tokens[i] *= 2;'], ['i < tokens.length; i++', 'i < tokens.length; i += 1'])],
    ['const tokens', swap(DOUBLE, ['let tokens', 'const tokens'])],
    ['i = i + 1', swap(DOUBLE, ['i < tokens.length; i++', 'i < tokens.length; i = i + 1'])],
    ['a new array assigned back', doubling('let doubled = [];\nfor (const n of tokens) {\n  doubled.push(n * 2);\n}\ntokens = doubled;\n')],
  ]);
});

describe('step 6: the top score', () => {
  const noIf = ['  if (scores[i] > best) {\n    best = scores[i];\n  }\n', '  best = scores[i];\n'] as [string, string];
  wrong('scores', [
    ['the starting code', 'let scores = [85, -20];\n', 'Use a loop to go through `scores`, so that your code works on any list.'],
    ['a renamed array', SCORES.replaceAll('scores', 'points'), 'Keep the variable named `scores`. Your code has to read it, so that it works on any value.'],
    ['i < arr with no .length', swap(SCORES, ['i < scores.length', 'i < scores']), '`i < scores` compares a number with a whole array, so the loop never runs. Use `i < scores.length`.'],
    ['typing the answer', 'let scores = [85, -20, 140, 60, 110, -5];\nconsole.log(140);\n', 'Use a loop to go through `scores`, so that your code works on any list.'],
    ['printing inside the loop', swap(SCORES, ['  }\n}\nconsole.log(best);', '  }\n  console.log(best);\n}']), 'Your top score prints on every pass, because that `console.log` is inside the loop. Move it below the closing `}`.'],
    ['best starting at 0', swap(SCORES, ['let best = scores[0];', 'let best = 0;']), 'On a list where every score is negative, your code prints 0, and 0 is not in that list. Start `best` from the list itself, not from a number you type in.'],
    ['best typed in from this list', swap(SCORES, ['let best = scores[0];', 'let best = 85;']), 'On a list where every score is negative, your code prints 85, and 85 is not in that list. Start `best` from the list itself, not from a number you type in.'],
    ['best with no if', swap(SCORES, noIf), 'Your code printed the last score. Change `best` only when a score is bigger than `best`, with an `if`.'],
    ['< where > was needed', swap(SCORES, ['scores[i] > best', 'scores[i] < best']), 'Your code found the lowest score. Use `>` to look for a bigger one.'],
    ['storing i', swap(SCORES, ['    best = scores[i];\n', '    best = i;\n']), 'You stored the index `i`, not the score at that index. Write `best = scores[i];`'],
    ['storing i, with best starting at 0', swap(SCORES, ['    best = scores[i];\n', '    best = i;\n'], ['let best = scores[0];', 'let best = 0;']), 'You stored the index `i`, not the score at that index. Write `best = scores[i];`'],
    ['best that never changes', swap(SCORES, ['    best = scores[i];\n', ''], ['let best = scores[0];', 'let best = 0;']), 'Your top score stayed at 0. Inside the loop, give `best` a new value when a score is bigger than `best`.'],
    ['no top score', swap(SCORES, ['console.log(best);\n', '']), 'Print the top score after the loop.'],
  ]);
  right('scores', [
    ['for...of', 'let scores = [85, -20, 140, 60, 110, -5];\nlet best = scores[0];\nfor (const s of scores) {\n  if (s > best) {\n    best = s;\n  }\n}\nconsole.log(best);\n'],
    ['while, with a label', 'const scores = [85, -20, 140, 60, 110, -5];\nlet best = scores[0];\nlet i = 0;\nwhile (i < scores.length) {\n  if (scores[i] > best) {\n    best = scores[i];\n  }\n  i = i + 1;\n}\nconsole.log("Top score: " + best);\n'],
    ['Math.max', swap(SCORES, ['  if (scores[i] > best) {\n    best = scores[i];\n  }\n', '  best = Math.max(best, scores[i]);\n'])],
    ['-Infinity', swap(SCORES, ['let best = scores[0];', 'let best = -Infinity;'])],
  ]);
});

describe('step 7: the end-of-night report', () => {
  wrong('report', [
    ['the starting code', jsModel.init(editor('report')).files[0].text, 'The total is only the last booth, so something erases it on every pass. Think about what you saw in Step through.'],
    ['let total inside the loop', swap(REPORT, ['  total = total + booths[i];\n', '  let total = 0;\n  total = total + booths[i];\n']), '`let total` inside the loop makes a second variable, so the total above the loop stays 0. Leave out the word `let`.'],
    ['typing the total', swap(REPORT, ['"Total: " + total', '"Total: 100"']), 'Loop 1 should add every booth to `total`, so type no numbers into the print line.'],
    ['a renamed array', REPORT.replaceAll('booths', 'stands'), 'Keep the variable named `booths`. Your code has to read it, so that it works on any value.'],
    ['loop 2 left as it was', swap(REPORT, ['i < booths.length; i++) {\n  console.log("Booth', 'i <= booths.length; i++) {\n  console.log("Booth']), 'The last booth line says `undefined`, so loop 2 reads one item past the end of `booths`. Look at its condition.'],
    ['loop 2 starting at 1', swap(REPORT, ['for (let i = 0; i < booths.length; i++) {\n  console.log("Booth', 'for (let i = 1; i < booths.length; i++) {\n  console.log("Booth']), 'Booth 1 is missing, because the loop skips the first item. Start `i` at 0.'],
    ['loop 2 one short', swap(REPORT, ['i < booths.length; i++) {\n  console.log("Booth', 'i < booths.length - 1; i++) {\n  console.log("Booth']), 'The last booth is missing. The loop should run while `i < booths.length`.'],
    ['a fixed count in both loops', REPORT.replaceAll('i < booths.length', 'i < 4'), 'Loop 1 stops at a fixed number, so it fails on a shorter list. Use `booths.length` in the condition.'],
    ['<= in loop 1', swap(REPORT, ['i < booths.length', 'i <= booths.length']), 'The total came out as `NaN`, because the loop read past the end and added `undefined`. Use `i < booths.length`.'],
    ['a fixed count in loop 2', swap(REPORT, ['i < booths.length; i++) {\n  console.log("Booth', 'i < 4; i++) {\n  console.log("Booth']), 'Loop 2 stops at a fixed number, so it fails on a shorter list. Use `booths.length` in the condition.'],
    ['loop 3 left as it was', swap(REPORT, ['lights = lights - 25;', 'lights - 25;']), '`lights` stays at 100 forever, so loop 3 never ends. Look at the line inside the loop.'],
    ['loop 3 going down by the wrong amount', swap(REPORT, ['lights = lights - 25;', 'lights = lights - 30;']), 'Loop 3 should take `lights` down by 25 on each pass, so that a lower starting value takes fewer passes.'],
    ['loop 3 going up', swap(REPORT, ['lights = lights - 25;', 'lights = lights + 25;']), 'The loop still never ends. `lights` has to go down by 25 on every pass until it reaches 0.'],
    ['loop 3 jumping to 0', swap(REPORT, ['lights = lights - 25;', 'lights = 0;']), 'Loop 3 ran 1 time. Going down by 25 from 100 takes 4 passes, so change `lights` by 25 on each pass.'],
    ['loop 3 with its condition flipped', swap(REPORT, ['lights > 0', 'lights < 0']), 'Loop 3 has to run, so keep the loop and its condition `lights > 0`. The lights should go from 100 to 0.'],
    ['loop 3 deleted', swap(REPORT, ['while (lights > 0) {\n  lights = lights - 25;\n}\n', '']), 'Loop 3 has to run, so keep the loop and its condition `lights > 0`. The lights should go from 100 to 0.'],
    ['no Lights out', swap(REPORT, ['console.log("Lights out");\n', '']), 'Keep `Lights out` as the last line, after the loop.'],
  ]);
  right('report', [
    ['for...of in loop 1, and += in each', swap(REPORT, ['for (let i = 0; i < booths.length; i++) {\n  total = total + booths[i];\n}', 'for (const t of booths) {\n  total += t;\n}'], ['lights = lights - 25', 'lights -= 25'])],
    ['i <= length - 1 in loop 2', swap(REPORT, ['i < booths.length; i++) {\n  console.log("Booth', 'i <= booths.length - 1; i++) {\n  console.log("Booth'])],
    ['a for loop for the lights', swap(REPORT, ['let lights = 100;\nwhile (lights > 0) {\n  lights = lights - 25;\n}\n', 'for (let lights = 100; lights > 0; lights = lights - 25) {\n  console.log(lights);\n}\n'])],
    ['template literals and single quotes', swap(REPORT, ['"Total: " + total', '`Total: ${total}`'], ['"Lights out"', "'Lights out'"], ['"Booth " + (i + 1) + ": " + booths[i]', '`Booth ${i + 1}: ${booths[i]}`'])],
    ['const booths', swap(REPORT, ['let booths', 'const booths'])],
  ]);
});

describe('step 8: the finalists', () => {
  const pushing = (line: string) => swap(FINALS, ['finalists.push(players[i]);', line]);
  wrong('finals', [
    ['the starting code', 'let players = ["Maya", "Dev"];\nlet scores = [140, 85];\n', 'Make an array named `finalists` above the loop: `let finalists = [];`'],
    ['let finalists inside the loop', swap(FINALS, ['let finalists = [];\n', ''], ['  if (scores[i] >= 100) {', '  let finalists = [];\n  if (scores[i] >= 100) {']), '`let finalists = []` is inside the loop, so a new empty array starts on every pass. Move it above the loop.'],
    ['a renamed array', FINALS.replaceAll('scores', 'points'), 'Keep the variable named `scores`. Your code has to read it, so that it works on any value.'],
    ['assigning push', pushing('finalists = finalists.push(players[i]);'), '`push` changes the array and gives back its new length, so `finalists = finalists.push(...)` replaces your array with a number. Write `finalists.push(...);` with no `finalists =` in front.'],
    ['pushing i', pushing('finalists.push(i);'), 'You pushed the index `i`, not the player at that index. Write `finalists.push(players[i]);`'],
    ['pushing the scores', pushing('finalists.push(scores[i]);'), 'You pushed the scores. `finalists` should hold the names, so write `finalists.push(players[i]);`'],
    ['pushing the whole array', pushing('finalists.push(players);'), 'You pushed the whole `players` array. Push one name: `finalists.push(players[i]);`'],
    ['no if', swap(FINALS, ['  if (scores[i] >= 100) {\n    finalists.push(players[i]);\n  }\n', '  finalists.push(players[i]);\n']), 'Everyone made the finals. Put the `push` inside an `if` that checks for a score of 100 or more.'],
    ['> where >= was needed', swap(FINALS, ['scores[i] >= 100', 'scores[i] > 100']), 'A score of exactly 100 also goes to the finals. Look at your condition.'],
    ['i < arr with no .length', swap(FINALS, ['i < players.length', 'i < players']), '`i < players` compares a number with a whole array, so the loop never runs. Use `i < players.length`.'],
    ['a typed list', 'let players = ["Maya", "Dev"];\nlet scores = [140, 85];\nlet finalists = ["Maya"];\nconsole.log(finalists);\n', 'Use a loop to go through the players, and `push` each finalist.'],
    ['for...of with no index', swap(FINALS, ['for (let i = 0; i < players.length; i++) {\n  if (scores[i] >= 100) {\n    finalists.push(players[i]);\n  }\n}', 'for (const p of players) {\n  if (scores[p] >= 100) {\n    finalists.push(p);\n  }\n}']), 'A `for...of` loop hands you each name without its index, and the score sits at the same index in `scores`. Use `for (let i = 0; i < players.length; i++)`, so that `i` works on both arrays.'],
    ['printing inside the loop', swap(FINALS, ['    finalists.push(players[i]);\n  }\n}\nconsole.log(finalists);', '    finalists.push(players[i]);\n    console.log(finalists);\n  }\n}']), '`finalists` printed on every pass, because that `console.log` is inside the loop. Move it below the closing `}`.'],
    ['no print', swap(FINALS, ['console.log(finalists);\n', '']), 'After the loop, write `console.log(finalists);`'],
    ['a condition on players', swap(FINALS, ['scores[i] >= 100', 'players[i] !== ""']), 'Everyone made the finals. Put the `push` inside an `if` that checks for a score of 100 or more.'],
  ]);
  right('finals', [
    ['while', 'let players = ["Maya", "Dev", "Priya", "Sam", "Zoe", "Eli"];\nlet scores = [140, 85, 110, 60, 100, 95];\nconst finalists = [];\nlet i = 0;\nwhile (i < scores.length) {\n  if (scores[i] >= 100) {\n    finalists.push(players[i]);\n  }\n  i += 1;\n}\nconsole.log(finalists);\n'],
    ['for...of with a counter', swap(FINALS, ['for (let i = 0; i < players.length; i++) {\n  if (scores[i] >= 100) {\n    finalists.push(players[i]);\n  }\n}', 'let i = 0;\nfor (const p of players) {\n  if (scores[i] >= 100) {\n    finalists.push(p);\n  }\n  i = i + 1;\n}'])],
    ['join and a label', swap(FINALS, ['console.log(finalists);', 'console.log("Finalists: " + finalists.join(", "));'])],
    ['a template literal', swap(FINALS, ['console.log(finalists);', 'console.log(`Finalists: ${finalists}`);'])],
    ['each name on its own line', swap(FINALS, ['console.log(finalists);', 'for (const name of finalists) {\n  console.log(name);\n}'])],
    ['an index in place of push', swap(FINALS, ['finalists.push(players[i]);', 'finalists[finalists.length] = players[i];'])],
    ['i = i + 1 and single quotes', swap(FINALS, ['i++', 'i = i + 1'], ['"Maya"', "'Maya'"])],
  ]);
});

describe('optional extra challenge: the token table', () => {
  wrong('table', [
    ['the starting code', 'let size = 4;\n', 'Print one line for each row of the table.'],
    ['printing in the inner loop', 'let size = 4;\nfor (let r = 1; r <= size; r++) {\n  for (let k = 1; k <= size; k++) {\n    console.log(r * k);\n  }\n}\n', 'Each number printed on its own line, because `console.log` is inside the inner loop. Build one row in a string, and print the string after the inner loop.'],
    ['the row kept across rows', swap(TABLE, ['  let line = "";\n', ''], ['for (let r = 1;', 'let line = "";\nfor (let r = 1;']), 'Each row keeps the numbers from the row above. Start the string over at `""` inside the outer loop, above the inner loop.'],
    ['starting at 0', TABLE.replaceAll('= 1;', '= 0;'), 'Your table starts at 0. Start both loops at 1.'],
    ['a fixed size', TABLE.replaceAll('<= size', '<= 3'), 'Use `size` in both loops, so that the table changes when `size` does.'],
    ['a renamed size', TABLE.replaceAll('size', 'rows'), 'Keep the variable named `size`. Your code has to read it, so that it works on any value.'],
    ['< where <= was needed', TABLE.replaceAll('<= size', '< size'), 'Your table came out too small. It needs as many rows and as many columns as `size`, so both loops should go up to and including `size`.'],
    ['no spaces between the numbers', swap(TABLE, ['line = line + r * c + " ";', 'line = line + r * c;']), 'Your numbers run together. Add a space after each number.'],
  ]);
  right('table', [
    ['while loops', 'let size = 4;\nlet r = 1;\nwhile (r <= size) {\n  let row = "";\n  let k = 1;\n  while (k <= size) {\n    row += r * k + " ";\n    k += 1;\n  }\n  console.log(row);\n  r = r + 1;\n}\n'],
    ['an array and join', 'const size = 4;\nfor (let r = 1; r <= size; r++) {\n  const row = [];\n  for (let k = 1; k <= size; k++) {\n    row.push(r * k);\n  }\n  console.log(row.join(" "));\n}\n'],
    ['template literals with tabs', swap(TABLE, ['line = line + r * c + " ";', 'line = `${line}${r * c}\\t`;'])],
  ]);
});

describe('student text', () => {
  const text = JSON.stringify(jsLoopsLab.steps) + editors.flatMap((d) => (d.checks as JsCheck[]).flatMap((c) => [c.label, ...(c.hints ?? [])])).join(' ');

  test('follows the voice rules', () => {
    expect(text).not.toMatch(/—|\bjust\b|\bsimply\b|\beasy\b|\beasier\b|\bobviously\b|extra credit|\bbonus\b|\bthing\b|\bthings\b/i);
  });
});
