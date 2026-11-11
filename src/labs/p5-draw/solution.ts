import type { DemoInput } from '../../demos/types';
import type { LabSolution, Move } from '../solution';

/** Answer key for p5-draw. Every move goes through the same model the editor uses. */

const on = (demo: string, ...inputs: DemoInput[]): Move[] => inputs.map((input) => ({ demo, input }));
const edit = (demo: string, code: string) => on(demo, { edit: 'sketch.js', code }, { run: true });

export const CANVAS_DONE = `function setup() {
  createCanvas(400, 400);
  background("skyblue");
  circle(200, 200, 100);
}
`;

export const LIGHT_DONE = `function setup() {
  createCanvas(400, 400);
  background("skyblue");

  // The box of the traffic light
  rect(150, 50, 100, 300);

  // Three circles go here, one above the other, inside the box.
  circle(200, 110, 70);
  circle(200, 200, 70);
  circle(200, 290, 70);
}
`;

export const PAINT_DONE = `function setup() {
  createCanvas(400, 400);
  background("skyblue");
  strokeWeight(4);

  // The box of the traffic light
  fill("dimgray");
  rect(150, 50, 100, 300);

  // The lights
  fill("red");
  circle(200, 110, 70);
  fill("yellow");
  circle(200, 200, 70);
  fill("green");
  circle(200, 290, 70);
}
`;

export const PICTURE_DONE = `function setup() {
  createCanvas(400, 400);
  background("white");

  // The sky and the grass
  noStroke();
  fill("lightskyblue");
  rect(0, 0, 400, 260);
  fill("seagreen");
  rect(0, 260, 400, 140);

  // The sun
  fill("gold");
  circle(330, 70, 80);

  // The house
  fill("tan");
  rect(110, 170, 160, 130);
  fill("firebrick");
  triangle(100, 170, 190, 90, 280, 170);
  fill("saddlebrown");
  rect(170, 230, 40, 70, 4);
}
`;

export const FACE_DONE = `let x = 100;
let y = 200;

function setup() {
  createCanvas(400, 400);
  background("lavender");

  // The face
  fill("gold");
  circle(x, y, 160);

  // The eyes
  fill("black");
  circle(x - 30, y - 20, 20);
  circle(x + 30, y - 20, 20);

  // The mouth
  line(x - 30, y + 40, x + 30, y + 40);
}
`;

export const STAMP_DONE = `function setup() {
  createCanvas(400, 400);
  background("lavender");
  drawFace(80, 200, "gold");
  drawFace(200, 200, "pink");
  drawFace(320, 200, "lightgreen");
}

function drawFace(x, y, skin) {
  fill(skin);
  circle(x, y, 100);
  fill("black");
  circle(x - 20, y - 10, 12);
  circle(x + 20, y - 10, 12);
  line(x - 20, y + 25, x + 20, y + 25);
}
`;

export const p5DrawSolution: LabSolution = {
  canvas: { moves: edit('canvas', CANVAS_DONE) },
  shapes: { moves: edit('light', LIGHT_DONE) },
  color: { moves: edit('paint', PAINT_DONE) },
  picture: { moves: edit('picture', PICTURE_DONE) },
  move: { moves: edit('face', FACE_DONE) },
  reflect: {
    text: {
      'own-picture': 'The roof triangle was the hardest, because it has three corners. I drew the house on paper and wrote the x and y of each corner. To move the picture 50 pixels right I would add 50 to every x number. With an x variable I would change one number and every shape would move together.',
    },
  },
  stamp: { moves: edit('stamp', STAMP_DONE) },
};
