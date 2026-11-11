import type { JsCheck, JsFile, JsSpec } from '../../demos/types';
import { demoFact } from '../helpers';
import { md } from '../md';
import type { GoalDef, LabDef } from '../types';
import * as code from './code';

/**
 * Draw with Code (Intro CS, p5.js). A lesson with no network: the stage holds
 * a JavaScript editor whose code runs as a p5.js sketch, on a live canvas.
 * src/sketch is the p5.js the code runs against. Plan: PLAN.md.
 */

/** A goal met when one of a demo's checks passes. */
const passed = (demo: string, check: JsCheck, label: string, hint?: string): GoalDef => ({
  id: check.id,
  label,
  hint,
  check: demoFact(demo, (f) => f[`check:${check.id}`] === true),
});

const editor = (id: string, files: JsFile[], checks: JsCheck[], more: Partial<JsSpec> = {}): JsSpec => ({
  kind: 'js',
  id,
  title: 'Your code',
  files,
  checks,
  sketch: true,
  ...more,
});

export const p5DrawLab: LabDef = {
  id: 'p5-draw',
  version: 1,
  title: 'Draw with Code',
  tagline: 'Place shapes on a canvas with p5.js, color them, and draw a picture of your own.',
  unit: 0,
  codehs: [],
  ced: [],
  minutes: 35,
  objectives: [
    'Place shapes on a canvas with x and y, where y counts down from the top',
    'Color shapes with fill() and stroke(), and explain why their order matters',
    'Draw a picture of your own from several shapes',
    'Use variables to move a whole drawing with one change',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'canvas',
      title: 'Meet the canvas',
      body: md`
        **p5.js** is a JavaScript library for drawing. A **library** is code someone else wrote for you to use. In this lab your code is a p5.js **sketch**, and it draws on a **canvas**, a rectangle of pixels on the page.

        Your code has a function named \`setup\`. p5.js runs it once, when the sketch starts. \`createCanvas(400, 400)\` makes a canvas 400 pixels wide and 400 tall, and \`background(220)\` paints it light gray.

        Every spot on the canvas has an **x** and a **y**. x counts from the left edge, and y counts down from the top edge. So the top-left corner is (0, 0), and y gets bigger as you go down. In math class, y goes up, so this takes some getting used to.

        1. Press **Run**. Your canvas shows above the output.
        2. Change the background to a color name in quotes, like \`"skyblue"\`.
        3. Draw a circle in the middle of the canvas. \`circle()\` takes x, y, and the **diameter**, which is how wide the circle is.
        4. Answer the question at the bottom of this step.
      `,
      demos: [editor('canvas', code.CANVAS_START, [code.BACKGROUND, code.MIDDLE])],
      goals: [
        passed('canvas', code.BACKGROUND, 'Change the background color.', 'Try `background("skyblue");`'),
        passed('canvas', code.MIDDLE, 'Draw a circle in the middle of the canvas.', 'The middle of a 400 by 400 canvas is (200, 200).'),
      ],
      questions: [
        {
          id: 'corner',
          kind: 'choice',
          prompt: 'On a 400 by 400 canvas, where does `circle(50, 350, 40)` show up?',
          options: [
            { id: 'tl', text: 'Near the top-left corner', feedback: 'x is 50, so it is near the left edge. But y is 350, and y counts down from the top, so it is near the bottom.' },
            { id: 'tr', text: 'Near the top-right corner', feedback: 'x counts from the left edge, so x = 50 is near the left side, not the right.' },
            { id: 'bl', text: 'Near the bottom-left corner', correct: true },
            { id: 'br', text: 'Near the bottom-right corner', feedback: 'y = 350 is near the bottom. But x = 50 is near the left edge.' },
          ],
          explain: 'x counts from the left edge, and y counts down from the top edge. A small x is near the left, and a big y is near the bottom.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'shapes',
      title: 'Build a traffic light',
      body: md`
        Each step starts with new code. Your work from earlier steps stays saved.

        \`rect(x, y, width, height)\` draws a rectangle. Its x and y are its **top-left corner**. A circle is different: its x and y are its middle.

        1. Read the \`rect()\` line. Work out where the box ends on the right and at the bottom.
        2. Add three circles inside the box, one above the other, so it looks like a traffic light.
        3. Answer the question at the bottom of this step.
      `,
      demos: [editor('light', code.SHAPES_START, [code.BOX, code.LIGHTS])],
      goals: [
        passed('light', code.LIGHTS, 'Put three circles inside the box, one above the other.', 'Give the circles the same x, and different y values between 50 and 350.'),
      ],
      questions: [
        {
          id: 'corner',
          kind: 'choice',
          prompt: 'Where is the bottom-right corner of `rect(150, 50, 100, 300)`?',
          options: [
            { id: 'size', text: '(100, 300)', feedback: 'Those are the width and the height. Add them to the top-left corner: 150 + 100, and 50 + 300.' },
            { id: 'start', text: '(150, 50)', feedback: 'That is the top-left corner, where the rectangle starts.' },
            { id: 'right', text: '(250, 350)', correct: true },
            { id: 'canvas', text: '(400, 400)', feedback: 'That is the bottom-right corner of the canvas. The box is smaller than the canvas.' },
          ],
          explain: 'The box starts at x = 150 and is 100 wide, so it ends at x = 250. It starts at y = 50 and is 300 tall, so it ends at y = 350.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'color',
      title: 'Add color',
      body: md`
        This step starts with your traffic light from the last step.

        \`fill()\` picks the color for the inside of every shape drawn after it. It works like picking up a marker: everything you draw uses that marker until you pick up another one.

        \`stroke()\` picks the color of the outline, and \`strokeWeight()\` sets how thick the outline is, in pixels. \`noStroke()\` turns the outline off.

        A color can be a name in quotes, like \`"red"\`. It can also be three numbers from 0 to 255, for how much red, green, and blue to mix: \`fill(255, 140, 0)\` is orange. CSS colors work too, such as \`"#ff8c00"\`.

        1. Give the box a color, such as \`"dimgray"\`.
        2. Make the top circle red, the middle one yellow, and the bottom one green.
        3. Change the outlines. Make them thicker, give them a color, or turn them off.
        4. Answer the question at the bottom of this step.
      `,
      demos: [editor('paint', code.COLOR_START, [code.BOX_COLOR, code.LIGHT_COLORS, code.OUTLINE], { from: { step: 'shapes', demo: 'light' } })],
      goals: [
        passed('paint', code.BOX_COLOR, 'Give the box a color.', 'Put `fill()` on the line above `rect()`.'),
        passed('paint', code.LIGHT_COLORS, 'Make the lights red, yellow, and green, from the top down.', 'Each circle needs its own `fill()` above it.'),
        passed('paint', code.OUTLINE, 'Change the outlines.', 'Try `strokeWeight(4);` or `noStroke();`'),
      ],
      questions: [
        {
          id: 'marker',
          kind: 'choice',
          prompt: 'What colors are the two circles?\n\n```js\nfill("red");\ncircle(100, 100, 50);\ncircle(200, 100, 50);\nfill("blue");\n```',
          options: [
            { id: 'white', text: 'Red, then white', feedback: 'The fill stays red until the next `fill()` line, so the second circle is red too.' },
            { id: 'blue', text: 'Red, then blue', feedback: '`fill("blue")` comes after both circles. It changes only shapes drawn after it, and there are none.' },
            { id: 'red', text: 'Both red', correct: true },
            { id: 'both', text: 'Both blue', feedback: 'Code runs from top to bottom. When the circles are drawn, the fill is still red.' },
          ],
          explain: 'A fill stays until the next fill(). The fill("blue") line runs last, so it does not change the shapes drawn before it.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'picture',
      title: 'Draw your own picture',
      body: md`
        Now draw something of your own. You could draw a pet, a robot, a face, a house, a city skyline, or a flag. Plan it on paper first, with the x and y of each shape.

        Here are more shapes you can use:

        \`\`\`js
        ellipse(200, 200, 150, 80);             // x, y, width, height
        triangle(200, 50, 150, 150, 250, 150);  // the x and y of 3 corners
        line(0, 300, 400, 300);                 // from (0, 300) to (400, 300)
        rect(50, 50, 100, 60, 10);              // a 5th number rounds the corners
        textSize(32);
        text("Hi!", 20, 50);                    // the words, then x and y
        \`\`\`

        Your picture needs at least 6 shapes, 2 kinds of shape, and 3 colors. Shapes drawn later go on top of earlier ones.
      `,
      demos: [editor('picture', code.PICTURE_START, [code.MANY, code.KINDS, code.COLORS], { report: true })],
      goals: [
        passed('picture', code.MANY, 'Draw at least 6 shapes.'),
        passed('picture', code.KINDS, 'Use at least 2 kinds of shape.'),
        passed('picture', code.COLORS, 'Use at least 3 colors.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'move',
      title: 'Move it with variables',
      body: md`
        To move this face, you would have to change 10 numbers. A variable can hold the face's place instead, so moving it takes one change.

        The variables \`x\` and \`y\` at the top hold the middle of the face. The left eye is 30 to the left of the middle and 20 above it, so it can be \`circle(x - 30, y - 20, 20)\`.

        1. Change the face circle to \`circle(x, y, 160)\`.
        2. Change both eyes and the mouth to use \`x\` and \`y\` too.
        3. Change \`x\` to 100 and press **Run**. The whole face should move to the left.
        4. Answer the question at the bottom of this step.
      `,
      demos: [editor('face', code.MOVE_START, [code.FACE, code.ALL, code.MOVED])],
      goals: [
        passed('face', code.FACE, 'Draw the face circle at x and y.'),
        passed('face', code.ALL, 'Make the eyes and the mouth move with the face.', 'Add to or subtract from `x` and `y`, like `x - 30`.'),
        passed('face', code.MOVED, 'Change x to move the face.'),
      ],
      questions: [
        {
          id: 'eye',
          kind: 'choice',
          prompt: 'The face is `circle(x, y, 160)`, and the left eye is `circle(x - 30, y - 20, 20)`. When x is 100 and y is 300, where is the middle of the left eye?',
          options: [
            { id: 'add', text: '(130, 320)', feedback: 'That adds 30 and 20. The code subtracts them: 100 - 30, and 300 - 20.' },
            { id: 'y', text: '(70, 320)', feedback: 'The x is right. For y, the code has `y - 20`, so it is 300 - 20.' },
            { id: 'face', text: '(100, 300)', feedback: 'That is the middle of the face. The eye is 30 to the left of it and 20 above it.' },
            { id: 'right', text: '(70, 280)', correct: true },
          ],
          explain: 'x - 30 is 100 - 30, which is 70. y - 20 is 300 - 20, which is 280. A smaller y is higher on the canvas, so the eye sits above the middle of the face.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'reflect',
      title: 'Reflection',
      body: md`
        Think about the picture you drew in step 4. Your answer below goes in the report for your teacher.
      `,
      questions: [
        {
          id: 'own-picture',
          kind: 'text',
          prompt: 'Think about your picture from step 4.\n\n1. Which shape was hardest to place, and how did you work out its numbers?\n2. What would you have to change to move your whole picture 50 pixels to the right?\n3. How would variables like `x` and `y` make that faster?',
          minWords: 40,
          lines: 7,
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.

        Finished early? After you hand in, press **Optional extra challenge** for one more step: a function that draws a face anywhere you tell it to.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'stamp',
      title: 'Optional extra challenge: a face function',
      extra: true,
      body: md`
        A function can do the job of the \`x\` and \`y\` variables. \`drawFace\` has two **parameters**, \`x\` and \`y\`. Each call gives them new values, so each call draws a face in a new place.

        1. Call \`drawFace\` two more times in setup, with other numbers, so three faces show and none of them overlap.
        2. Add a mouth inside \`drawFace\`. Every face gets it.
        3. Give \`drawFace\` a third parameter for the face color, and give each face its own color.
      `,
      demos: [editor('stamp', code.STAMP_START, [code.THREE, code.MOUTH, code.OWN_COLORS])],
      goals: [
        passed('stamp', code.THREE, 'Draw three faces that do not overlap.', 'Call `drawFace` three times, with x values at least 100 apart.'),
        passed('stamp', code.MOUTH, 'Give every face a mouth, inside drawFace.'),
        passed('stamp', code.OWN_COLORS, 'Give each face its own color.', 'Add a parameter, and use it in `fill()`.'),
      ],
    },
  ],
};
