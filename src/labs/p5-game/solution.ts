import type { DemoInput } from '../../demos/types';
import type { LabSolution, Move } from '../solution';
import { TIMER_START, WIN_START } from './code';

/** Answer key for p5-game. Every move goes through the same model the editor uses. */

const on = (demo: string, ...inputs: DemoInput[]): Move[] => inputs.map((input) => ({ demo, input }));
const edit = (demo: string, code: string) => on(demo, { edit: 'sketch.js', code }, { run: true });

const ARROWS = `  if (keyIsDown(RIGHT_ARROW)) {
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
`;

export const KEYS_DONE = `let x = 200;
let y = 200;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("midnightblue");

  // Move the player with the arrow keys.
${ARROWS}
  // The player
  fill("gold");
  circle(x, y, 40);
}
`;

export const WALLS_DONE = `let x = 200;
let y = 200;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("midnightblue");

  // Move the player with the arrow keys.
${ARROWS}
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

  // The player
  fill("gold");
  circle(x, y, 40);
}
`;

export const TARGET_DONE = WIN_START[0].text.replace('  // Win at 5 here.\n\n', '');

export const WIN_DONE = WIN_START[0].text.replace(
  '  // Win at 5 here.\n',
  `  // Win at 5 here.
  if (score >= 5) {
    textSize(48);
    text("You win!", 100, 210);
    noLoop();
  }
`,
);

export const TIMER_DONE = TIMER_START[0].text.replace(
  '  // The timer goes here.\n',
  `  // The timer goes here.
  if (frameCount % 60 === 0) {
    timeLeft = timeLeft - 1;
  }
  textSize(24);
  text("Time: " + timeLeft, 270, 35);
  if (timeLeft <= 0) {
    textSize(48);
    text("Time's up!", 80, 210);
    noLoop();
  }
`,
);

export const p5GameSolution: LabSolution = {
  keys: { moves: edit('keys', KEYS_DONE) },
  walls: { moves: edit('walls', WALLS_DONE) },
  target: { moves: edit('target', TARGET_DONE) },
  win: { moves: edit('win', WIN_DONE) },
  reflect: {
    text: {
      game: 'My code finds the distance between the middle of the player and the middle of the target with dist. When it is less than 35, the circles touch, so it adds 1 to the score and moves the target. To make it harder I would make the target smaller or move it every few seconds. Next I would add an enemy that chases the player.',
    },
  },
  timer: { moves: edit('timer', TIMER_DONE) },
};
