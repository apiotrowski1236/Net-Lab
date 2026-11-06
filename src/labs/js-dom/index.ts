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
  // The student's CSS follows them through the lab. Each step has a new page, so it gets a new script.
  ...(after ? { from: { step: after[0], demo: after[1], files: ['style.css'] } } : {}),
});

export const jsDomLab: LabDef = {
  id: 'js-dom',
  version: 2,
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
        This editor has three tabs. **index.html** is the page, **style.css** is its look, and **script.js** is your code. You can only read the HTML here, so changes to the page come from your script. After each **Run**, your page shows above the output.

        1. Open **index.html**, and read the ids on the heading and the paragraph under it.
        2. In **script.js**, put your name in the heading.
        3. Change the paragraph under the heading to a sentence about you.
        4. Change how the heading looks. Set a style on it, or add the class \`highlight\` from **style.css**.
        5. Scroll down to the question at the bottom of this step, and answer it.

        A reminder from the lecture:

        \`\`\`js
        let box = document.getElementById("box");
        box.textContent = "New words";
        box.style.color = "gold";
        box.classList.add("big");
        \`\`\`

        An id goes in the quotes with no \`#\`.
      `,
      demos: [
        editor('hello', code.HELLO_PAGE, code.HELLO_SCRIPT, [code.TITLE, code.TAGLINE, code.LOOK]),
      ],
      goals: [
        passed('hello', code.TITLE, 'Put your name in the big heading.', 'Set `title.textContent` to your name, in quotes.'),
        passed('hello', code.TAGLINE, 'Change the paragraph under the heading.', 'Its id is `tagline`. Find it the same way, then set its `textContent`.'),
        passed('hello', code.LOOK, 'Change how the heading looks.', 'Try `title.classList.add("highlight");`'),
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
      id: 'one',
      title: 'Add one new element',
      body: md`
        Each step starts with a new script and a new page. Your work from earlier steps stays saved.

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

        Here, \`list\` is the element that holds the new item. In your code, that is \`about\`.
      `,
      demos: [
        editor('one', code.ONE_PAGE, code.ONE_SCRIPT, [code.NEW_ELEMENT, code.NEW_TEXT], ['hello', 'hello']),
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
        2. Write a loop that adds one \`<li>\` to the list for each string. The three lines from the last step go inside the loop, with \`li\` in place of \`p\`.
        3. Add one more string to the array, and press **Run**. The page gets a new item, and the HTML stays the same.
        4. Scroll down to the question at the bottom of this step, and answer it.
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
          prompt: 'Adding an element that is already on the page moves it, and does not make a copy. A friend moves the line with createElement above the loop, so one element is made before the loop starts. Their array has 3 strings. What shows on the page?',
          options: [
            { id: 'three', text: 'Three items', feedback: 'The loop runs three times, but there is only one element, and each pass moves it.' },
            { id: 'one', text: 'One item, with the last string', correct: true },
            { id: 'first', text: 'One item, with the first string', feedback: 'Each pass sets the text again, so the first string gets replaced.' },
            { id: 'error', text: 'An error', feedback: 'No error appears. A browser moves the element, and that is why this mistake is hard to find.' },
          ],
          explain: 'Each pass changes the text of that one element, so the last string is left. createElement makes one element each time it runs. To get three items, it has to run three times, so it goes inside the loop.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'grid',
      title: 'Let a loop do the work',
      body: md`
        By hand, a grid of 144 squares would take 144 lines of HTML.

        1. Write a loop that runs \`count\` times, with \`i\` as its counter.
        2. Inside the loop, make a new \`div\` and store it in a variable named \`cell\`.
        3. Give \`cell\` the class \`cell\`, and add it to \`grid\`.
        4. Give the squares different colors. Put these two lines inside your loop:

        \`\`\`js
        let color = "hsl(" + i * 5 + ", 80%, 60%)";
        cell.style.backgroundColor = color;
        \`\`\`

        **hsl** is a way to write a color. Its first number picks a spot on the color wheel, from 0 to 360. Past 360, the colors start over.

        5. Change \`count\` to 400, and press **Run**.

        Above your page, read how many elements your script made and how many lines of code it took. Blank lines and comments do not count.
      `,
      demos: [editor('grid', code.GRID_PAGE, code.GRID_SCRIPT, [code.CELLS, code.COLORS, code.MANY], ['list', 'list'])],
      goals: [
        passed('grid', code.CELLS, 'Make as many squares as count says.', 'Use `i < count` in the loop, and add the class `cell` to each `div`.'),
        passed('grid', code.COLORS, 'Give the squares different colors.', 'Use the two lines in the instructions, inside the loop.'),
        passed('grid', code.MANY, 'Change count to 400.', 'The loop stays the same. Only the first line changes.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'every',
      title: 'Change every match',
      body: md`
        \`document.querySelector\` finds only the first match. \`document.querySelectorAll\` finds every match, and you can loop over the matches like an array. Both take a CSS selector, like \`"h2"\` or \`".big"\`.

        1. Find every \`h2\` on the page.
        2. In a loop, add the class \`accent\` to each one.

        A reminder of how to loop over the matches:

        \`\`\`js
        let items = document.querySelectorAll("p");
        for (let i = 0; i < items.length; i++) {
          items[i].classList.add("big");
        }
        \`\`\`
      `,
      demos: [editor('every', code.EVERY_PAGE, code.EVERY_SCRIPT, [code.EVERY], ['grid', 'grid'])],
      goals: [
        passed('every', code.EVERY, 'Change every h2 on the page.', 'Use `document.querySelectorAll("h2")` and a loop.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'cards',
      title: 'Build your own cards',
      body: md`
        Write this one on your own. Choose a section for your own site: projects, books, places, or teams. Two arrays that line up by index are called **parallel arrays**, so \`titles[0]\` goes with \`details[0]\`.

        1. Make two parallel arrays with at least 3 items each.
        2. Loop through them. For each index, make a \`div\` with the class \`card\`, an \`h3\` for the title, and a \`p\` for the detail.
        3. Use \`appendChild\` to add the \`h3\` and the \`p\` to the card. A new element can hold other new elements.
        4. Add the card to the element with the id \`cards\`.

        Each card should end up like this:

        \`\`\`html
        <div class="card">
          <h3>Chess club</h3>
          <p>Meets on Tuesdays</p>
        </div>
        \`\`\`
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
        Think about the personal website you built in HTML. Your answer below goes in the report for your teacher.
      `,
      questions: [
        {
          id: 'own-site',
          kind: 'text',
          prompt: 'Name one section of your own website that you could build with an array and a loop.\n\n1. What would the array hold?\n2. What would the loop make?\n3. Why is that better than typing the HTML by hand?',
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

        Finished early? After you hand in, press **Optional extra challenge** for two more steps: a table of contents built from the page, and a button that adds to the page each time someone clicks it.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'contents',
      title: 'Optional extra challenge: a table of contents',
      extra: true,
      body: md`
        A **table of contents** is a list of the sections on a page. This page has an empty one under **On this page**, and your script already finds it and the headings.

        1. Write a loop over \`headings\`.
        2. In each pass, add an \`<li>\` to \`toc\` with that heading's text.

        \`textContent\` reads text as well as sets it, so \`headings[i].textContent\` gives you that heading's text.
      `,
      demos: [editor('contents', code.CONTENTS_PAGE, code.CONTENTS_SCRIPT, [code.CONTENTS], ['cards', 'cards'])],
      goals: [
        passed('contents', code.CONTENTS, 'Build the table of contents from the headings.', 'In the loop, make an `<li>`, copy the heading\'s `textContent`, and add it to `toc`.'),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'more',
      title: 'Optional extra challenge: a button that adds squares',
      extra: true,
      body: md`
        A page can run code when someone clicks. \`addEventListener\` takes the kind of event and a function, and the function runs on each click. Your script already has this shape.

        1. Inside the function, make one \`div\` with the class \`cell\`, and add it to \`grid\`.
        2. Give it a color you choose, like \`"gold"\`. This function has no loop, so there is no \`i\` to use.
        3. Press **Run**, then click **Add a square** on your page a few times.
      `,
      demos: [editor('more', code.MORE_PAGE, code.MORE_SCRIPT, [code.ADDS], ['cards', 'cards'])],
      goals: [
        passed('more', code.ADDS, 'Add one square for each click.', 'Put `createElement` and `appendChild` inside the function.'),
        { id: 'clicked', label: 'Click the button on your page.', hint: 'Press **Run**, then click **Add a square** on your page.', check: demoFact('more', (f) => (f.clicks as number) > 0 && f['check:adds'] === true) },
      ],
    },
  ],
};
