import type { JsCheck, JsSpec } from '../../demos/types';
import { pageHosts, pageOfFiles } from '../../dom';
import { demoFact } from '../helpers';
import { md } from '../md';
import type { GoalDef, LabDef } from '../types';
import * as code from './code';

/**
 * Build a Page with JavaScript (Intro CS). A lesson with no network: the stage
 * holds a JavaScript editor with three tabs and a live preview. src/dom gives
 * the code a page to act on, inside the pure model. Plan: PLAN.md.
 */

/** A goal met when one of a demo's checks passes. */
const passed = (demo: string, check: JsCheck, label: string, hint?: string): GoalDef => ({
  id: check.id,
  label,
  hint,
  check: demoFact(demo, (f) => f[`check:${check.id}`] === true),
});

const editor = (id: string, html: string, script: string, checks: JsCheck[], after?: [string, string]): JsSpec => ({
  kind: 'js',
  id,
  title: 'Your code',
  files: code.files(html, script),
  open: 'script.js',
  checks,
  report: true,
  hosts: pageHosts,
  startPage: pageOfFiles,
  // The student's CSS follows them through the lab. Each step gets a new script, so a prompt() from an earlier step doesn't fire on every Run.
  ...(after ? { from: { step: after[0], demo: after[1], files: ['style.css'] } } : {}),
});

export const jsDomLab: LabDef = {
  id: 'js-dom',
  version: 1,
  title: 'Build a Page with JavaScript',
  tagline: 'Find elements, change them, and let a loop build what would take hours to write by hand.',
  unit: 0,
  codehs: [],
  ced: [],
  minutes: 45,
  objectives: [
    'Find elements on a page and change their text and style from a script',
    'Make new elements and add them to the page',
    'Use a loop to turn an array into page content',
    'Use querySelectorAll and a loop to change every matching element',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'hello',
      title: 'Change the page from a script',
      body: md`
        This editor has three tabs: **index.html** is the page, **style.css** is its look, and **script.js** changes it. The HTML is read only in this lab, so every change has to come from your script. After each **Run**, your page shows above the output.

        1. Open **index.html**, and read the ids on the heading and the paragraph under it.
        2. In **script.js**, put your name in the heading.
        3. Change the paragraph under the heading to a sentence about you.

        A reminder from the lecture:

        \`\`\`js
        let box = document.getElementById("box");
        box.textContent = "New words";
        \`\`\`
      `,
      demos: [
        editor('hello', code.HELLO_PAGE, code.HELLO_SCRIPT, [code.TITLE, code.TAGLINE]),
      ],
      goals: [
        passed('hello', code.TITLE, 'Put your name in the big heading.', 'Set `title.textContent` to your name, in quotes.'),
        passed('hello', code.TAGLINE, 'Change the sentence under the heading.', 'Its id is `tagline`. Find it the same way, then set its `textContent`.'),
      ],
      questions: [
        {
          id: 'file',
          kind: 'choice',
          prompt: 'Your script changes the heading. After you press Run, what does the h1 line say in the index.html tab?',
          options: [
            { id: 'same', text: 'It still says Your Name', correct: true },
            { id: 'new', text: 'It says your new text', feedback: 'Open the index.html tab and read the line. A script changes the page in the browser, and the file stays as it was.' },
            { id: 'gone', text: 'The line is gone', feedback: 'The script set the text of the heading, so nothing was removed. Open the index.html tab and read the line.' },
          ],
          explain: 'A script changes the page in the browser, not the file. Every Run starts again from index.html.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'look',
      title: 'Change the look, and greet a visitor',
      body: md`
        1. Change how the heading looks. Set a style on it, or add the class \`highlight\` from **style.css**.
        2. Use \`prompt()\` to ask the visitor's name.
        3. Put a welcome message with that name in the element with the id \`greeting\`.

        A reminder of the two ways to change a look:

        \`\`\`js
        box.style.color = "gold";
        box.classList.add("big");
        \`\`\`
      `,
      demos: [
        editor('look', code.LOOK_PAGE, code.LOOK_SCRIPT, [code.LOOK, code.GREET], ['hello', 'hello']),
      ],
      goals: [
        passed('look', code.LOOK, 'Change how the heading looks.', 'Try `title.classList.add("highlight");`.'),
        passed('look', code.GREET, 'Greet the visitor by name.', 'Store the answer from `prompt()` in a variable, then join it into a message.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'one',
      title: 'Add one new element',
      body: md`
        A script can add elements that were never in the HTML.

        1. Make a new \`<p>\`.
        2. Give it a fact about you as its text.
        3. Add it to the \`about\` section.

        A reminder of the three steps:

        \`\`\`js
        let item = document.createElement("li");
        item.textContent = "New item";
        list.appendChild(item);
        \`\`\`
      `,
      demos: [
        editor('one', code.ONE_PAGE, code.ONE_SCRIPT, [code.NEW_ELEMENT, code.NEW_TEXT], ['look', 'look']),
      ],
      goals: [
        passed('one', code.NEW_ELEMENT, 'Add a new element to the About me section.', 'Make it with `document.createElement`, then add it with `about.appendChild`.'),
        passed('one', code.NEW_TEXT, 'Give the new element some text.', 'Set its `textContent`.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'list',
      title: 'Turn an array into a list',
      body: md`
        This page has an empty list with the id \`favorites\`, and your script has an array.

        1. Change the strings in \`favorites\` to your own favorites.
        2. Write a loop that adds one \`<li>\` to the list for each string.
        3. Add one more string to the array, and press **Run**. The page gets a new item, and the HTML stays the same.
      `,
      demos: [editor('list', code.LIST_PAGE, code.LIST_SCRIPT, [code.ITEMS, code.ONE_MORE], ['one', 'one'])],
      goals: [
        passed('list', code.ITEMS, 'Add one list item for each string in the array.', 'Put `createElement`, `textContent`, and `appendChild` inside a `for` loop.'),
        passed('list', code.ONE_MORE, 'Add one more string to the array.', 'Change only the line that makes `favorites`.'),
      ],
      questions: [
        {
          id: 'once',
          kind: 'choice',
          prompt: 'A friend moves the line with createElement above the loop, so one element is made before the loop starts. The array has 3 strings. What shows on the page?',
          options: [
            { id: 'three', text: 'Three items', feedback: 'The loop runs three times, but there is only one element. Adding an element that is already on the page moves it.' },
            { id: 'one', text: 'One item, with the last string', correct: true },
            { id: 'first', text: 'One item, with the first string', feedback: 'Each pass sets the text again, so the first string gets replaced.' },
            { id: 'error', text: 'An error', feedback: 'No error appears. A browser moves the element, and that is why this mistake is hard to find.' },
          ],
          explain: 'createElement makes one element each time it runs. To get three items, it has to run three times, so it goes inside the loop.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'grid',
      title: 'Let a loop do the work',
      body: md`
        By hand, a grid of 144 squares would take 144 lines of HTML.

        1. Write a loop that runs \`count\` times. Each pass makes a \`div\`, gives it the class \`cell\`, and adds it to \`grid\`.
        2. Give each square its own color with the two lines below, inside your loop. **hsl** is a way to write a color, and its first number picks the shade.
        3. Change \`count\` to 400, and press **Run**.

        \`\`\`js
        let color = "hsl(" + i * 5 + ", 80%, 60%)";
        cell.style.backgroundColor = color;
        \`\`\`

        Read the count above your page, then count the lines in your script.
      `,
      demos: [editor('grid', code.GRID_PAGE, code.GRID_SCRIPT, [code.CELLS, code.COLORS, code.MANY], ['list', 'list'])],
      goals: [
        passed('grid', code.CELLS, 'Make as many squares as count says.', 'Use `i < count` in the loop, and set `className` to `"cell"`.'),
        passed('grid', code.COLORS, 'Give the squares different colors.', 'Use the two lines in the instructions, inside the loop.'),
        passed('grid', code.MANY, 'Change count to 400.', 'The loop stays the same. Only the first line changes.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'every',
      title: 'Change every match',
      body: md`
        \`document.querySelectorAll\` finds every match and gives you a list. This step starts with an empty script.

        1. Find every \`h2\` on the page. In a loop, add the class \`accent\` to each one.
        2. In the same loop, add an \`<li>\` to the list with the id \`toc\`, with that heading's text.

        Your table of contents now comes from the page, so a new heading would appear in it on the next **Run**.
      `,
      demos: [editor('every', code.EVERY_PAGE, code.EVERY_SCRIPT, [code.EVERY, code.CONTENTS], ['grid', 'grid'])],
      goals: [
        passed('every', code.EVERY, 'Change every h2 on the page.', 'Use `document.querySelectorAll("h2")` and a loop.'),
        passed('every', code.CONTENTS, 'Build the table of contents from the headings.', 'In the loop, make an `<li>`, copy the heading\'s `textContent`, and add it to `toc`.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'cards',
      title: 'Build your own cards',
      body: md`
        Write this one on your own. Choose a section for your own site: projects, books, places, or teams. Two arrays that line up by index are called **parallel arrays**, so \`titles[0]\` goes with \`details[0]\`.

        1. Make two parallel arrays with at least 3 items each.
        2. Loop through them. For each index, make a \`div\` with the class \`card\`, with an \`h3\` for the title and a \`p\` for the detail.
        3. Add each card to the element with the id \`cards\`.
      `,
      demos: [editor('cards', code.CARDS_PAGE, code.CARDS_SCRIPT, [code.ARRAYS, code.CARDS, code.FOLLOWS], ['every', 'every'])],
      goals: [
        passed('cards', code.ARRAYS, 'Make two arrays of the same length, with at least 3 items each.', 'One array of titles, and one of details.'),
        passed('cards', code.CARDS, 'Make one card for each item.', 'Use `.length` in the loop, and the class `card`.'),
        passed('cards', code.FOLLOWS, 'Show both values on each card.', 'Use `[i]` on both arrays inside the loop.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'reflect',
      title: 'Reflection',
      body: md`
        Think about the personal website you built in HTML. Your answer below goes to your teacher.
      `,
      questions: [
        {
          id: 'own-site',
          kind: 'text',
          prompt: 'Name one section of your own website that you could build with an array and a loop. Explain what the array would hold, what the loop would make, and why that is better than typing the HTML by hand.',
          minWords: 40,
          lines: 5,
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

        Finished early? After you hand in, press **Optional extra challenge** for one more step: a button that adds to the page each time someone clicks it.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'more',
      title: 'Optional extra challenge: a button that adds squares',
      extra: true,
      body: md`
        A page can run code when someone clicks. \`addEventListener\` takes the kind of event and a function, and the function runs on each click. Your script already has this shape.

        1. Inside the function, make one \`div\` with the class \`cell\` and a color, and add it to \`grid\`.
        2. Press **Run**, then click **Add a square** on your page a few times.
      `,
      demos: [editor('more', code.MORE_PAGE, code.MORE_SCRIPT, [code.ADDS], ['cards', 'cards'])],
      goals: [
        passed('more', code.ADDS, 'Add one square for each click.', 'Put `createElement` and `appendChild` inside the function.'),
        { id: 'clicked', label: 'Click the button on your page.', hint: 'Press **Run**, then click **Add a square** on your page.', check: demoFact('more', (f) => (f.clicks as number) > 0) },
      ],
    },
  ],
};
