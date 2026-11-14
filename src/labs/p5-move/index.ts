import type { JsCheck, JsFile, JsSpec } from '../../demos/types';
import { demoFact } from '../helpers';
import { md } from '../md';
import type { GoalDef, LabDef } from '../types';
import * as code from './code';

/**
 * p5.js: Animation (Intro CS, p5.js). A lesson with no network: a JavaScript
 * editor whose code runs as a p5.js sketch on a live canvas. Checks play the
 * sketch in hidden runs with their own mouse. Plan: PLAN.md.
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

export const p5MoveLab: LabDef = {
  id: 'p5-move',
  version: 1,
  title: 'p5.js: Animation',
  tagline: 'Animate shapes with p5.js: follow the mouse, slide, wrap around, and bounce off the walls.',
  unit: 0,
  codehs: [],
  ced: [],
  minutes: 40,
  objectives: [
    'Explain that draw() runs again and again, about 60 times a second',
    'Use mouseX and mouseY to make a shape follow the mouse',
    'Move a shape by changing a variable a little in every frame',
    'Use if statements to wrap or bounce a shape at the edge of the canvas, and to react to the mouse button',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'follow',
      title: 'Follow the mouse',
      body: md`
        This lab uses **p5.js**, the drawing library from the shapes and color lab. p5.js runs your \`setup\` function once, when the sketch starts. Then it runs a second function, \`draw\`, again and again, about 60 times a second. Each run of \`draw\` makes one **frame**, like one page of a flip book.

        p5.js keeps two variables up to date for you. \`mouseX\` and \`mouseY\` hold where the mouse is on the canvas.

        1. Inside \`draw\`, draw a circle at the mouse: \`circle(mouseX, mouseY, 40);\`
        2. Press **Run**, and move your mouse over the canvas. The circle leaves a trail.
        3. Move \`background("black");\` from \`setup\` into \`draw\`, above the circle. Press **Run** again. Now one circle follows the mouse.
        4. Answer the question at the bottom of this step.
      `,
      demos: [editor('follow', code.FOLLOW_START, [code.FOLLOWS, code.CLEAN])],
      goals: [
        passed('follow', code.FOLLOWS, 'Draw a circle at the mouse.', 'Use `mouseX` and `mouseY` for the circle\'s x and y, inside draw().'),
        passed('follow', code.CLEAN, 'Paint the background in every frame.', 'Move `background()` to the top of draw().'),
      ],
      questions: [
        {
          id: 'trail',
          kind: 'choice',
          prompt: 'Before you moved `background()` into draw(), why did the circle leave a trail?',
          afterGoals: true,
          options: [
            { id: 'once', text: 'draw() ran only once', feedback: 'draw() runs about 60 times a second. That is why there were so many circles.' },
            { id: 'stay', text: 'Nothing painted over the old circles', correct: true },
            { id: 'fast', text: 'The mouse moved too fast', feedback: 'Moving slowly leaves a trail too. Each frame adds a circle wherever the mouse is.' },
            { id: 'extra', text: 'background() drew extra circles', feedback: 'background() paints the whole canvas one color. In setup(), it ran only once, at the start.' },
          ],
          explain: 'Each frame drew a new circle where the mouse was. With background() in setup(), the canvas was painted only once, so every old circle stayed. With background() at the top of draw(), each frame starts on a clean canvas.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'slide',
      title: 'Make it slide',
      body: md`
        Each step starts with new code. Your work from earlier steps stays saved.

        A shape moves when its x changes from one frame to the next. The variable \`x\` is made at the top of the code, outside \`draw\`, so it keeps its value from frame to frame.

        1. In \`draw\`, below the circle, add \`x = x + 3;\`. This takes x, adds 3, and puts the answer back in x.
        2. Press **Run**. The circle slides to the right, then goes off the edge. You fix that in the next step.
        3. Add a second circle that slides down. Make a variable \`y\` at the top, draw a circle at \`(200, y)\`, and add to \`y\` in each frame.
        4. Answer the question at the bottom of this step.
      `,
      demos: [editor('slide', code.SLIDE_START, [code.SLIDES, code.DOWN])],
      goals: [
        passed('slide', code.SLIDES, 'Make the circle slide to the right.', 'Add `x = x + 3;` in draw(), below the circle.'),
        passed('slide', code.DOWN, 'Make a second circle slide down.', 'Make `let y = 0;` at the top, and add to it in draw().'),
      ],
      questions: [
        {
          id: 'top',
          kind: 'choice',
          prompt: 'Why does `let x = 0;` go at the top of the code, outside draw()?',
          options: [
            { id: 'keep', text: 'So x keeps its value from frame to frame', correct: true },
            { id: 'read', text: 'p5.js only reads variables at the top', feedback: 'Variables inside draw() work too. But a `let` inside draw() is made again in each frame, so x would start over at 0 every time.' },
            { id: 'left', text: 'So the circle starts at the left edge', feedback: 'The 0 does that, wherever the line is. Where the line goes decides whether x starts over in every frame.' },
            { id: 'cannot', text: 'Variables cannot go inside functions', feedback: 'They can. But a variable made inside draw() is made new each time draw() runs, about 60 times a second.' },
          ],
          explain: 'draw() runs about 60 times a second. A `let` inside it would be made new each time, at 0, so the circle would never move. Made at the top, x is made once and keeps growing.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'wrap',
      title: 'Come back around',
      body: md`
        The circle slides off the canvas and never comes back. An \`if\` statement can send it back to the left edge.

        p5.js keeps another variable up to date: \`width\` holds the width of the canvas. Here that is 400.

        1. In \`draw\`, after the line that changes x, add an \`if\`. When x is greater than \`width\`, set x back to 0.
        2. Press **Run**, and watch the circle go around again and again.
        3. Answer the question at the bottom of this step.

        \`\`\`js
        if (x > width) {
          // set x back to 0 here
        }
        \`\`\`
      `,
      demos: [editor('wrap', code.WRAP_START, [code.WRAPS])],
      goals: [passed('wrap', code.WRAPS, 'Send the circle back to the left edge.', 'When `x > width`, set x to 0.')],
      questions: [
        {
          id: 'width',
          kind: 'choice',
          prompt: 'You change the canvas to `createCanvas(600, 400)`, and your if still checks `x > width`. Where does the circle turn back to the left edge now?',
          options: [
            { id: '400', text: 'At x = 400', feedback: 'width is not always 400. p5.js sets it to the width of the canvas, which is now 600.' },
            { id: '600', text: 'At x = 600', correct: true },
            { id: 'never', text: 'It never comes back', feedback: 'x keeps growing, so it passes 600 too, and then the if sends it back.' },
            { id: '300', text: 'At x = 300', feedback: '300 is the middle. width is the whole width of the canvas.' },
          ],
          explain: 'p5.js sets width to the canvas width. With width in your if, the circle wraps at the right edge for any size of canvas. A typed 400 would be wrong as soon as the canvas changes.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'bounce',
      title: 'Bounce off the walls',
      body: md`
        To bounce, the circle has to turn around. The variable \`speed\` holds how far it moves in each frame. When speed is 3, x grows, and the circle moves right. When speed is -3, x shrinks, and it moves left.

        1. Add an \`if\`. When x is greater than \`width\`, set speed to -3.
        2. Add a second \`if\`. When x is less than 0, set speed to 3.
        3. Press **Run**. The circle should bounce back and forth.
        4. Look closely. Half of the circle goes past each wall before it turns. Change your ifs so it turns as soon as its edge touches the wall. The circle is 50 wide, so its edge is 25 from its middle.
      `,
      demos: [editor('bounce', code.BOUNCE_START, [code.RIGHT, code.LEFT, code.EDGE])],
      goals: [
        passed('bounce', code.RIGHT, 'Turn around at the right wall.', 'When `x > width`, set speed to -3.'),
        passed('bounce', code.LEFT, 'Turn around at the left wall too.', 'When `x < 0`, set speed to 3.'),
        passed('bounce', code.EDGE, 'Turn as soon as the edge of the circle touches a wall.', 'Use `width - 25` and 25.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'press',
      title: 'Click to change it',
      body: md`
        This step starts with your bouncing circle.

        \`mouseIsPressed\` is another variable p5.js keeps up to date. It is \`true\` while the mouse button is down, and \`false\` the rest of the time.

        1. In \`draw\`, above the circle, add an if and an else. If \`mouseIsPressed\`, fill with one color. Else, fill with another.
        2. Press **Run**. Then press and hold the mouse button on the canvas.
        3. Make one more thing change while the button is down, like the size of the circle or the background color.
      `,
      demos: [editor('press', code.PRESS_START, [code.PRESS_COLOR, code.PRESS_MORE], { from: { step: 'bounce', demo: 'bounce' }, report: true })],
      goals: [
        passed('press', code.PRESS_COLOR, 'Change the color while the mouse button is down.', 'Use `if (mouseIsPressed)` and an else, above the circle.'),
        passed('press', code.PRESS_MORE, 'Change one more thing while the mouse button is down.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'reflect',
      title: 'Reflection',
      body: md`
        Think about everything that moved in this lab. Your answer below goes in the report for your teacher.
      `,
      questions: [
        {
          id: 'motion',
          kind: 'text',
          prompt: 'Think about what you made in this lab.\n\n1. What does draw() do, and how often?\n2. Why does a variable like `x` go at the top of your code?\n3. Describe a sketch you would like to make next. What would move in it, and what would make it move?',
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

        Finished early? After you hand in, press **Optional extra challenge** for one more step: a ball that bounces off all four walls and changes color.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'corners',
      title: 'Optional extra challenge: bounce in two directions',
      extra: true,
      body: md`
        This ball bounces left and right. Make it bounce up and down at the same time, so it moves at an angle around the canvas.

        1. Add \`ySpeed\` to \`y\` in each frame.
        2. Bounce off the top and the bottom walls. \`height\` holds the height of the canvas.
        3. Each time the ball bounces, give it a new color. \`random(255)\` gives a random number from 0 up to 255, so \`fill(random(255), random(255), random(255))\` mixes a random color.
      `,
      demos: [editor('corners', code.CORNERS_START, [code.Y_MOVES, code.Y_BOUNCE, code.NEW_COLOR])],
      goals: [
        passed('corners', code.Y_MOVES, 'Move the ball up and down too.'),
        passed('corners', code.Y_BOUNCE, 'Bounce off the top and the bottom.', 'Copy the two ifs for x, and change them to use y, ySpeed, and `height`.'),
        passed('corners', code.NEW_COLOR, 'Pick a new color each time the ball bounces.', 'Call `fill()` inside the ifs.'),
      ],
    },
  ],
};
