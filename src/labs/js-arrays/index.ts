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
const search: JsSpec = { kind: 'js', id: 'search', title: 'Check the request', files: code.SEARCH, step: true, report: true, checks: [code.IS_BANNED, code.ANY_CAPS, code.POSITION, code.NOT_FOUND] };
const show: JsSpec = { kind: 'js', id: 'show', title: 'The DJ booth', files: code.SHOW, step: true, report: true, checks: [code.JOINED, code.PICK] };
const program: JsSpec = { kind: 'js', id: 'program', title: 'The request line', files: code.PROGRAM, step: true, report: true, checks: [code.LIST, code.ASK, code.ADD, code.NO_REPEAT, code.SHOW_LIST, code.HOW_MANY, code.NEXT_SONG] };
const remove: JsSpec = { kind: 'js', id: 'remove', title: 'Remove a request', files: code.REMOVE, step: true, report: true, checks: [code.TAKE_OFF, code.NOT_THERE, code.SHOW_LEFT] };

export const jsArraysLab: LabDef = {
  id: 'js-arrays',
  version: 1,
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
        You are running the music for the spring dance, and your playlist is an array. Before we start on the playlist, try each part of this editor.

        1. Press **Run**. Your program's output appears in the **Output** panel. An \`alert\` prints there too, and no popup opens in this editor.
        2. Press **Hint** under the code. Each press shows one more clue for your current task. Hints never cost you points.
        3. \`console.log\` is another way to print, and it never opens a popup, even in a real browser. Use it to print \`playlist\` under the \`alert\` line, then press **Run**.
        4. Press **Step through**, then press **Next** until the program ends. Watch \`playlist\` appear under **Variables**. Press **Stop** when you finish.
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
        The dance committee needs three arrays. Change the code so that:

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
        Answer the question below before you write any code. Then add to the program so that it prints:

        1. the third song
        2. how many songs are on the playlist
        3. the last song

        Use \`playlist.length\` for the last two, so that your code still works after more songs are added.
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
      title: 'Change songs in place',
      body: md`
        Some plans changed. \`playlist\` and \`votes\` are both \`const\`, and they can stay that way: \`const\` stops you from assigning a new array to the variable, but you can still change the items inside the array.

        1. Put "Thunder Gym" in place of the second song.
        2. Put "Parking Lot Stars" in place of the last song. Use \`length\` to find its index.
        3. One more person voted for the third song. Add 1 to its number in \`votes\`.
      `,
      demos: [change],
      goals: eachCheck(change),
    },

    // -----------------------------------------------------------------------
    {
      id: 'edges',
      title: 'Add and remove songs',
      body: md`
        The playlist keeps changing during the dance. Make these four changes, in this order:

        1. The last song was canceled. Remove it with \`pop\`, and print the song you removed.
        2. Someone requested "Thunder Gym". Add it to the end with \`push\`.
        3. The first song finished playing. Remove it with \`shift\`, and print that song.
        4. The seniors want "Senior Sunset" next. Add it to the front with \`unshift\`.

        Here is what each method does and what it gives back:

        - \`push(x)\` adds \`x\` to the end and gives back the new length.
        - \`pop()\` removes the last item and gives it back.
        - \`unshift(x)\` adds \`x\` to the front and gives back the new length.
        - \`shift()\` removes the first item and gives it back.
      `,
      demos: [edges],
      goals: eachCheck(edges),
    },

    // -----------------------------------------------------------------------
    {
      id: 'search',
      title: 'Check a request',
      body: md`
        Requests are coming in. The school banned a few songs, and \`request\` holds what a student typed. Both arrays are in lowercase, and \`includes\` and \`indexOf\` are **case sensitive**: "Food Fight" does not match "food fight". \`request.toLowerCase()\` gives you the request in lowercase.

        Use \`if\` and \`else\` so that the program prints one of three answers:

        1. If the request is banned, print \`Sorry, that song is banned.\`
        2. If the request is on the playlist, print its place in line, counting from 1, like \`That song is number 2.\`
        3. Otherwise, print \`Not on the playlist yet.\`

        Run your program a few times with different requests.
      `,
      demos: [search],
      goals: eachCheck(search),
    },

    // -----------------------------------------------------------------------
    {
      id: 'show',
      title: 'Show the list and pick a song',
      body: md`
        The DJ booth needs two more features.

        1. The \`alert\` in the code runs the songs together. Use \`join\` to put a comma and a space between them.
        2. Print one song picked at random. \`Math.random()\` gives a random decimal from 0 up to, but not including, 1. Multiplying it by \`playlist.length\` stretches it to the size of the list, and \`Math.floor\` rounds it down, so \`Math.floor(Math.random() * playlist.length)\` is always a good index.

        Press **Run** several times to see the pick change.
      `,
      demos: [show],
      goals: eachCheck(show),
    },

    // -----------------------------------------------------------------------
    {
      id: 'program',
      title: 'Write the request line',
      body: md`
        Now write a whole program yourself: the request line for the dance. Your program should:

        1. Make an array named \`requests\` with at least three songs.
        2. Use \`prompt\` to ask for a song.
        3. If the song is already in \`requests\`, print a message that says so. If it is not, add it to the end.
        4. Print the whole list with \`join\`.
        5. Print how many songs are on the list.
        6. Pick a random song from the list, and print it as the next song to play.

        Run your program at least twice: once with a new song, and once with a song that is already on your list.
      `,
      demos: [program],
      goals: eachCheck(program),
    },

    // -----------------------------------------------------------------------
    {
      id: 'reflect',
      title: 'Reflection',
      body: md`
        Think back to the mistakes you made or almost made in this lab. Your answer below goes to your teacher.
      `,
      questions: [
        {
          id: 'explain',
          kind: 'text',
          prompt: 'A friend missed this lesson. They wrote `playlist[playlist.length]` to get the last song, and they use `indexOf` to find a song that might not be on the list. Explain what goes wrong in each case, and how to fix it. Use the words index and length, and say what -1 means.',
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

        Finished early? After you hand in, press **Optional extra challenge** for one more step: removing a song by name.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'remove',
      title: 'Optional extra challenge: Take a song off the list',
      extra: true,
      body: md`
        A student changed their mind, so the request line needs to remove a song by name.

        \`splice\` removes items from anywhere in an array. For example, \`requests.splice(2, 1)\` goes to index 2 and removes 1 item.

        Add to the program so that it:

        1. finds the song with \`indexOf\`
        2. removes the song with \`splice\` if it is on the list, or prints a message if it is not
        3. prints the list with \`join\`

        Be careful with -1 here: \`requests.splice(-1, 1)\` removes the last song, so test for -1 before you call \`splice\`.
      `,
      demos: [remove],
      goals: eachCheck(remove),
    },
  ],
};
