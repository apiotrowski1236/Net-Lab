import type { JsCheck, JsCheckCtx, JsFile } from '../../demos/types';

/**
 * Starting code and checks for js-loops. A check runs the student's code with
 * other data, so it decides from what the code does. It reads the source only
 * after a check has failed, to name the mistake in its note.
 */

type Run = ReturnType<JsCheckCtx['run']>;
type Line = Run['output'][number];

const script = (text: string): JsFile[] => [{ name: 'script.js', text }];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const lastOf = <T>(list: readonly T[]): T | undefined => list[list.length - 1];
const sum = (list: readonly number[]) => list.reduce((a, b) => a + b, 0);

/** Every number in a line of output, so `Total: 30` and `30` both count. */
const numbersIn = (text: string) => (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const withNumbers = (r: Run) => r.output.filter((l) => numbersIn(l.text).length > 0);
const firstNumber = (l: Line) => numbersIn(l.text)[0];

/** The most passes any loop made. */
const passes = (r: Run) => Math.max(0, ...r.facts.loops.map((l) => l.runs));

/** The last line came from a line of code that printed more than once, so that code sits in a loop. */
const lastLineRepeats = (r: Run) => {
  const last = lastOf(r.output);
  return !!last && r.output.filter((l) => l.line === last.line).length > 1;
};

/** How many passes the loop that mentions this name made. */
function passesOf(c: JsCheckCtx, r: Run, name: string): number | undefined {
  const loop = c.loops().find((l) => l.head.includes(name) || l.body.includes(name));
  return loop && r.facts.loops.find((l) => l.line === loop.line)?.runs;
}

/** A loop whose condition stops at a typed number, like `i < 5`. */
const fixedStop = (c: JsCheckCtx) => c.loops().some((l) => /(<=?|!==?)\s*\d+\s*$/.test(l.test ?? ''));

const declaredInLoop = (c: JsCheckCtx, name: string) => c.declarations().some((d) => d.name === name && d.inLoop);
const hasNote = (c: JsCheckCtx, rule: string) => c.notes.some((n) => n.rule === rule);

const BROKE = 'Your code stopped with an error before it finished. Fix the error under the output, then press Run.';
const SPUN = 'One of your loops never ended. Read the message under the output, fix the loop, then press Run.';
const keepName = (name: string) => `Keep the variable named \`${name}\`. Your code has to read it, so that it works on any value.`;

/** Mistakes any loop can make, and the same note for each one. */
function headerMistake(c: JsCheckCtx): string | undefined {
  if (hasNote(c, 'semicolon-after-header')) return 'There is a semicolon right after a `for`, `while`, or `if` header, so that header has nothing to run. Delete the semicolon.';
  if (hasNote(c, 'assign-in-condition')) return 'A single `=` in a condition gives the variable a new value and compares nothing. Use `===` or `!==`.';
  return undefined;
}

function check(id: string, label: string, test: JsCheck['test'], hints: string[]): JsCheck {
  return { id, label, hints, test: (c) => headerMistake(c) ?? test(c) };
}

// --- step 1: count down ------------------------------------------------------

export const COUNT_START = script(`let count = 1;
while (count <= 3) {
  console.log(count);
  count = count + 1;
}
`);

const TEN_TO_ZERO = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

export const COUNTS_DOWN = check(
  'counts-down',
  'Count down from 10 to 0',
  (c) => {
    const r = c.run();
    if (r.error) return BROKE;
    const n = withNumbers(r).map(firstNumber);
    if (!n.length) return 'Print `count` inside the loop, so that each number shows up on its own line.';
    const spun = r.status === 'limit';
    if (spun && n[1] === n[0]) return '`count` never changes, so the loop never ends. Writing `count - 1` works out an answer and throws it away. Write `count = count - 1;` inside the loop.';
    if (spun && n[1] > n[0]) return '`count` keeps going up, so the condition stays true and the loop never ends. Write `count = count - 1;` to make it go down.';
    if (spun) return SPUN;
    if (n[1] > n[0]) return 'These numbers go up. Start `count` at 10, and make it go down by 1 on each pass.';
    if (!passes(r)) return 'Print the numbers from a loop, with no separate line of code for each number.';
    if (n[0] !== 10) return `Your countdown starts at ${n[0]}. Start \`count\` at 10.`;
    if (lastOf(n) === 1) return 'Your countdown stops at 1, so 0 never prints. `count > 0` ends the loop one pass too soon. Use `count >= 0`.';
    return same(n, TEN_TO_ZERO) ? undefined : 'Print every number from 10 down to 0, one on each line.';
  },
  ['Three parts of the loop need to change: where `count` starts, the condition, and the line that updates `count`.', 'The loop should keep going while `count` is 0 or more.', 'Use `let count = 10;`, then `while (count >= 0)`, then `count = count - 1;` inside the loop.'],
);

export const DOORS_OPEN = check(
  'doors-open',
  'Print Doors open! once, after the loop',
  (c) => {
    const r = c.run();
    const doors = r.output.filter((l) => /doors open/i.test(l.text));
    if (!doors.length) return 'Add `console.log("Doors open!");` below the closing `}` of the loop.';
    if (doors.length > 1) return `\`Doors open!\` printed ${doors.length} times, because that line is inside the loop. Move it below the closing \`}\`.`;
    return lastOf(r.output) === doors[0] ? undefined : '`Doors open!` printed before the countdown finished. Move that line below the closing `}` of the loop.';
  },
  ['Code after the closing `}` runs one time, when the loop is done.', 'Add `console.log("Doors open!");` on the last line of the program.'],
);

// --- step 2: count by steps, with a running total ----------------------------

export const PRIZES_START = script(`let top = 300;

for (let price = 50; price <= top; price = price + 1) {
  console.log(price);
}
`);

/** Prices all come from one line of code, so a total printed elsewhere isn't mistaken for one. */
const pricesFrom = (r: Run) => {
  const lines = withNumbers(r);
  return lines.filter((l) => l.line === lines[0].line).map(firstNumber);
};

export const PRICES = check(
  'prices',
  'Print every price, counting up by 50 to top',
  (c) => {
    const r = c.run({ data: { top: 200 } });
    if (r.dataMissing.length) return keepName('top');
    const none = r.error ? BROKE : 'Print `price` inside the loop, so that each price shows up on its own line.';
    if (!withNumbers(r).length) return none;
    const got = pricesFrom(r);
    if (got.length < 2) return none;
    if (r.status === 'limit') return got[1] === got[0] ? '`price` never changes, so the loop never ends. Writing `price + 50` works out an answer and throws it away. Write `price = price + 50` in the header.' : SPUN;
    if (got[0] !== 50) return `The first price should be 50, and yours is ${got[0]}. Start \`price\` at 50.`;
    if (got[1] - got[0] !== 50) return `Your prices go up by ${got[1] - got[0]}. Change the last part of the \`for\` header so that \`price\` goes up by 50.`;
    if (lastOf(got)! > 200) return 'With `top` set to 200, your list went past 200. Use `top` in the condition, with no fixed number.';
    if (lastOf(got) === 150) return 'Your list stops one price short of `top`. `price < top` ends the loop too soon. Use `price <= top`.';
    return same(got, [50, 100, 150, 200]) ? undefined : 'Print each price from 50 up to `top`, one on each line.';
  },
  ['The last part of a `for` header says how the variable changes after each pass.', 'To go up by 50, the variable has to get a new value that is 50 higher.', 'Change the update to `price = price + 50`. You can also write `price += 50`.'],
);

export const PRIZE_TOTAL = check(
  'prize-total',
  'After the loop, print what one of each prize costs',
  (c) => {
    const r = c.run({ data: { top: 200 } });
    if (r.error) return declaredInLoop(c, 'total') ? '`let total` is inside the loop, so `total` disappears at the closing `}`. Move `let total = 0;` above the loop.' : BROKE;
    const printed = withNumbers(r);
    const extra = printed.filter((l) => l.line !== printed[0].line);
    if (!extra.length) return 'Add up the prices in a variable named `total`, then print `total` after the loop.';
    if (lastLineRepeats(r)) return 'Your total prints on every pass, because that `console.log` is inside the loop. Move it below the closing `}`, so that only the final total prints.';
    const got = firstNumber(extra[extra.length - 1]);
    if (got === 500 && extra.length === 1) return undefined;
    if (got === 200) return 'Your total is only the last price, so it starts over on every pass. Move `total = 0` above the loop, so that it runs one time.';
    if (got === 0) return declaredInLoop(c, 'total') ? 'Your total stays at 0, because `let total` inside the loop makes a second variable. Leave out the word `let` inside the loop.' : 'Your total stays at 0. Writing `total + price` works out an answer and throws it away. Write `total = total + price;` inside the loop.';
    return `With \`top\` set to 200, one of each prize costs 500 tokens, and your code printed ${got}. Add \`price\` to \`total\` inside the loop.`;
  },
  ['A running total starts at 0 above the loop. Each pass adds to it.', 'Put `let total = 0;` above the loop. Inside the loop, add `price` to `total`.', 'Write `total = total + price;` inside the loop, then `console.log(total);` below the closing `}`.'],
);

// --- step 3: keep asking -----------------------------------------------------

export const DOOR_START = script(`let code = prompt("What is the door code?");

if (code !== "pixel") {
  code = prompt("That is not the code. Try again.");
}

console.log("Welcome to Arcade Night!");
`);

const TWO_WRONG = { prompts: ['open', 'please', 'pixel'] };

export const KEEPS_ASKING = check(
  'keeps-asking',
  'Keep asking until the answer is pixel',
  (c) => {
    if (!c.calls('prompt').length) return 'Ask for the code with `prompt()`.';
    const r = c.run(TWO_WRONG);
    if (r.error) return BROKE;
    if (r.status === 'limit') return 'The loop never asks again, so `code` stays wrong and the loop cannot end. Put `code = prompt("Try again");` inside the loop.';
    if (r.status === 'waiting') {
      if (declaredInLoop(c, 'code')) return '`let code` inside the loop makes a second variable, so the condition never sees the new answer. Leave out the word `let` inside the loop.';
      if (!c.assigned('code').length) return 'The answer from the `prompt()` inside the loop is never saved, so `code` keeps the first wrong answer. Write `code = prompt("Try again");`.';
      return 'The program kept asking after the right code. The loop should keep going only while `code` is not `"pixel"`.';
    }
    if (r.facts.prompts < 3) return c.loops().length ? 'The door opened on a wrong answer. The condition has to be true while the code is wrong, so use `code !== "pixel"`.' : 'The door opened after two wrong answers, because an `if` asks only one more time. Change `if` to `while`.';
    const first = c.run({ prompts: ['pixel'] });
    return first.status === 'ok' && first.facts.prompts === 1 ? undefined : 'Someone who types `pixel` on the first try should get in right away.';
  },
  ['The `if` runs its body one time. A `while` runs its body again and again until its condition is false.', 'The condition can stay the same. Change only the word in front of it.', 'Change `if (code !== "pixel")` to `while (code !== "pixel")`.'],
);

export const WELCOME = check(
  'welcome',
  'Print the welcome once, after the loop',
  (c) => {
    const r = c.run(TWO_WRONG);
    const hits = r.output.filter((l) => /welcome/i.test(l.text));
    if (!hits.length) return 'Keep the line that prints `Welcome to Arcade Night!` below the loop.';
    if (hits.length > 1) return `The welcome printed ${hits.length} times, because that line is inside the loop. Move it below the closing \`}\`.`;
    return lastOf(r.output) === hits[0] ? undefined : 'The welcome should be the last line, after the loop is done.';
  },
  ['The welcome goes after the closing `}` of the loop.', 'Put `console.log("Welcome to Arcade Night!");` on the last line of the program.'],
);

// --- step 4: the guessing game -----------------------------------------------

export const GUESS_START = script(`let secret = Math.floor(Math.random() * 10) + 1;

// Write the game here.
`);

const GAME = { data: { secret: 4 }, prompts: ['9', '2', '4', '4', '4', '4'] };

export const GAME_ENDS = check(
  'game-ends',
  'Keep asking until the guess matches secret',
  (c) => {
    if (!c.calls('prompt').length) return 'Ask for a guess with `prompt()`.';
    const r = c.run(GAME);
    if (r.dataMissing.length) return keepName('secret');
    const shadowed = '`let guess` inside the loop makes a second variable, so the condition never sees the new guess. Leave out the word `let` inside the loop.';
    if (r.error) return declaredInLoop(c, 'guess') ? shadowed : BROKE;
    if (r.status === 'limit') return 'The loop never asks again, so the guess stays the same and the loop cannot end. Put a `prompt()` inside the loop, and save its answer.';
    if (r.facts.promptCompare.length) return '`prompt()` gives back a string, and a string is never `===` to a number, so the right guess never matches `secret`. Write `guess = Number(prompt("Your guess"));`.';
    if (r.status === 'waiting') {
      if (c.assigned('secret').length) return '`secret` gets a new random number inside the loop, so the target keeps moving. Pick `secret` one time, above the loop.';
      if (declaredInLoop(c, 'guess')) return shadowed;
      return 'The game kept asking after the player typed the secret number. Save each answer in the variable that the condition reads.';
    }
    if (r.facts.prompts < 3) return 'The game ended before the player guessed `secret`. An `if` asks one time, so use a `while` loop that runs until the guess matches.';
    return r.facts.prompts === 3 ? undefined : 'The game should stop asking as soon as the guess matches `secret`.';
  },
  ['Make a variable named `guess` and give it the first answer. The loop runs while `guess` is not `secret`.', '`prompt()` gives back a string, and `secret` is a number. `Number(prompt("Your guess"))` gives you a number.', 'Write `let guess = Number(prompt("Your guess"));`, then `while (guess !== secret) { guess = Number(prompt("Guess again")); }`.'],
);

const hintWords = (r: Run) => r.output.flatMap((l) => (/too\s*high/i.test(l.text) ? ['high'] : /too\s*low/i.test(l.text) ? ['low'] : []));

export const GAME_HINTS = check(
  'game-hints',
  'Print Too high or Too low after each wrong guess',
  (c) => {
    const said = hintWords(c.run({ data: { secret: 4 }, prompts: ['9', '2', '4'] }));
    if (!said.length) return 'After each wrong guess, print `Too high` or `Too low`.';
    if (same(said, ['low', 'high'])) return 'The messages are swapped: a guess above `secret` printed `Too low`. Switch the two messages, or change `>` to `<`.';
    if (said.length > 2) return 'The right guess printed a message too. Only a wrong guess should print `Too high` or `Too low`, so put them inside the loop, before you ask again.';
    if (!same(said, ['high', 'low'])) return 'Print one message for each wrong guess: `Too high` above `secret`, and `Too low` below it.';
    return same(hintWords(c.run({ data: { secret: 8 }, prompts: ['6', '9', '8'] })), ['low', 'high']) ? undefined : 'Compare the guess with `secret`, so that the messages work for any secret number.';
  },
  ['Inside the loop, an `if` and `else` can pick the message.', 'Compare `guess` with `secret` before you ask again.', 'Write `if (guess > secret) { console.log("Too high"); } else { console.log("Too low"); }` as the first code inside the loop.'],
);

/** The guess count from the last line, leaving out the secret 8 in case the message names it. */
const countFrom = (r: Run) => numbersIn(lastOf(r.output)?.text ?? '').filter((n) => n !== 8)[0];
const countAfter = (c: JsCheckCtx, prompts: string[]) => c.run({ data: { secret: 8 }, prompts });

export const GAME_COUNT = check(
  'game-count',
  'After the loop, print how many guesses it took',
  (c) => {
    const three = countAfter(c, ['9', '2', '8']);
    const got = countFrom(three);
    if (got === undefined) return 'After the loop, print how many guesses the player made. Use a counter that goes up by 1 for each guess.';
    if (lastLineRepeats(three)) return 'The count prints on every pass, because that `console.log` is inside the loop. Move it below the closing `}`.';
    if (got === 0) return 'Your counter stays at 0. Inside the loop, write `guesses = guesses + 1;`.';
    if (got === 2) return 'Three guesses counted as 2, so the first guess is missing from your count. If you ask once above the loop, start the counter at 1.';
    if (got === 4) return 'Three guesses counted as 4. If you start the counter at 1, ask for the first guess above the loop, or start the counter at 0.';
    if (got !== 3) return `The player made 3 guesses, and your code printed ${got}.`;
    return countFrom(countAfter(c, ['8'])) === 1 && countFrom(countAfter(c, ['1', '2', '3', '5', '6', '8'])) === 6 ? undefined : 'Your count has to change with the number of guesses. Use a variable that goes up inside the loop.';
  },
  ['A counter is a running total that adds 1 each time.', 'Make `let guesses = 1;` above the loop, since the first guess already happened. Each `prompt()` inside the loop adds one more.', 'Write `guesses = guesses + 1;` inside the loop, then `console.log("You got it in " + guesses + " guesses");` after the loop.'],
);

export const SECRET_RANDOM = check(
  'secret-random',
  'Keep secret random, from 1 to 10',
  (c) => {
    const allGuesses = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    // Seed 7 gives the lowest number and seed 4 the highest, so an answer that is off by one shows up.
    const secrets = [1, 2, 4, 7, 9, 12].map((seed) => c.run({ seed, prompts: allGuesses }).vars.secret);
    if (new Set(secrets).size < 2) return '`secret` is the same number on every run. Keep the first line, which picks it with `Math.random()`.';
    return secrets.every((s) => Number.isInteger(s) && (s as number) >= 1 && (s as number) <= 10) ? undefined : '`secret` has to be a whole number from 1 to 10. Keep the first line the way it started.';
  },
  ['The starting code already picks a random number from 1 to 10.', 'Put back `let secret = Math.floor(Math.random() * 10) + 1;` as the first line.'],
);

// --- step 5: walk an array by index ------------------------------------------

export const LINE_START = script(`let players = ["Maya", "Dev", "Priya", "Sam", "Zoe"];
let tokens = [30, 12, 45, 8, 25];

// Print each player's place in line, like "1. Maya".
`);

const THREE = { players: ['Ana', 'Bo', 'Cy'], tokens: [3, 5, 9] };
const SEVEN = { players: ['Ana', 'Bo', 'Cy', 'Di', 'Eli', 'Fay', 'Gus'], tokens: [1, 2, 3, 4, 5, 6, 7] };
const NOBODY = { players: [], tokens: [] };

const rowsFor = (r: Run, names: string[]) => r.output.filter((l) => l.text.includes('undefined') || names.some((n) => l.text.includes(n)));

/** Writing to `tokens[i]` with `<=` adds an item on every pass, so `i` never reaches the end. */
const spinning = (c: JsCheckCtx) =>
  c.loops().some((l) => /<=\s*tokens\.length/.test(l.test ?? '')) ? '`i <= tokens.length` reaches one past the end. Writing to that index makes `tokens` longer, so the loop never catches up and never ends. Use `i < tokens.length`.' : SPUN;

function placeProblem(c: JsCheckCtx, data: { players: string[]; tokens: number[] }): string | undefined {
  const r = c.run({ data });
  if (r.dataMissing.length) return keepName(r.dataMissing[0]);
  if (r.error) return BROKE;
  if (r.status === 'limit') return spinning(c);
  const names = data.players;
  const rows = rowsFor(r, names);
  if (!rows.length) {
    if (c.loops().some((l) => /[<>]=?\s*players\s*$/.test(l.test ?? ''))) return '`i < players` compares a number with a whole array, so the loop never runs. Use `i < players.length`.';
    return 'Print one line for each player from inside a loop.';
  }
  if (rows.length === 1) return 'That printed one line. Put the `console.log` inside the loop, so that each player gets a line.';
  if (rows.some((l) => l.text.includes('undefined'))) {
    return fixedStop(c) ? 'Your loop stops at a fixed number, so it fails on a shorter list. Use `players.length` in the condition.' : 'The last line says `undefined`, because the loop reads one past the end of `players`. Use `i < players.length`, not `<=`.';
  }
  if (!rows[0].text.includes(names[0])) return `Your list starts with ${rows[0].text.includes(names[1]) ? names[1] : 'the wrong player'} and skips ${names[0]}. The first item is at index 0, so start \`i\` at 0.`;
  if (rows.length < names.length) return fixedStop(c) ? 'Your loop stops at a fixed number, so it fails on a longer list. Use `players.length` in the condition.' : 'Your list stops before the last player. The loop should run while `i < players.length`.';
  for (let k = 0; k < names.length; k++) {
    const text = rows[k].text;
    if (new RegExp(`^\\D*${k + 1}\\b`).test(text) && text.includes(names[k])) continue;
    if (new RegExp(`^\\D*${k}1\\b`).test(text)) return '`+` joined `i` and 1 as text. Put parentheses around them: `(i + 1)`.';
    if (new RegExp(`^\\D*${k}\\b`).test(text)) return 'Your places start at 0. Indexes start at 0 and places start at 1, so print `i + 1`.';
    if (!numbersIn(text).length) return 'Each line needs a place number, like `1. Maya`. A `for...of` loop hands you each name without its position, so use `for (let i = 0; i < players.length; i++)` and print `i + 1`.';
    return 'Print the place first and then the name, like `1. Maya`.';
  }
  return undefined;
}

export const PLACES = check(
  'places',
  'Print each player with their place in line',
  (c) => placeProblem(c, THREE) ?? placeProblem(c, SEVEN) ?? (rowsFor(c.run({ data: NOBODY }), ['undefined']).length ? 'With an empty list, your code should print no players. Use `players.length` in the condition.' : undefined),
  ['The place is one more than the index, because indexes start at 0.', 'Loop with `for (let i = 0; i < players.length; i++)`.', 'Inside the loop, write `console.log((i + 1) + ". " + players[i]);`.'],
);

export const DOUBLED = check(
  'doubled',
  'Double every number inside tokens',
  (c) => {
    const r = c.run({ data: THREE });
    if (r.dataMissing.length) return keepName('tokens');
    if (r.error) return BROKE;
    if (r.status === 'limit') return spinning(c);
    const got = r.vars.tokens;
    if (typeof got === 'number') return '`tokens = ...` replaced the whole array with one number. Write `tokens[i] = tokens[i] * 2;` to change one item.';
    if (same(got, [6, 10, 18])) {
      if (!same(c.run({ data: SEVEN }).vars.tokens, SEVEN.tokens.map((n) => n * 2))) return 'Your loop stops at a fixed number, so it fails on a longer list. Use `tokens.length` in the condition.';
      return same(c.run({ data: NOBODY }).vars.tokens, []) ? undefined : 'An empty `tokens` should stay empty. Use `tokens.length` in the condition.';
    }
    if (same(got, THREE.tokens)) {
      if (c.loops().some((l) => l.kind === 'for-of')) return 'A `for...of` loop hands you a copy of each number, so changing that copy leaves `tokens` the same. Use `for (let i = 0; i < tokens.length; i++)` and write `tokens[i] = tokens[i] * 2;`.';
      if (hasNote(c, 'result-unused')) return 'Writing `tokens[i] * 2` works out an answer and throws it away. Write `tokens[i] = tokens[i] * 2;`.';
      return '`tokens` did not change. Inside a loop, give each `tokens[i]` a new value.';
    }
    if (same(got, [0, 2, 4])) return 'You doubled the index `i`, not the number at that index. Write `tokens[i] = tokens[i] * 2;`.';
    if (!c.loops().some((l) => (l.head + l.body).includes('tokens'))) return 'Double the numbers from inside a loop, with no numbers typed in, so that your code works on any list.';
    if (Array.isArray(got) && got.length > THREE.tokens.length) return '`tokens` grew. Change each number where it sits with `tokens[i] = tokens[i] * 2;`, and add no new items.';
    return 'Each number in `tokens` should end up twice as big, and every item should change.';
  },
  ['You have to change the array itself, so you need the index of each number.', 'Loop with `for (let i = 0; i < tokens.length; i++)`.', 'Inside the loop, write `tokens[i] = tokens[i] * 2;`. After the loop, write `console.log(tokens);`.'],
);

// --- step 6: find values in a list -------------------------------------------

export const SCORES_START = script(`let scores = [85, -20, 140, 60, 110, -5];

// Print the team total, how many scores are 100 or more, and the top score.
`);

const MIXED = { scores: [120, 100, 99, -3, 7] };
const ALL_NEGATIVE = { scores: [-5, -2, -9] };
const EMPTY = { scores: [] };

const MENTIONS_I = /\bi\s*(>=|>|<=|<|===|==)\s*\d/;

function totalProblem(c: JsCheckCtx, list: number[]): string | undefined {
  const r = c.run({ data: { scores: list } });
  if (r.dataMissing.length) return keepName('scores');
  if (r.error) return BROKE;
  if (r.status === 'limit') return SPUN;
  if (list.length && !passes(r)) {
    if (c.loops().some((l) => /[<>]=?\s*scores\s*$/.test(l.test ?? ''))) return '`i < scores` compares a number with a whole array, so the loop never runs. Use `i < scores.length`.';
    return 'Use a loop to go through `scores`, so that your code works on any list.';
  }
  const line = r.output[0];
  if (!line) return 'Print the team total on the first line.';
  if (r.output.length > 3) return `Your code printed ${r.output.length} lines. Each answer belongs on one line, so move your \`console.log\` lines below the closing \`}\` of the loop.`;
  const want = sum(list);
  if (numbersIn(line.text).includes(want)) return undefined;
  if (line.text.includes('NaN')) return 'The total came out as `NaN`, because the loop read past the end and added `undefined`. Use `i < scores.length`, not `<=`.';
  if (list.length > 1 && numbersIn(line.text).includes(sum(list.map((_, i) => i)))) return 'You added the index `i`, not the score at that index. Write `total = total + scores[i];`.';
  if (list.length > 1 && numbersIn(line.text).includes(want - list[0])) return 'Your total is missing the first score. The first item is at index 0, so start `i` at 0.';
  if (list.length > 1 && numbersIn(line.text).includes(lastOf(list)!)) return 'Your total is only the last score, so it starts over on every pass. Move `total = 0` above the loop.';
  return 'The first line should be the total of every score in `scores`.';
}

export const TEAM_TOTAL = check(
  'team-total',
  'Print the team total on the first line',
  (c) => totalProblem(c, MIXED.scores) ?? totalProblem(c, ALL_NEGATIVE.scores) ?? (numbersIn(c.run({ data: EMPTY }).output[0]?.text ?? '').includes(0) ? undefined : 'An empty list has a total of 0. Print the total from a variable that starts at 0.'),
  ['Start a total at 0 above the loop, and add one score on each pass.', 'Inside a loop over `scores`, add the score to the total, not the index.', 'Write `total = total + scores[i];` inside the loop, then `console.log(total);` after it.'],
);

export const HIGH_COUNT = check(
  'high-count',
  'Print how many scores are 100 or more on the second line',
  (c) => {
    const r = c.run({ data: MIXED });
    const line = r.output[1];
    if (!line) return 'Print how many scores are 100 or more on the second line. Use a counter that starts at 0.';
    const got = numbersIn(line.text);
    if (got.includes(2) && numbersIn(c.run({ data: ALL_NEGATIVE }).output[1]?.text ?? '').includes(0) && numbersIn(c.run({ data: { scores: [100, 100, 500] } }).output[1]?.text ?? '').includes(3)) return undefined;
    if (hasNote(c, 'result-unused')) return 'Writing `count + 1` works out an answer and throws it away. Write `count = count + 1;`.';
    if (c.loops().some((l) => MENTIONS_I.test(l.body))) return 'You compared the index `i`, not the score at that index. Write `if (scores[i] >= 100)`.';
    if (got.includes(1)) return 'A score of exactly 100 counts too. Use `>=`, not `>`.';
    if (got.includes(5)) return 'Your code counted every score. Put `count = count + 1;` inside an `if` that checks for 100 or more.';
    return 'The second line should be how many scores are 100 or more. Add 1 to a counter inside an `if`.';
  },
  ['A counter starts at 0 above the loop. It goes up only when a score meets the condition.', 'Inside the loop, write an `if` that checks whether the score is 100 or more.', 'Write `if (scores[i] >= 100) { count = count + 1; }`, then print `count` after the loop.'],
);

export const TOP_SCORE = check(
  'top-score',
  'Print the top score on the third line',
  (c) => {
    const third = (data: { scores: number[] }) => c.run({ data }).output[2]?.text ?? '';
    const mixed = third(MIXED);
    if (!mixed) return 'Print the top score on the third line.';
    const bad = numbersIn(third(ALL_NEGATIVE));
    const isIndex = (n: number | undefined, list: number[]) => n !== undefined && n > 0 && n < list.length && !list.includes(n);
    if (numbersIn(mixed).includes(120) && bad.includes(-2) && numbersIn(third({ scores: [3, 9, 4] })).includes(9)) return undefined;
    if (numbersIn(mixed).includes(120) && bad.includes(0)) return 'When every score is negative, your code prints 0, and 0 is not in the list. Start `best` at `scores[0]`, not at 0.';
    if (numbersIn(mixed).includes(7)) return 'Your code printed the last score. Change `best` only when a score is bigger than `best`, with an `if`.';
    if (numbersIn(mixed).includes(-3)) return 'Your code found the lowest score. Use `>` to look for a bigger one.';
    if (isIndex(numbersIn(mixed)[0], MIXED.scores) || isIndex(bad[0], ALL_NEGATIVE.scores)) return 'You stored the index `i`, not the score at that index. Write `best = scores[i];`.';
    if (numbersIn(mixed).includes(0)) return 'Your top score stayed at 0. Inside the loop, give `best` a new value when a score is bigger than `best`.';
    return 'The third line should be the biggest number in `scores`. Your code has to work when every score is negative.';
  },
  ['Keep the best score so far in a variable, and start it at the first score in the list.', 'On each pass, an `if` asks whether this score is bigger than `best`.', 'Write `let best = scores[0];` above the loop, and `if (scores[i] > best) { best = scores[i]; }` inside it.'],
);

// --- step 7: fix the closing report ------------------------------------------

export const REPORT_START = script(`let booths = [40, 15, 25, 20];

// Loop 1: add up the tokens from every booth.
let total = 0;
for (let i = 0; i < booths.length; i++) {
  total = 0;
  total = total + booths[i];
}
console.log("Total: " + total);

// Loop 2: print the tokens from each booth.
for (let i = 0; i <= booths.length; i++) {
  console.log("Booth " + (i + 1) + ": " + booths[i]);
}

// Loop 3: dim the lights by 25 until they are off.
let lights = 100;
while (lights > 0) {
  lights - 25;
}
console.log("Lights out");
`);

const THREE_BOOTHS = { booths: [5, 6, 7] };
const SIX_BOOTHS = { booths: [9, 1, 4, 2, 8, 3] };

export const REPORT_TOTAL = check(
  'report-total',
  'Fix loop 1, so that the total adds up every booth',
  (c) => {
    const r = c.run({ data: THREE_BOOTHS });
    if (r.dataMissing.length) return keepName('booths');
    const line = r.output.find((l) => /total/i.test(l.text));
    if (!line) return r.error ? BROKE : 'Keep the line that prints `Total: ` and the total.';
    if (line.text.includes('NaN')) return fixedStop(c) ? 'Loop 1 stops at a fixed number, so it fails on a shorter list. Use `booths.length` in the condition.' : 'The total came out as `NaN`, because the loop read past the end and added `undefined`. Use `i < booths.length`.';
    const got = firstNumber(line);
    if (got === 18) return numbersIn(c.run({ data: SIX_BOOTHS }).output.find((l) => /total/i.test(l.text))?.text ?? '').includes(27) ? undefined : 'The total has to change when `booths` changes. Add up `booths[i]` in the loop.';
    if (got === 7) return 'The total is only the last booth, because `total = 0` inside the loop wipes it on every pass. Delete that line.';
    if (got === 0) return declaredInLoop(c, 'total') ? '`let total` inside the loop makes a second variable, so the total above the loop stays 0. Leave out the word `let`.' : 'The total stays at 0. Add each booth to it inside the loop.';
    return 'Loop 1 should add every booth to `total`, so type no numbers into the print line.';
  },
  ['Step through loop 1 and watch `total`. It drops back to 0 on each pass.', 'The line that sets `total` to 0 belongs above the loop, and it is already there.', 'Delete the `total = 0;` line that sits inside the loop.'],
);

function boothProblem(c: JsCheckCtx, booths: number[]): string | undefined {
  const r = c.run({ data: { booths } });
  const rows = r.output.filter((l) => /booth/i.test(l.text));
  if (!rows.length) return r.error ? BROKE : 'Keep the line inside loop 2 that prints each booth.';
  const fixed = fixedStop(c);
  if (rows.some((l) => l.text.includes('undefined'))) return fixed ? 'Loop 2 stops at a fixed number, so it fails on a shorter list. Use `booths.length` in the condition.' : 'The last line says `undefined`, because `i <= booths.length` reads one past the end. Use `i < booths.length`.';
  if (!numbersIn(rows[0].text).includes(booths[0])) return 'Booth 1 is missing, because the loop skips the first item. Start `i` at 0.';
  if (rows.length < booths.length) return fixed ? 'Loop 2 stops at a fixed number, so it fails on a longer list. Use `booths.length` in the condition.' : 'The last booth is missing. The loop should run while `i < booths.length`.';
  return rows.length === booths.length ? undefined : 'Print one line for each booth.';
}

export const REPORT_BOOTHS = check(
  'report-booths',
  'Fix loop 2, so that it stops at the last booth',
  (c) => boothProblem(c, THREE_BOOTHS.booths) ?? boothProblem(c, SIX_BOOTHS.booths),
  ['Read the note about loop 2 under the output, and look at the last line it printed.', 'An array of 4 items has indexes 0 to 3.', 'Change `i <= booths.length` to `i < booths.length`.'],
);

export const REPORT_LIGHTS = check(
  'report-lights',
  'Fix loop 3, so that the lights go out',
  (c) => {
    const r = c.run();
    if (r.status === 'limit') {
      if (c.assigned('lights').length) return 'The loop still never ends. `lights` has to go down by 25 on every pass until it reaches 0.';
      return '`lights - 25` works out an answer and throws it away, so `lights` stays at 100 forever. Write `lights = lights - 25;`.';
    }
    if (r.error) return BROKE;
    const runs = passesOf(c, r, 'lights');
    if (!runs) return 'Loop 3 has to run, so keep the loop and its condition `lights > 0`. The lights should go from 100 to 0.';
    if (runs !== 4) return `Loop 3 ran ${runs} ${runs === 1 ? 'time' : 'times'}. Dimming by 25 from 100 takes 4 passes, so change \`lights\` by 25 on each pass.`;
    const fifty = c.run({ data: { lights: 50 } });
    if (!fifty.dataMissing.length && passesOf(c, fifty, 'lights') !== 2) return 'Loop 3 should depend on `lights`, so that a lower starting value takes fewer passes.';
    return /lights out/i.test(lastOf(r.output)?.text ?? '') ? undefined : 'Keep `Lights out` as the last line, after the loop.';
  },
  ['Look at the stop message under the output. It tells you what stayed the same.', 'The line inside the loop works out an answer and never saves it.', 'Change `lights - 25;` to `lights = lights - 25;`.'],
);

// --- step 8: build a new array -----------------------------------------------

export const FINALS_START = script(`let players = ["Maya", "Dev", "Priya", "Sam", "Zoe", "Eli"];
let scores = [140, 85, 110, 60, 100, 95];

// Make a new array named finalists, then print it after the loop.
`);

const ROUND = { players: ['Ana', 'Bo', 'Cy', 'Di', 'Eli'], scores: [100, 99, 150, 3, 101] };
const ROUND_NAMES = ['Ana', 'Cy', 'Eli'];
const NO_ONE = { players: ['Ana', 'Bo'], scores: [1, 2] };
const NO_PLAYERS = { players: [], scores: [] };

export const FINALISTS = check(
  'finalists',
  'Build finalists with everyone who scored 100 or more',
  (c) => {
    if (declaredInLoop(c, 'finalists')) return '`let finalists = []` is inside the loop, so a new empty array starts on every pass. Move it above the loop.';
    if (hasNote(c, 'assign-push')) return '`push` changes the array and gives back its new length, so `finalists = finalists.push(...)` replaces your array with a number. Write `finalists.push(...);` with no `finalists =` in front.';
    const r = c.run({ data: ROUND });
    if (r.dataMissing.length) return keepName(r.dataMissing[0]);
    if (r.error) return BROKE;
    if (r.status === 'limit') return SPUN;
    const got = r.vars.finalists;
    if (!Array.isArray(got)) return 'Make an array named `finalists` above the loop: `let finalists = [];`.';
    if (!passes(r)) return c.loops().some((l) => /[<>]=?\s*(players|scores)\s*$/.test(l.test ?? '')) ? '`i < players` compares a number with a whole array, so the loop never runs. Use `i < players.length`.' : 'Use a loop to go through the players, and `push` each finalist.';
    if (same(got, ROUND_NAMES)) {
      if (!same(c.run({ data: NO_ONE }).vars.finalists, [])) return 'When nobody scores 100, `finalists` should stay empty. Use `scores` in the condition.';
      return same(c.run({ data: NO_PLAYERS }).vars.finalists, []) ? undefined : 'With no players, `finalists` should stay empty.';
    }
    if (same(got, [0, 2, 4])) return 'You pushed the index `i`, not the player at that index. Write `finalists.push(players[i]);`.';
    if (same(got, [100, 150, 101])) return 'You pushed the scores. `finalists` should hold the names, so write `finalists.push(players[i]);`.';
    if (got.some((x) => Array.isArray(x))) return 'You pushed the whole `players` array. Push one name: `finalists.push(players[i]);`.';
    if (same(got, ROUND.players)) return 'Everyone made the finals. Put the `push` inside an `if` that checks for a score of 100 or more.';
    if (same(got, ['Cy', 'Eli'])) return 'A score of exactly 100 makes the finals too. Use `>=`, not `>`.';
    if (!got.length && c.loops().some((l) => l.kind === 'for-of')) return 'A `for...of` loop hands you each name without its index, and the score sits at the same index in `scores`. Use `for (let i = 0; i < players.length; i++)`, so that `i` works on both arrays.';
    return '`finalists` should hold the name of each player whose score is 100 or more.';
  },
  ['The two arrays match up by index: `scores[i]` belongs to `players[i]`.', 'Start with `let finalists = [];` above the loop. Inside the loop, use an `if` on `scores[i]`.', 'Write `if (scores[i] >= 100) { finalists.push(players[i]); }` inside the loop.'],
);

export const SHOW_FINALISTS = check(
  'show-finalists',
  'Print finalists after the loop',
  (c) => {
    const r = c.run({ data: ROUND });
    const rows = r.output.filter((l) => l.text.includes(ROUND_NAMES[0]));
    if (rows.some((l) => rows.filter((x) => x.line === l.line).length > 1)) return '`finalists` printed on every pass, because that `console.log` is inside the loop. Move it below the closing `}`.';
    return ROUND_NAMES.every((n) => r.output.some((l) => l.text.includes(n))) ? undefined : 'After the loop, write `console.log(finalists);`.';
  },
  ['Code below the closing `}` of the loop runs after the array is finished.', 'After the loop, write `console.log(finalists);`.'],
);

// --- optional extra challenge: nested loops ----------------------------------

export const TABLE_START = script(`let size = 4;

// Print a times table with size rows and size columns.
`);

const tableFor = (n: number) => Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, k) => (r + 1) * (k + 1)));

export const TOKEN_TABLE = check(
  'token-table',
  'Print the times table, one row on each line',
  (c) => {
    const r = c.run({ data: { size: 3 } });
    if (r.dataMissing.length) return keepName('size');
    if (r.error) return BROKE;
    if (r.status === 'limit') return SPUN;
    const rows = r.output.map((l) => numbersIn(l.text));
    if (same(rows, tableFor(3))) return same(c.run({ data: { size: 5 } }).output.map((l) => numbersIn(l.text)), tableFor(5)) && same(c.run({ data: { size: 1 } }).output.map((l) => numbersIn(l.text)), tableFor(1)) ? undefined : 'Use `size` in both loops, so that the table changes when `size` does.';
    if (!rows.length) return 'Print one line for each row of the table.';
    if (rows.length === 9) return 'Each number printed on its own line, because `console.log` is inside the inner loop. Build one row in a string, and print the string after the inner loop.';
    if (rows[0][0] === 0) return 'Your table starts at 0. Start both loops at 1, so that the first row is `1 2 3`.';
    if (rows.length === 3 && rows[1].length === 6) return 'Each row keeps the numbers from the row above. Start the string over inside the outer loop, with `let row = "";` above the inner loop.';
    return 'With `size` set to 3, the table should print `1 2 3`, then `2 4 6`, then `3 6 9`.';
  },
  ['An outer loop picks the row. An inner loop goes across that row.', 'Inside the outer loop, start with `let row = "";`. The inner loop adds `r * k + " "` to `row`.', 'Print `row` after the inner loop ends, inside the outer loop: `for (let r = 1; r <= size; r++) { let row = ""; for (let k = 1; k <= size; k++) { row = row + r * k + " "; } console.log(row); }`.'],
);
