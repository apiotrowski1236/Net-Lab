import type { DemoInput } from '../../demos/types';
import type { LabSolution, Move } from '../solution';

/** Answer key for p5-move. Every move goes through the same model the editor uses. */

const on = (demo: string, ...inputs: DemoInput[]): Move[] => inputs.map((input) => ({ demo, input }));
const edit = (demo: string, code: string) => on(demo, { edit: 'sketch.js', code }, { run: true });

export const FOLLOW_DONE = `function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("black");
  circle(mouseX, mouseY, 40);
}
`;

export const SLIDE_DONE = `let x = 0;
let y = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("black");
  circle(x, 200, 50);
  x = x + 3;
  circle(200, y, 50);
  y = y + 2;
}
`;

export const WRAP_DONE = `let x = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("black");
  circle(x, 200, 50);
  x = x + 3;
  if (x > width) {
    x = 0;
  }
}
`;

export const BOUNCE_DONE = `let x = 200;
let speed = 3;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("black");
  circle(x, 200, 50);
  x = x + speed;
  if (x > width - 25) {
    speed = -3;
  }
  if (x < 25) {
    speed = 3;
  }
}
`;

export const PRESS_DONE = `let x = 200;
let speed = 3;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  if (mouseIsPressed) {
    background("navy");
    fill("tomato");
  } else {
    background("black");
    fill("white");
  }
  circle(x, 200, 50);
  x = x + speed;
  if (x > width - 25) {
    speed = -3;
  }
  if (x < 25) {
    speed = 3;
  }
}
`;

export const CORNERS_DONE = `let x = 200;
let y = 100;
let xSpeed = 3;
let ySpeed = 2;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background("black");
  circle(x, y, 50);
  x = x + xSpeed;
  y = y + ySpeed;

  if (x > width - 25) {
    xSpeed = -3;
    fill(random(255), random(255), random(255));
  }
  if (x < 25) {
    xSpeed = 3;
    fill(random(255), random(255), random(255));
  }
  if (y > height - 25) {
    ySpeed = -2;
    fill(random(255), random(255), random(255));
  }
  if (y < 25) {
    ySpeed = 2;
    fill(random(255), random(255), random(255));
  }
}
`;

export const p5MoveSolution: LabSolution = {
  follow: { moves: edit('follow', FOLLOW_DONE) },
  slide: { moves: edit('slide', SLIDE_DONE) },
  wrap: { moves: edit('wrap', WRAP_DONE) },
  bounce: { moves: edit('bounce', BOUNCE_DONE) },
  press: { moves: edit('press', PRESS_DONE) },
  reflect: {
    text: {
      motion: 'draw() runs again and again, about 60 times a second, and each run draws one frame. A variable like x goes at the top so it keeps its value between frames instead of starting over. Next I would make a fish tank where fish swim back and forth and turn around at the glass, using a speed variable and ifs.',
    },
  },
  corners: { moves: edit('corners', CORNERS_DONE) },
};
