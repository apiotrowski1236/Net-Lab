import type { JsCheck, JsSpec } from '../../demos/types';
import { demoFact } from '../helpers';
import { md } from '../md';
import type { GoalDef, LabDef } from '../types';
import * as code from './code';

/**
 * JavaScript Arrays (Intro CS). A lesson with no network: the stage holds a
 * JavaScript editor (src/demos/js.ts), and src/js runs the code in the browser.
 * Plan: PLAN.md.
 */

/** A goal met when one of a demo's checks passes. */
const passed = (demo: string, check: JsCheck): GoalDef => ({
  id: check.id,
  label: `${check.label}.`,
  check: demoFact(demo, (f) => f[`check:${check.id}`] === true),
});

/** One goal for each check, in the order the checks run. */
const eachCheck = (demo: JsSpec) => (demo.checks ?? []).map((c) => passed(demo.id, c));

const warmup: JsSpec = { kind: 'js', id: 'warmup', title: 'Your first playlist', files: code.WARMUP, step: true, checks: [code.LOG_PLAYLIST] };
const make: JsSpec = { kind: 'js', id: 'make', title: 'Three arrays', files: code.MAKE, step: true, report: true, checks: [code.OPENERS, code.TICKETS, code.REQUESTS] };
const read: JsSpec = { kind: 'js', id: 'read', title: 'The first hour', files: code.READ, step: true, report: true, checks: [code.THIRD, code.COUNT, code.LAST] };
const change: JsSpec = { kind: 'js', id: 'change', title: 'New plans', files: code.CHANGE, step: true, report: true, checks: [code.SECOND, code.LAST_SPOT, code.VOTE] };
const edges: JsSpec = { kind: 'js', id: 'edges', title: 'During the dance', files: code.EDGES, step: true, report: true, checks: [code.POP, code.PUSH, code.SHIFT, code.UNSHIFT] };
const search: JsSpec = { kind: 'js', id: 'search', title: 'Check the request', files: code.SEARCH, step: true, report: true, checks: [code.POSITION, code.NOT_FOUND] };
const program: JsSpec = { kind: 'js', id: 'program', title: 'Song requests', files: code.PROGRAM, step: true, report: true, checks: [code.LIST, code.ASK, code.ADD, code.NO_REPEAT, code.SHOW_LIST, code.HOW_MANY] };
const remove: JsSpec = { kind: 'js', id: 'remove', title: 'Remove a request', files: code.REMOVE, step: true, report: true, checks: [code.TAKE_OFF, code.NOT_THERE, code.SHOW_LEFT] };
const pick: JsSpec = { kind: 'js', id: 'pick', title: 'A surprise song', files: code.PICK_START, step: true, report: true, checks: [code.PICK] };

export const jsArraysLab: LabDef = {
  id: 'js-arrays',
  version: 2,
  title: 'JavaScript Arrays: The Dance Playlist',
  tagline: 'Run the music for the spring dance: build a playlist in an array, change it, search it, and write your own request line.',
  // Intro CS has no units, and the Guide prints none for unit 0.
  unit: 0,
  codehs: [],
  ced: [],
  minutes: 45,
  objectives: [
    'Create arrays of strings and numbers, including an empty array',
    'Read and change items by index, and find the last item with length',
    'Add and remove items with push, pop, unshift, and shift',
    'Search an array with includes and indexOf, and use an array in a program with prompt()',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'warmup',
      title: 'Meet the editor',
      body: md`
        You are running the music for the spring dance. Your playlist is an **array**: one variable that holds a list of items, in order, inside square brackets. Before we start on the playlist, try each part of this editor.

        1. Press **Run**. Your program's output appears in the **Output** panel. An \`alert\` prints there too, and no popup opens in this editor.
        2. Press **Hint** under the code. Each press shows one more clue for your current task. Hints never cost you points. The checks go in order, so each one waits for the check above it.
        3. \`console.log\` is another way to print. Put what you want to print between its parentheses. Print \`playlist\` under the \`alert\` line, then press **Run**.
        4. Press **Step through**, then press **Next** until the program ends. The blue line runs next, and the yellow line ran last. Watch \`playlist\` appear under **Variables** as a row of numbered boxes. Press **Stop** to go back to editing.
      `,
      demos: [warmup],
      goals: [
        { id: 'ran', label: 'Press Run.', check: demoFact('warmup', (f) => (f.runs as number) > 0) },
        // A student who finishes the print first has no Hint button left to press, so that counts too.
        { id: 'hint', label: 'Press Hint once.', check: demoFact('warmup', (f) => (f.hints as number) > 0 || f[`check:${code.LOG_PLAYLIST.id}`] === true) },
        passed('warmup', code.LOG_PLAYLIST),
        { id: 'stepped', label: 'Step through the program to the end.', check: demoFact('warmup', (f) => f.finished === true) },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'make',
      title: 'Make three arrays',
      body: md`
        The dance needs three arrays. Text in quote marks is called a **string**, and numbers have no quote marks. Single and double quotes work the same way, so **Output** may show different quote marks than your code. Change the code so that:

        1. \`openers\` has three songs. You choose the third song.
        2. \`ticketsSold\` is an array of the numbers 40, 55, 62, and 71, in that order.
        3. \`requests\` is an empty array, because nobody has asked for a song yet.
      `,
      demos: [make],
      goals: eachCheck(make),
    },

    // -----------------------------------------------------------------------
    {
      id: 'read',
      title: 'Read the playlist',
      body: md`
        Every item in an array has a number called its **index**. Those are the small numbers you saw over the boxes in step 1. Indexes start at 0, so these 5 songs have the indexes 0, 1, 2, 3, and 4. \`playlist[0]\` reads the first song, and \`playlist.length\` gives the number of items.

        First, find the question below **Goals**, at the bottom of this step, and answer it. A wrong guess costs no points, and the feedback explains the answer. Then add to the program so that it prints:

        1. the third song
        2. how many songs are on the playlist
        3. the last song. Its index is one less than the length, so put that math inside the square brackets.

        Use \`playlist.length\` for tasks 2 and 3, so that your code still works after more songs are added.
      `,
      demos: [read],
      goals: eachCheck(read),
      questions: [
        {
          id: 'past-end',
          kind: 'choice',
          prompt: 'This playlist has 5 songs. What does `console.log(playlist[5]);` print?',
          options: [
            { id: 'last', text: 'Hallway Echo', feedback: 'Hallway Echo is the fifth song, and it sits at index 4, because indexes start at 0.' },
            { id: 'undefined', text: 'undefined', correct: true },
            { id: 'error', text: 'An error', feedback: 'The program keeps running. An index with no item gives a value that means "nothing here".' },
            { id: 'first', text: 'Neon Lockers', feedback: 'An index does not wrap around to the start of the array.' },
          ],
          explain: 'The indexes run from 0 to 4, so index 5 has no item, and you get undefined. That is why the last item is at `playlist.length - 1`.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'change',
      title: 'Change songs on the list',
      body: md`
        Some plans changed. To change an item, use \`=\` with its index: \`votes[0] = 20;\` puts 20 in the first spot. To add to an item, start from the number already there: \`votes[0] = votes[0] + 5;\` adds 5.

        1. Replace the second song with "Thunder Gym".
        2. Replace the last song with "Parking Lot Stars". Use \`playlist.length\` to find its index.
        3. One more person voted for the third song. Add 1 to its number in \`votes\`.

        \`playlist\` and \`votes\` are both \`const\`, and that is fine here. \`const\` means the variable can never hold a different array, so \`votes = [1, 2];\` is an error. The items inside the array can still change.
      `,
      demos: [change],
      goals: eachCheck(change),
    },

    // -----------------------------------------------------------------------
    {
      id: 'edges',
      title: 'Add and remove songs',
      body: md`
        The playlist keeps changing during the dance. A **method** is an action that belongs to a value, like an array. You use it with a dot after the name. These four methods add or remove one item. "Gives back" means you can save the result in a variable.

        - \`playlist.push(x)\` adds \`x\` to the end.
        - \`playlist.pop()\` removes the last item and gives it back.
        - \`playlist.unshift(x)\` adds \`x\` to the front.
        - \`playlist.shift()\` removes the first item and gives it back.

        Make these four changes, in this order. Press **Step through** to watch the boxes change.

        1. The last song was canceled. Remove it with \`pop\`, and print the song you removed.
        2. Someone requested "Thunder Gym". Add it to the end with \`push\`.
        3. The first song finished playing. Remove it with \`shift\`, and print that song.
        4. "Senior Sunset" plays next. Add it to the front with \`unshift\`.
      `,
      demos: [edges],
      goals: eachCheck(edges),
    },

    // -----------------------------------------------------------------------
    {
      id: 'search',
      title: 'Check a request',
      body: md`
        Requests are coming in, and \`request\` holds what a student typed. The method \`indexOf\` searches an array:

        - \`playlist.indexOf("last bell")\` gives back 2, the index of that song.
        - \`playlist.indexOf("polka time")\` gives back **-1**, because that song is not in the array. No item has the index -1, so -1 means "not found".

        \`indexOf\` is **case sensitive**, which means capital letters count: "Last Bell" does not match "last bell". That is why the code already changes the request to lowercase.

        Save the index with \`let spot = playlist.indexOf(request);\`. Then use \`if\` and \`else\` so that the program prints one of two answers:

        1. If \`spot\` is not -1, print the song's number on the list, counting from 1, like \`That song is number 3.\` The test is \`spot !== -1\`, and \`!==\` means "is not".
        2. Otherwise, print \`Not on the playlist yet.\`

        When text and math share a line, put parentheses around the math: \`"That song is number " + (spot + 1)\`. Without them, \`+\` glues the numbers onto the text, so a \`spot\` of 2 prints as number 21.

        Run your program with a song on the list, then with a song that is not. The checks also try other songs. A goal can turn green before you test it. Then find the question below **Goals**, at the bottom of this step, and answer it.
      `,
      demos: [search],
      goals: eachCheck(search),
      questions: [
        {
          id: 'missing-song',
          kind: 'choice',
          prompt: '"polka time" is not on the playlist. What does this code print?\n\n```\nlet spot = playlist.indexOf("polka time");\nconsole.log("That song is number " + (spot + 1) + ".");\n```',
          options: [
            { id: 'zero', text: 'That song is number 0.', correct: true },
            { id: 'minus', text: 'That song is number -1.', feedback: '`spot` is -1, and the code adds 1 to it before it prints.' },
            { id: 'undefined', text: 'That song is number undefined.', feedback: '`indexOf` always gives back a number. For a song it cannot find, that number is -1.' },
            { id: 'error', text: 'An error', feedback: 'The program keeps running. `indexOf` gives back -1, and the code carries on with that number.' },
          ],
          explain: '`indexOf` gave -1, and -1 + 1 is 0, so the program prints a song number that makes no sense. That is why your code has to check for -1 before it uses the number.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'program',
      title: 'Write the song request program',
      body: md`
        Now write a whole program yourself: the song requests for the dance. You need two new methods:

        - \`requests.includes(song)\` gives back \`true\` if the song is in the array, and \`false\` if it is not. Capital letters count here too.
        - \`requests.join(", ")\` gives back all the songs as one string, with a comma and a space between them.

        Your program should:

        1. Make an array named \`requests\` with at least three songs.
        2. Use \`prompt\` to ask for a song.
        3. If the song is already in \`requests\`, print a message that says so. If it is not, add it to the end.
        4. In both cases, print the whole list with \`join\`.
        5. In both cases, print how many songs are on the list.

        Try it yourself with a new song, then with a song that is already on your list, typed exactly the same. The checks also try both. A goal can turn green before you test it.
      `,
      demos: [program],
      goals: eachCheck(program),
    },

    // -----------------------------------------------------------------------
    {
      id: 'reflect',
      title: 'Reflection',
      body: md`
        Use what you practiced in this lab. Your answer below goes to your teacher.
      `,
      questions: [
        {
          id: 'explain',
          kind: 'text',
          prompt: 'A friend missed this lesson. Explain these two problems to them, using the words index and length.\n\n1. They wrote `playlist[playlist.length]` to get the last song. What goes wrong, and how do they fix it?\n2. They printed `playlist.indexOf("polka time")` and got -1. What does -1 mean, and what should their code do before it uses that number?',
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

        Finished early? After you hand in, press **Optional extra challenge** for two more steps: removing a song by name, and picking a song at random.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'remove',
      title: 'Optional extra challenge: Take a song off the list',
      extra: true,
      body: md`
        A student no longer wants their song, so your program needs to remove a song by name.

        \`splice\` removes items from anywhere in an array. For example, \`requests.splice(2, 1)\` goes to index 2 and removes 1 item.

        Add to the program so that it:

        1. finds the song with \`indexOf\`, and saves the index in \`spot\`
        2. removes the song with \`splice\` if it is on the list, or prints a message if it is not
        3. prints the list with \`join\`

        Be careful with -1 here. In \`splice\`, a negative index counts back from the end, so \`requests.splice(-1, 1)\` removes the last song. Test for -1 before you call \`splice\`, with \`if (spot === -1)\`. \`===\` means "is equal to", the opposite of \`!==\`.
      `,
      demos: [remove],
      goals: eachCheck(remove),
    },

    // -----------------------------------------------------------------------
    {
      id: 'pick',
      title: 'Optional extra challenge: Pick a song at random',
      extra: true,
      body: md`
        The DJ wants a surprise song. Print one song picked at random.

        \`Math.random()\` gives a random decimal from 0 up to, but not including, 1. Multiplying it by \`playlist.length\` stretches it to the size of the list, and \`Math.floor\` rounds it down. With 5 songs, 0.73 × 5 is 3.65, which rounds down to 3. Even 0.99 × 5 is 4.95, which rounds down to 4, so the pick never reaches 5.

        That makes \`Math.floor(Math.random() * playlist.length)\` a good index every time. Save it in a variable, then print the song at that index. Press **Run** several times to see the pick change.
      `,
      demos: [pick],
      goals: eachCheck(pick),
    },
  ],
};
