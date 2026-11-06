import type { JsCheck, JsSpec } from '../../demos/types';
import { demoFact } from '../helpers';
import { md } from '../md';
import type { GoalDef, LabDef } from '../types';
import * as code from './code';

/**
 * Loops at Arcade Night (Intro CS). A lesson with no network: the stage holds a
 * JavaScript editor (src/demos/js.ts), and each step's checks live in code.ts.
 * Students come from a lecture on loops and the arrays lab. Plan: PLAN.md.
 */

/** A goal met when one of a demo's checks passes. */
const passed = (demo: string, check: JsCheck, label: string): GoalDef => ({
  id: check.id,
  label,
  check: demoFact(demo, (f) => f[`check:${check.id}`] === true),
});

const countEditor: JsSpec = { kind: 'js', id: 'countdown', title: 'The countdown', files: code.COUNT_START, step: true, checks: [code.COUNTS_DOWN, code.DOORS_OPEN] };
const prizeEditor: JsSpec = { kind: 'js', id: 'prizes', title: 'The prize wall', files: code.PRIZES_START, step: true, checks: [code.PRICES, code.PRIZE_TOTAL] };
const doorEditor: JsSpec = { kind: 'js', id: 'door', title: 'The door code', files: code.DOOR_START, step: true, checks: [code.KEEPS_ASKING, code.WELCOME] };
const guessEditor: JsSpec = { kind: 'js', id: 'guess', title: 'The guessing game', files: code.GUESS_START, step: true, report: true, checks: [code.GAME_ENDS, code.GAME_HINTS, code.GAME_COUNT, code.SECRET_RANDOM] };
const doubleEditor: JsSpec = { kind: 'js', id: 'double', title: 'Double-token hour', files: code.DOUBLE_START, step: true, report: true, checks: [code.DOUBLED], lintOff: ['index-at-length'] };
const scoreEditor: JsSpec = { kind: 'js', id: 'scores', title: 'The laser tag scoreboard', files: code.SCORES_START, step: true, report: true, checks: [code.TOP_SCORE] };
const reportEditor: JsSpec = { kind: 'js', id: 'report', title: 'The end-of-night report', files: code.REPORT_START, step: true, report: true, checks: [code.REPORT_TOTAL, code.REPORT_BOOTHS, code.REPORT_LIGHTS], lintOff: ['reset-in-loop', 'index-at-length', 'while-unchanged', 'result-unused'] };
const finalsEditor: JsSpec = { kind: 'js', id: 'finals', title: 'The finals list', files: code.FINALS_START, step: true, report: true, checks: [code.FINALISTS, code.SHOW_FINALISTS] };
const tableEditor: JsSpec = { kind: 'js', id: 'table', title: 'The token table', files: code.TABLE_START, step: true, report: true, checks: [code.TOKEN_TABLE] };

/** Far enough in the report's step-through to see `total` start over on three passes. */
export const WATCH_STEPS = 14;

export const jsLoopsLab: LabDef = {
  id: 'js-loops',
  version: 3,
  title: 'Loops at Arcade Night',
  tagline: 'Write the loops behind a school Arcade Night: a countdown, a door code, a guessing game, and a scoreboard. Then fix a report full of broken loops.',
  unit: 0,
  codehs: [],
  ced: [],
  minutes: 45,
  objectives: [
    'Write while and for loops that count up, count down, and count by steps, and choose the loop that fits',
    'Keep a running total and a counter, and repeat a prompt until the answer is acceptable',
    'Walk an array by index, find the largest value, and build a new array with push',
    'Fix broken loops with the output, the stop message, and Step through',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'countdown',
      title: 'Count down to the doors',
      body: md`
        Our school is holding an Arcade Night fundraiser, and you are writing the code for it. Remember that \`console.log\` prints a line in the output panel without a popup.

        The night starts with a countdown. One time through a loop is called a **pass**.

        1. Press **Run** to see what this loop prints. The check will show a red X at first.
        2. Change the loop so that it counts down from 10 to 0.
        3. After the loop, print \`Doors open!\`.
      `,
      demos: [countEditor],
      goals: [passed('countdown', code.COUNTS_DOWN, 'Count down from 10 to 0.'), passed('countdown', code.DOORS_OPEN, 'Print Doors open! after the loop.')],
    },

    // -----------------------------------------------------------------------
    {
      id: 'prizes',
      title: 'Price the prize wall',
      body: md`
        Players spend tokens on prizes. The prize wall has one prize every 50 tokens, and the most expensive prize costs \`maxPrice\` tokens. This \`for\` loop counts by 1, so it prints far too many prices.

        1. Scroll down to the question at the bottom of this step. Answer it before you change the loop.
        2. Fix the loop so that it prints 50, 100, 150, and so on, up to \`maxPrice\`. The first line of a \`for\` loop is its **header**, and the last part of the header says how the variable changes after each pass.
        3. Add up all the prices, and print that total after the loop. Use a **running total**: a variable that starts at 0 above the loop. On each pass, add the price to it.

        To add to a variable, you can write \`score = score + 5\` or the short form \`score += 5\`.
      `,
      demos: [prizeEditor],
      goals: [passed('prizes', code.PRICES, 'Print every price, counting up by 50.'), passed('prizes', code.PRIZE_TOTAL, 'Print the total of all the prices.')],
      questions: [
        {
          id: 'passes',
          kind: 'choice',
          prompt: 'Once the loop counts by 50 from 50 up to 300, how many times will it run?',
          options: [
            { id: '5', text: '5', feedback: 'List the prices and count them: 50, 100, 150, 200, 250, 300. Subtracting 50 from 300 and dividing by 50 leaves out the first price.' },
            { id: '6', text: '6', correct: true },
            { id: '7', text: '7', feedback: 'The loop stops as soon as the price passes 300, so 350 never prints. List the prices and count them.' },
            { id: '250', text: '250', feedback: 'That is how many passes it takes when counting by 1. Counting by 50 lands on far fewer prices.' },
          ],
          explain: 'The prices are 50, 100, 150, 200, 250, and 300, so the loop runs 6 times. The check price <= 300 runs a seventh time and comes back false, which ends the loop.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'door',
      title: 'Guard the door',
      body: md`
        Everyone needs the door code to get in, and the code is \`pixel\`. This program has a problem: an \`if\` asks only one more time.

        1. Press **Run** and give two wrong answers. Notice that the program lets you in anyway.
        2. Change the code so that it keeps asking until the answer is \`pixel\`.

        We use \`while\` here because nobody knows how many tries a person will need. A \`for\` loop fits better when you know the count ahead of time.

        To end a run that keeps asking, press **Stop** on the prompt. A real browser has no **Stop** button there. **Cancel** counts as a wrong answer.
      `,
      demos: [doorEditor],
      goals: [passed('door', code.KEEPS_ASKING, 'Keep asking until the answer is pixel.'), passed('door', code.WELCOME, 'Print the welcome after the loop.')],
    },

    // -----------------------------------------------------------------------
    {
      id: 'guess',
      title: 'Build the guessing game',
      body: md`
        The first booth is a guessing game. The variable \`secret\` holds a random number from 1 to 10. Write the rest of the game:

        1. Ask for a guess with \`prompt()\`.
        2. Keep asking until the guess matches \`secret\`.
        3. After each wrong guess, print \`Too high\` or \`Too low\`.
        4. After the loop, print how many guesses it took. Use a **counter**, which is a running total that adds 1 each time.

        \`prompt()\` gives back a string, even when the player types a number:

        \`\`\`js
        "5" === 5   // false
        5 === 5     // true
        \`\`\`

        Every \`prompt()\` in this game needs \`Number()\`, like this: \`Number(prompt("Your guess"))\`.
      `,
      demos: [guessEditor],
      goals: [
        passed('guess', code.GAME_ENDS, 'Keep asking until the guess matches secret.'),
        passed('guess', code.GAME_HINTS, 'Print Too high or Too low after each wrong guess.'),
        passed('guess', code.GAME_COUNT, 'Print how many guesses it took.'),
        passed('guess', code.SECRET_RANDOM, 'Leave the line that picks secret as it is.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'double',
      title: 'Double the tokens',
      body: md`
        It is double-token hour at the prize wall, so every player's tokens double.

        1. Double every number inside \`tokens\`.
        2. After the loop, print \`tokens\`.

        Here are two ways to loop over an array. \`list\` stands for any array, and \`i++\` is a short form of \`i = i + 1\`.

        \`\`\`js
        // Use this when you change the array
        // or need the index.
        for (let i = 0; i < list.length; i++) {
          console.log(list[i]);
        }

        // Use this when you only read each item.
        // item is a new variable, so changing it
        // leaves the array the same.
        for (let item of list) {
          console.log(item);
        }
        \`\`\`
      `,
      demos: [doubleEditor],
      goals: [passed('double', code.DOUBLED, 'Double every number inside tokens, and print tokens.')],
    },

    // -----------------------------------------------------------------------
    {
      id: 'scores',
      title: 'Find the top laser tag score',
      body: md`
        In laser tag, a hit adds points and getting tagged takes points away, so a score can drop below 0.

        Print the top score. Keep the top score so far in a variable named \`best\`, and compare each score with it.

        Your code has to work on other lists too, including a list where every score is negative.
      `,
      demos: [scoreEditor],
      goals: [passed('scores', code.TOP_SCORE, 'Print the top score.')],
    },

    // -----------------------------------------------------------------------
    {
      id: 'report',
      title: 'Fix the end-of-night report',
      body: md`
        Last year's volunteer left us this end-of-night report, and each of its three loops has a bug.

        1. Press **Step through**, then press **Next** until you reach Move 15. Watch what happens to \`total\` on the first three passes.
        2. Press **Stop**, then press **Run**. One loop never ends, so this editor stops it. A real browser tab would freeze.
        3. Read the output from the top, and read the stop message. Then fix all three loops.

        While you step, blue is the line that runs next, and yellow is the line that ran last. In **Step through**, the move count stops at 2000, because one loop never ends.
      `,
      demos: [reportEditor],
      goals: [
        {
          id: 'watched',
          label: 'Step through loop 1 and watch total.',
          hint: 'Press **Step through**, then press **Next** until you reach Move 15.',
          check: demoFact('report', (f) => (f.far as number) >= WATCH_STEPS),
        },
        passed('report', code.REPORT_TOTAL, 'Fix loop 1.'),
        passed('report', code.REPORT_BOOTHS, 'Fix loop 2.'),
        passed('report', code.REPORT_LIGHTS, 'Fix loop 3.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'finals',
      title: 'Pick the finalists',
      body: md`
        Anyone who scored 100 or more moves on to the final round. Each score belongs to the player at the same index, so Maya scored 140.

        Start with an empty array named \`finalists\`. In a loop, use \`push\` to add the name of each player who scored 100 or more. Print \`finalists\` after the loop.
      `,
      demos: [finalsEditor],
      goals: [passed('finals', code.FINALISTS, 'Build finalists.'), passed('finals', code.SHOW_FINALISTS, 'Print finalists after the loop.')],
    },

    // -----------------------------------------------------------------------
    {
      id: 'reflect',
      title: 'Reflection',
      body: md`
        Think back over the loops you wrote for Arcade Night. Your answer below goes to your teacher.
      `,
      questions: [
        {
          id: 'which-loop',
          kind: 'text',
          prompt: 'Answer both parts.\n\n1. A friend needs a loop that keeps rolling a number cube until it lands on 6. Should they use `for` or `while`, and why?\n2. Describe one loop bug from this lab and how you found it.',
          minWords: 30,
          lines: 6,
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

        Finished early? After you hand in, press **Optional extra challenge** for one more step: a loop inside a loop.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'table',
      title: 'Optional extra challenge: the token table',
      extra: true,
      body: md`
        The prize desk wants a table of token costs. Each player pays 1 token per game, so 2 players who play 3 games pay 6 tokens. That is row 2, column 3 of the table. With \`size\` set to 3, the table looks like this:

        \`\`\`
        1 2 3
        2 4 6
        3 6 9
        \`\`\`

        Write a loop inside a loop to print the table for any \`size\`. The outer loop picks the row, and the inner loop goes across that row.

        \`console.log\` always ends the line, so build each row in a string: start with \`""\`, add each number and a space, and print the string after the inner loop. The first row grows like this:

        \`\`\`
        ""
        "1 "
        "1 2 "
        "1 2 3 "
        \`\`\`
      `,
      demos: [tableEditor],
      goals: [passed('table', code.TOKEN_TABLE, 'Print the token table.')],
    },
  ],
};
