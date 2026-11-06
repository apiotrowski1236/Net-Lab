import type { DemoInput } from '../../demos/types';
import type { LabSolution, Move } from '../solution';
import { WATCH_STEPS } from './index';

/** Answer key for js-loops. Every move goes through the same model the editor uses. */

const on = (demo: string, ...inputs: DemoInput[]): Move[] => inputs.map((input) => ({ demo, input }));
const edit = (file: string, code: string): DemoInput => ({ edit: file, code });
const write = (code: string): DemoInput[] => [edit('script.js', code), { run: true }];

export const COUNTDOWN = `let count = 10;
while (count >= 0) {
  console.log(count);
  count = count - 1;
}
console.log("Doors open!");
`;

export const PRIZES = `let maxPrice = 300;
let total = 0;

for (let price = 50; price <= maxPrice; price = price + 50) {
  console.log(price);
  total = total + price;
}

console.log(total);
`;

export const DOOR = `let code = prompt("What is the door code?");

while (code !== "pixel") {
  code = prompt("That is not the code. Try again.");
}

console.log("Welcome to Arcade Night!");
`;

/** A first try with the usual bug: a prompt() string never equals a number. The key presses Stop to get out of it. */
export const GUESS_STRINGS = `let secret = Math.floor(Math.random() * 10) + 1;

let guess = prompt("Guess a number from 1 to 10");
while (guess !== secret) {
  guess = prompt("Guess again");
}
`;

export const GUESS = `let secret = Math.floor(Math.random() * 10) + 1;

let guess = Number(prompt("Guess a number from 1 to 10"));
let guesses = 1;
while (guess !== secret) {
  if (guess > secret) {
    console.log("Too high");
  } else {
    console.log("Too low");
  }
  guess = Number(prompt("Guess again"));
  guesses = guesses + 1;
}
console.log("You got it in " + guesses + " guesses");
`;

export const DOUBLE = `let tokens = [30, 12, 45, 8, 25];

for (let i = 0; i < tokens.length; i++) {
  tokens[i] = tokens[i] * 2;
}
console.log(tokens);
`;

export const SCORES = `let scores = [85, -20, 140, 60, 110, -5];

let best = scores[0];
for (let i = 0; i < scores.length; i++) {
  if (scores[i] > best) {
    best = scores[i];
  }
}
console.log(best);
`;

export const REPORT = `let booths = [40, 15, 25, 20];

// Loop 1: add up the tokens from every booth.
let total = 0;
for (let i = 0; i < booths.length; i++) {
  total = total + booths[i];
}
console.log("Total: " + total);

// Loop 2: print the tokens from each booth.
for (let i = 0; i < booths.length; i++) {
  console.log("Booth " + (i + 1) + ": " + booths[i]);
}

// Loop 3: lower the lights by 25 until they are off.
let lights = 100;
while (lights > 0) {
  lights = lights - 25;
}
console.log("Lights out");
`;

export const FINALS = `let players = ["Maya", "Dev", "Priya", "Sam", "Zoe", "Eli"];
let scores = [140, 85, 110, 60, 100, 95];

let finalists = [];
for (let i = 0; i < players.length; i++) {
  if (scores[i] >= 100) {
    finalists.push(players[i]);
  }
}
console.log(finalists);
`;

export const TABLE = `let size = 4;

for (let r = 1; r <= size; r++) {
  let line = "";
  for (let c = 1; c <= size; c++) {
    line = line + r * c + " ";
  }
  console.log(line);
}
`;

/** Next presses on the broken report, which reach the end of loop 1's third pass. */
const WATCH = Array.from({ length: WATCH_STEPS }, (_, i): DemoInput => ({ seek: i + 1 }));

export const jsLoopsSolution: LabSolution = {
  countdown: { moves: on('countdown', { run: true }, ...write(COUNTDOWN)) },
  prizes: { moves: on('prizes', ...write(PRIZES)) },
  door: { moves: on('door', ...write(DOOR), { answer: 'open' }, { answer: 'pixel' }) },
  // The second Run's secret is 8.
  guess: { moves: on('guess', ...write(GUESS_STRINGS), { answer: '5' }, { stop: true }, ...write(GUESS), { answer: '5' }, { answer: '9' }, { answer: '8' }) },
  double: { moves: on('double', ...write(DOUBLE)) },
  scores: { moves: on('scores', ...write(SCORES)) },
  report: { moves: on('report', { stepping: true }, ...WATCH, { stepping: false }, { run: true }, ...write(REPORT)) },
  finals: { moves: on('finals', ...write(FINALS)) },
  reflect: {
    text: {
      'which-loop': 'They should use while for the die, because nobody knows how many rolls it takes. My bug was a total that stayed at the last number. Step through showed it going back to 0 on every pass.',
    },
  },
  table: { moves: on('table', ...write(TABLE)) },
};
