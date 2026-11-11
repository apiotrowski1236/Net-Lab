import type { JsCheck, JsFile, JsSpec } from '../../demos/types';
import { demoFact } from '../helpers';
import { md } from '../md';
import type { GoalDef, LabDef } from '../types';
import * as code from './code';

/**
 * Make a Game (Intro CS, p5.js). A lesson with no network: a JavaScript editor
 * whose code runs as a p5.js sketch on a live canvas that takes the keys.
 * Checks play the game in hidden runs. Plan: PLAN.md.
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

export const p5GameLab: LabDef = {
  id: 'p5-game',
  version: 1,
  title: 'Make a Game',
  tagline: 'Build a catch-the-target game in p5.js, with the arrow keys, a score, and a way to win.',
  unit: 0,
  codehs: [],
  ced: [],
  minutes: 40,
  objectives: [
    'Move a player with the arrow keys using keyIsDown()',
    'Keep the player on the canvas with if statements',
    'Find when two circles touch with dist(), and keep score',
    'End the game with a message when the player wins',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'keys',
      title: 'Move with the arrow keys',
      body: md`
        In this lab you build a game in **p5.js**. The player is a gold circle, and you move it with the arrow keys to catch a target.

        \`keyIsDown(RIGHT_ARROW)\` is \`true\` while the right arrow key is held down. p5.js also has \`LEFT_ARROW\`, \`UP_ARROW\`, and \`DOWN_ARROW\`. Since \`draw\` runs about 60 times a second, the player moves 4 pixels in each frame the key is down.

        1. Press **Run**. Click the canvas, then hold the right arrow key. Clicking the canvas sends the keys to your game. Click outside it to get them back.
        2. Add three more ifs, so the left, up, and down arrows move the player too.
        3. Answer the question at the bottom of this step.
      `,
      demos: [editor('keys', code.KEYS_START, [code.ARROW_KEYS])],
      goals: [passed('keys', code.ARROW_KEYS, 'Move the player with all four arrow keys.', 'Copy the if for the right arrow, once for each of the other arrows.')],
      questions: [
        {
          id: 'up',
          kind: 'choice',
          prompt: 'Which line moves the player up?',
          options: [
            { id: 'plus', text: '`y = y + 4;`', feedback: 'y counts down from the top of the canvas, so a bigger y is lower. This line moves the player down.' },
            { id: 'minus', text: '`y = y - 4;`', correct: true },
            { id: 'x', text: '`x = x - 4;`', feedback: 'That changes x, so the player moves left.' },
            { id: 'set', text: '`y = 4;`', feedback: 'That puts the player at y = 4, at the top edge, in one jump. It does not move it a little in each frame.' },
          ],
          explain: 'y counts down from the top, so moving up makes y smaller.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'walls',
      title: 'Stay on the canvas',
      body: md`
        This step starts with your code from the last step.

        Hold an arrow key long enough, and the player leaves the canvas. Use ifs to stop it at the edges. p5.js keeps \`width\` and \`height\` set to the size of the canvas.

        1. Add an if. When x is greater than \`width\`, set x to \`width\`.
        2. Do the same for the left edge, the top, and the bottom. At the left and the top, the edge is 0.
        3. The player is 40 wide, so half of it still goes off. To stop it with its edge on the wall, use \`width - 20\` and 20.
      `,
      demos: [editor('walls', code.WALLS_START, [code.WALLS], { from: { step: 'keys', demo: 'keys' } })],
      goals: [passed('walls', code.WALLS, 'Keep the player on the canvas.', 'Four ifs, one for each edge.')],
    },

    // -----------------------------------------------------------------------
    {
      id: 'target',
      title: 'Catch the target',
      body: md`
        The code that moves the player is now in a function, \`movePlayer\`, at the bottom. \`draw\` calls it, so \`draw\` stays short. The red circle is the target, and \`tx\` and \`ty\` hold its place.

        \`dist(x, y, tx, ty)\` gives the **distance** between the middle of the player and the middle of the target, in pixels.

        Two circles touch when that distance is less than their two **radiuses** added together. A radius is half of a circle's diameter. The player's radius is 20 and the target's is 15, so they touch when the distance is less than 35.

        1. Add an if under **Check for a catch here**. When \`dist(x, y, tx, ty)\` is less than 35, add 1 to \`score\`.
        2. In the same if, move the target to a new place. \`random(30, 370)\` gives a random number from 30 up to 370.
        3. Show the score on the canvas with \`text()\`. \`"Score: " + score\` joins the words and the number.
        4. Press **Run**, click the canvas, and play.
      `,
      demos: [editor('target', code.TARGET_START, [code.CATCH, code.MOVE_TARGET, code.SCORE])],
      goals: [
        passed('target', code.CATCH, 'Add 1 to score when the player touches the target.', 'Use `dist(x, y, tx, ty) < 35` in an if.'),
        passed('target', code.MOVE_TARGET, 'Move the target to a new place after each catch.', 'Set `tx` and `ty` to `random(30, 370)` inside the if.'),
        passed('target', code.SCORE, 'Show the score on the canvas.', 'Try `text("Score: " + score, 20, 30);`'),
      ],
      questions: [
        {
          id: 'touch',
          kind: 'choice',
          prompt: 'A new target has a diameter of 60. The player is still 40 wide. What number should the if compare the distance with now?',
          options: [
            { id: '35', text: '35', feedback: 'That is for a target 30 wide. Add the two radiuses again: half of 40, plus half of 60.' },
            { id: '100', text: '100', feedback: 'That adds the two diameters. Use the radiuses, which are half as big.' },
            { id: '50', text: '50', correct: true },
            { id: '60', text: '60', feedback: 'That is the target\'s diameter. Add the player\'s radius, 20, to the target\'s radius, 30.' },
          ],
          explain: 'The player\'s radius is 20 and the new target\'s radius is 30. They touch when the distance between their middles is less than 20 + 30, which is 50.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'win',
      title: 'Win the game',
      body: md`
        This step starts with your game from the last step.

        A game needs an end. \`noLoop()\` tells p5.js to stop running \`draw\`, so the game freezes on its last frame.

        1. Under **Win at 5 here**, add an if. When \`score\` is 5 or more, show "You win!" with \`text()\`, then call \`noLoop()\`.
        2. Play until you win.
        3. Press **Restart** above the canvas to play again.
        4. Answer the question at the bottom of this step.
      `,
      demos: [editor('win', code.WIN_START, [code.STOPS, code.MESSAGE], { from: { step: 'target', demo: 'target' }, report: true })],
      goals: [
        passed('win', code.STOPS, 'Stop the game when the score reaches 5.', 'Use `if (score >= 5)` and `noLoop()`.'),
        passed('win', code.MESSAGE, 'Show a message when the player wins.'),
      ],
      questions: [
        {
          id: 'frozen',
          kind: 'choice',
          prompt: 'Your code called `noLoop()`, and you hold down an arrow key. What happens?',
          options: [
            { id: 'moves', text: 'The player keeps moving', feedback: 'The code that moves the player is in draw(), and draw() no longer runs.' },
            { id: 'still', text: 'Nothing moves', correct: true },
            { id: 'over', text: 'The game starts over', feedback: 'Nothing starts over by itself. The Restart button runs setup() again.' },
            { id: 'error', text: 'An error shows up', feedback: '`noLoop()` is not an error. It tells p5.js to stop calling draw().' },
          ],
          explain: 'After noLoop(), p5.js stops calling draw(). Moving the player, drawing it, and checking for a catch all happen in draw(), so the game stays frozen.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'reflect',
      title: 'Reflection',
      body: md`
        Think about the game you made. Your answer below goes in the report for your teacher.
      `,
      questions: [
        {
          id: 'game',
          kind: 'text',
          prompt: 'Think about your game.\n\n1. How does your code know that the player caught the target?\n2. What would you change to make the game harder?\n3. What would you add next, and what code would it need?',
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

        Finished early? After you hand in, press **Optional extra challenge** for one more step: a timer that ends the game if you are too slow.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'timer',
      title: 'Optional extra challenge: beat the clock',
      extra: true,
      body: md`
        Give the player 20 seconds to win. The variable \`timeLeft\` starts at 20.

        \`frameCount\` counts the frames since the sketch started, and there are about 60 each second. \`frameCount % 60\` is the **remainder** after dividing by 60, so it is 0 once every 60 frames, about once a second.

        1. Take 1 from \`timeLeft\` when \`frameCount % 60\` is 0.
        2. Show the time left on the canvas, the way the score shows.
        3. When \`timeLeft\` reaches 0, show "Time's up!" and call \`noLoop()\`.
      `,
      demos: [editor('timer', code.TIMER_START, [code.COUNTS, code.TIME_SHOWN, code.TIME_UP])],
      goals: [
        passed('timer', code.COUNTS, 'Count timeLeft down by 1 each second.', 'Use `if (frameCount % 60 === 0)`.'),
        passed('timer', code.TIME_SHOWN, 'Show the time left on the canvas.'),
        passed('timer', code.TIME_UP, 'Stop the game with a message when time runs out.', 'Use `if (timeLeft <= 0)`, `text()`, and `noLoop()`.'),
      ],
    },
  ],
};
