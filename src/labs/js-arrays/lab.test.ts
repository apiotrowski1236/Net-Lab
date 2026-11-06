import { describe, expect, test } from 'vitest';
import { firstUnmet, jsModel, traceOf, type JsState } from '../../demos/js';
import type { JsSpec } from '../../demos/types';
import { LabSession } from '../../runtime/session';
import { buildReport } from '../../store/report';
import { playStep } from '../solution';
import { jsArraysLab as lab } from './index';
import { CHANGE_DONE, EDGES_DONE, jsArraysSolution, MAKE_DONE, PROGRAM_DONE, READ_DONE, PICK_DONE, REMOVE_DONE, SEARCH_DONE, WARMUP_DONE } from './solution';

const spec = (step: string, demo = step): JsSpec => lab.steps.find((s) => s.id === step)!.demos!.find((d) => d.id === demo) as JsSpec;

/** A student's Run of this code, answering each prompt in turn. */
function attempt(step: string, code: string, answers: (string | null)[] = []): JsState {
  const s = spec(step);
  let state = jsModel.apply(s, jsModel.init(s), { edit: 'script.js', code });
  state = jsModel.apply(s, state, { run: true });
  for (const answer of answers) state = jsModel.apply(s, state, { answer });
  return state;
}

const note = (s: JsState) => s.checks?.find((c) => !c.ok)?.note;
const lint = (s: JsState) => s.notes?.map((n) => n.text);
const help = (s: JsState) => s.last?.error?.help;

/** Each row: what the student typed, then the note they read, word for word. */
type Row = [name: string, code: string, want: string];

function notes(step: string, rows: Row[], answers: (string | null)[] = []) {
  test.each(rows)('%s', (_, code, want) => {
    expect(note(attempt(step, code, answers))).toBe(want);
  });
}

function correct(step: string, rows: [name: string, code: string][], answers: (string | null)[] = []) {
  test.each(rows)('accepts %s', (_, code) => {
    const s = attempt(step, code, answers);
    expect(s.checks?.filter((c) => !c.ok)).toEqual([]);
  });
}

const STOPPED = (line: number) => `Your program stopped on line ${line} before it finished. The Output panel explains the error. Fix that line, then press Run.`;

describe('starting code', () => {
  const answers: Record<string, (string | null)[]> = { search: ['hi'], program: [] };
  test.each(lab.steps.flatMap((s) => (s.demos ?? []).filter((d) => d.kind === 'js').map((d) => [s.id, d.id] as const)))('%s runs with nothing to check', (step, demo) => {
    const s = spec(step, demo);
    let state = jsModel.apply(s, jsModel.init(s), { run: true });
    for (const answer of answers[step] ?? (state.waiting ? ['hi'] : [])) state = jsModel.apply(s, state, { answer });
    expect(state.waiting).toBeUndefined();
    expect(state.notes).toBeUndefined();
    expect(state.last?.error).toBeUndefined();
    expect(state.checks?.some((c) => c.ok)).toBe(false);
  });

  test('scaffolding fades: the last required step gives one comment', () => {
    expect(spec('program').files[0].text.trim().split('\n')).toEqual(['// Song requests for the dance.']);
  });

  test('no required step uses a loop, in its code or its answer key', () => {
    for (const code of [WARMUP_DONE, MAKE_DONE, READ_DONE, CHANGE_DONE, EDGES_DONE, SEARCH_DONE, PROGRAM_DONE]) expect(code).not.toMatch(/\b(for|while)\s*\(/);
    for (const step of lab.steps.filter((s) => !s.extra)) expect(`${step.body}`).not.toMatch(/\bfor \(|\bwhile \(/);
  });
});

describe('every check has a hint ladder that ends close to the answer', () => {
  const checks = lab.steps.flatMap((s) => (s.demos ?? []).flatMap((d) => (d.kind === 'js' ? (d.checks ?? []) : [])));
  test.each(checks.map((c) => [c.id, c] as const))('%s', (_, c) => {
    expect(c.hints?.length).toBeGreaterThanOrEqual(2);
    expect(c.hints![c.hints!.length - 1]).toContain('`');
  });
});

describe('step 1: warmup', () => {
  const start = spec('warmup').files[0].text;
  const line = (code: string) => `${start}${code}\n`;
  notes('warmup', [
    ['nothing added yet', start, 'Add a line under the `alert` that prints `playlist` with `console.log`.'],
    ['quote marks around the name', line('console.log("playlist");'), 'The quote marks make that the word playlist. Take them away, so that `console.log` prints the array.'],
    ['alert in place of console.log', line('alert(playlist);'), 'That prints with `alert`. Use `console.log` for this task, so that you see the array with its square brackets.'],
    ['one song', line('console.log(playlist[0]);'), 'That prints one song. Put `playlist` between the parentheses with no index, so that you print the whole array.'],
    ['capital C', line('Console.log(playlist);'), STOPPED(4)],
  ]);
  test('the error names the capital C', () => {
    expect(help(attempt('warmup', line('Console.log(playlist);')))).toBe('There is no variable called Console. Did you mean console? JavaScript treats capital and lowercase letters as different.');
  });
  correct('warmup', [
    ['a label', line('console.log("Playlist:", playlist);')],
    ['single quotes in the array, with const', `const playlist = ['Neon Lockers', 'Bus Stop Rain'];\n\n\nconsole.log(playlist);\n`],
    ['join', line('console.log(playlist.join(", "));')],
    ['a loop', line('for (let i = 0; i < playlist.length; i++) {\n  console.log(playlist[i]);\n}')],
    ['the alert removed', 'let playlist = ["Neon Lockers"];\nconsole.log(playlist);\n'],
  ]);

  test('the Hint goal cannot trap a student who printed first', () => {
    const goal = lab.steps[0].goals!.find((g) => g.id === 'hint')!;
    const s = spec('warmup');
    const facts = jsModel.facts(s, attempt('warmup', WARMUP_DONE));
    expect(facts.hints).toBe(0);
    expect(goal.check({ ev: { type: 'ui:demo', demo: 'warmup', facts } } as never)).toBe(true);
  });

  test('the step-through has the length the answer key plays', () => {
    const s = spec('warmup');
    expect(traceOf(s, { files: [{ name: 'script.js', text: WARMUP_DONE }], answers: [], runs: 0 }).steps).toHaveLength(5);
  });
});

describe('step 2: make', () => {
  const start = spec('make').files[0].text;
  const swap = (from: string, to: string) => start.replace(from, to);
  const THREE = '["Neon Lockers", "Bus Stop Rain", "Mine"]';
  const openers = swap('["Neon Lockers", "Bus Stop Rain"]', THREE);
  const twoDone = openers.replace('ticketsSold = 0', 'ticketsSold = [40, 55, 62, 71]');
  notes('make', [
    ['still two songs', start, '`openers` has 2 songs. Add a comma, then a third song in quote marks.'],
    ['round parentheses', swap('["Neon Lockers", "Bus Stop Rain"]', '("Neon Lockers", "Bus Stop Rain", "Mine")'), 'Round parentheses do not make an array, so `openers` holds only the last value inside them. Use square brackets.'],
    ['one long string', swap('["Neon Lockers", "Bus Stop Rain"]', '["Neon Lockers, Bus Stop Rain, Mine"]'), 'That is one long string, because one pair of quote marks goes around all the songs. Put quote marks around each song, with the commas outside them.'],
    ['a number for a song', swap('"Bus Stop Rain"]', '"Bus Stop Rain", 7]'), 'Every song is text, so each item needs a title inside quote marks.'],
    ['a song with no quotes', swap('"Bus Stop Rain"]', '"Bus Stop Rain", Midnight]'), STOPPED(2)],
    ['a renamed variable', openers.replaceAll('ticketsSold', 'tickets'), 'Keep the name `ticketsSold` for your array, so that this lab can try your code on a different list.'],
    ['tickets still 0', openers, '`ticketsSold` still holds one value. Put the four numbers inside square brackets, with commas between them.'],
    ['parentheses around numbers', openers.replace('ticketsSold = 0', 'ticketsSold = (40, 55, 62, 71)'), 'Round parentheses do not make an array, so `ticketsSold` holds only the last value inside them. Use square brackets.'],
    ['quoted numbers', openers.replace('ticketsSold = 0', 'ticketsSold = ["40", "55", "62", "71"]'), 'Those numbers have quote marks, which makes them strings. Take the quote marks away.'],
    ['a number left out', openers.replace('ticketsSold = 0', 'ticketsSold = [40, 55, 62]'), 'Put these four numbers in the array, in this order: 40, 55, 62, 71.'],
    ['requests still a string', twoDone, 'An empty string is not an empty array. Replace the quote marks with square brackets.'],
    ['one empty string in the array', twoDone.replace('requests = ""', 'requests = [""]'), 'An empty array has nothing between its square brackets, not even quote marks.'],
    ['curly braces', twoDone.replace('requests = ""', 'requests = {}'), 'Curly braces make an object. An empty array is two square brackets with nothing between them.'],
    ['no value', twoDone.replace('let requests = "";', 'let requests;'), 'Make `requests` an empty array: two square brackets with nothing between them.'],
  ]);

  test('syntax mistakes get the editor help, and the checks wait', () => {
    const bad = (from: string, to: string) => attempt('make', swap(from, to));
    expect(help(bad('"Neon Lockers", "Bus Stop Rain"', '"Neon Lockers" "Bus Stop Rain"'))).toBe('The items in an array need a comma between them.');
    expect(help(bad('ticketsSold = 0', 'ticketsSold = {40, 55, 62, 71}'))).toBe('Curly braces make an object, not an array. An array goes in square brackets, like [1, 2, 3].');
    expect(help(bad('["Neon Lockers", "Bus Stop Rain"]', '{"Neon Lockers", "Bus Stop Rain"}'))).toBe('Curly braces make an object, not an array. An array goes in square brackets, like [1, 2, 3].');
    expect(help(bad('"Bus Stop Rain"]', '"Bus Stop Rain", Midnight Drive]'))).toBe('Text needs quote marks around it: "Midnight Drive". Two separate items need a comma between them.');
    expect(bad('ticketsSold = 0', 'ticketsSold = {40, 55}').held).toBe(true);
  });

  test('a song with no quote marks gets help that says so', () => {
    expect(help(attempt('make', swap('"Bus Stop Rain"]', '"Bus Stop Rain", Midnight]')))).toBe('There is no variable called Midnight. Declare it first with let, and check the spelling. Text in quotes is a string, and a word with no quotes has to be a variable.');
  });

  correct('make', [
    ['the answer key', MAKE_DONE],
    ['const and single quotes', "const openers = ['a', 'b', 'c'];\nconst ticketsSold = [40, 55, 62, 71];\nconst requests = [];\n"],
    ['extra blank lines and a fourth song', 'let openers = [\n  "a",\n\n  "b",\n  "c",\n  "d",\n];\n\n\nlet ticketsSold = [\n  40,\n  55,\n  62,\n  71,\n];\nlet requests = [ ];\n'],
    ['push for the third song', 'let openers = ["a", "b"];\nopeners.push("c");\nlet ticketsSold = [40, 55, 62, 71];\nlet requests = [];\n'],
    ['a template literal', 'let openers = [`a`, `b`, `c`];\nlet ticketsSold = [40, 55, 62, 71];\nlet requests = [];\n'],
  ]);
});

describe('step 3: read', () => {
  const start = spec('read').files[0].text;
  const add = (third: string, count = '', last = '') => start.replace('// Print the third song.\n', `// Print the third song.\n${third}`).replace('on the playlist.\n', `on the playlist.\n${count}`).replace('// Print the last song.\n', `// Print the last song.\n${last}`);
  const good3 = 'console.log(playlist[2]);\n';
  const good5 = 'console.log(playlist.length);\n';
  notes('read', [
    ['nothing added yet', start, 'Add a line that prints the third song, using an index.'],
    ['counting from 1', add('console.log(playlist[3]);\n'), 'Indexes count from 0, so `playlist[3]` is the fourth song. The third song is at index 2.'],
    ['a typed title', add('console.log("Last Bell");\n'), 'You typed the name of the song. Read it from the array with an index, so that your code keeps working when the playlist changes.'],
    ['quote marks around the code', add('console.log("playlist[2]");\n'), 'The quote marks turn that into plain text. Take them away, so that JavaScript reads the index.'],
    ['the whole list', add('console.log(playlist);\n'), 'That prints the whole array. Put an index in square brackets after `playlist`, so that you print one song.'],
    ['a typed count', add(good3, 'console.log(5);\n'), 'You typed the number. Use `playlist.length`, so that the count stays right when songs are added.'],
    ['length minus 1 as the count', add(good3, 'console.log(playlist.length - 1);\n'), '`playlist.length - 1` is the last index. The number of songs is `playlist.length`, with nothing subtracted.'],
    ['length called as a method', add(good3, 'console.log(playlist.length());\n'), STOPPED(11)],
    ['one past the end', add(good3, good5, 'console.log(playlist[playlist.length]);\n'), 'Your code read one spot past the end, so it printed undefined. The indexes stop one short of the length, so the last song is at `playlist.length - 1`.'],
    ['a fixed index one past the end', add(good3, good5, 'console.log(playlist[5]);\n'), 'Your code read one spot past the end, so it printed undefined. The indexes stop one short of the length, so the last song is at `playlist.length - 1`.'],
    ['a fixed last index', add(good3, good5, 'console.log(playlist[4]);\n'), 'Index 4 only works while the playlist has 5 songs. Work out the index from `playlist.length`, so that it finds the last song on a longer list.'],
    ['a typed last title', add(good3, good5, 'console.log("Hallway Echo");\n'), 'You typed the name of the song. Read it from the array with an index, so that your code keeps working when the playlist changes.'],
  ]);

  test('arr.length() and arr[arr.length] also get the editor text, word for word', () => {
    expect(help(attempt('read', add(good3, 'console.log(playlist.length());\n')))).toBe('length is a property, not a method, so it has no parentheses. Write playlist.length with nothing after it.');
    expect(lint(attempt('read', add(good3, good5, 'console.log(playlist[playlist.length]);\n')))).toEqual(['playlist[playlist.length] is one past the end, so it gives undefined. Indexes start at 0, so the last item is playlist[playlist.length - 1].']);
  });

  test('printing the whole list never passes "print the third song"', () => {
    expect(attempt('read', add('console.log(playlist);\n', good5, 'console.log(playlist[playlist.length - 1]);\n')).checks?.[0].ok).toBe(false);
  });

  correct('read', [
    ['the answer key', READ_DONE],
    ['const, single quotes, and a saved index', `const playlist = ['a', 'b', 'c', 'd', 'e'];\nconst last = playlist.length - 1;\nconsole.log(playlist[2]);\nconsole.log(playlist.length);\nconsole.log(playlist[last]);\n`],
    ['labels with +', 'let playlist = ["a", "b", "c", "d", "e"];\nconsole.log("Third: " + playlist[2]);\nconsole.log("Songs: " + playlist.length);\nconsole.log("Last: " + playlist[playlist.length - 1]);\n'],
    ['template literals and blank lines', 'let playlist = ["a", "b", "c", "d", "e"];\n\n\nconsole.log(`Third: ${playlist[2]}`);\n\nconsole.log(`There are ${playlist.length} songs.`);\n\nconsole.log(`Last: ${playlist[playlist.length - 1]}`);\n'],
    ['alert in place of console.log', 'let playlist = ["a", "b", "c", "d", "e"];\nalert(playlist[2]);\nalert(playlist.length);\nalert(playlist[playlist.length - 1]);\n'],
    ['a loop that prints the third song', 'let playlist = ["a", "b", "c", "d", "e"];\nfor (let i = 0; i < playlist.length; i++) {\n  if (i === 2) {\n    console.log(playlist[i]);\n  }\n}\nconsole.log(playlist.length);\nconsole.log(playlist[playlist.length - 1]);\n'],
    ['two songs on one line', 'let playlist = ["a", "b", "c", "d", "e"];\nconsole.log(playlist[2], playlist[playlist.length - 1]);\nconsole.log(playlist.length);\n'],
  ]);
});

describe('step 4: change', () => {
  const start = spec('change').files[0].text;
  const add = (...lines: string[]) => start.replace('// Make your three changes here.\n', `${lines.join('\n')}\n`);
  const one = 'playlist[1] = "Thunder Gym";';
  const two = 'playlist[playlist.length - 1] = "Parking Lot Stars";';
  const RETYPED = 'You typed out a whole new array. Change one spot instead, so that the rest of the list stays as it was.';
  notes('change', [
    ['nothing added yet', start, 'Give `playlist[1]` a new value with one equals sign.'],
    ['counting from 1', add('playlist[2] = "Thunder Gym";'), 'Indexes count from 0, so `playlist[2]` is the third song. The second song is at index 1.'],
    ['the first spot', add('playlist[0] = "Thunder Gym";'), '`playlist[0]` is the first song. The second song is at index 1.'],
    ['reassigning a const array', add('playlist = ["Neon Lockers", "Thunder Gym", "Last Bell", "Cafeteria Moon"];'), '`const` stops you from giving the variable a whole new value, but the items inside the array can still change. Use an index to change one spot, or `push` to add an item.'],
    ['retyping the array with let', start.replace('const playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon"]', 'let playlist = ["Neon Lockers", "Thunder Gym", "Last Bell", "Cafeteria Moon"]'), RETYPED],
    ['two equals signs', add('playlist[1] == "Thunder Gym";'), 'Give `playlist[1]` a new value with one equals sign.'],
    ['push in place of a spot', add('playlist.push("Thunder Gym");'), 'That added a song to the end. This task replaces the second song, so assign to index 1.'],
    ['one past the end', add(one, 'playlist[playlist.length] = "Parking Lot Stars";'), '`playlist.length` is one past the end, so that added a new spot and left the last song alone. The last song is at `playlist.length - 1`.'],
    ['a fixed last index', add(one, 'playlist[3] = "Parking Lot Stars";'), 'That index is a fixed number, so it does not follow the list when the list grows. Use `playlist.length - 1` for the index.'],
    ['not done yet', add(one), 'Give the last spot a new value. Use `playlist.length - 1` for the index.'],
    ['the fourth number', add(one, two, 'votes[3] += 1;'), 'Indexes count from 0, so `votes[3]` is the fourth number. The third number is at index 2.'],
    ['a typed total', add(one, two, 'votes[2] = 16;'), 'You typed the new total. Add 1 to the number that is already there, so that it works for any number of votes.'],
    ['=+ for +=', add(one, two, 'votes[2] =+ 1;'), 'That line set the number to 1. To add 1, write `votes[2] = votes[2] + 1;`'],
    ['an answer that is not saved', add(one, two, 'votes[2] + 1;'), 'That line works out the new number and then drops it. Save it back into the array with `=`.'],
    ['reassigning votes', add(one, two, 'votes = votes[2] + 1;'), '`const` stops you from giving the variable a whole new value, but the items inside the array can still change. Use an index to change one spot, or `push` to add an item.'],
  ]);

  correct('change', [
    ['the answer key', CHANGE_DONE],
    ['+=', add(one, two, 'votes[2] += 1;')],
    ['++', add(one, two, 'votes[2]++;')],
    ['let and single quotes', start.replaceAll('const ', 'let ').replace('// Make your three changes here.\n', "playlist[1] = 'Thunder Gym';\nplaylist[playlist.length - 1] = 'Parking Lot Stars';\nvotes[2] = votes[2] + 1;\n")],
    ['pop then push for the last spot', add(one, 'playlist.pop();', 'playlist.push("Parking Lot Stars");', 'votes[2] += 1;')],
    ['a saved index and blank lines', add('', 'const last = playlist.length - 1;', '', 'playlist[1] = "Thunder Gym";', '', 'playlist[last] = "Parking Lot Stars";', '', 'votes[2] = 1 + votes[2];', '')],
    ['a loop that finds the spot', add('for (let i = 0; i < playlist.length; i++) {', '  if (i === 1) {', '    playlist[i] = "Thunder Gym";', '  }', '}', two, 'votes[2] += 1;')],
  ]);
});

describe('step 5: edges', () => {
  const start = spec('edges').files[0].text;
  const add = (...lines: string[]) => start.replace('// Make the four changes here, in order.\n', `${lines.join('\n')}\n`);
  const pop = ['let removed = playlist.pop();', 'console.log(removed);'];
  const push = 'playlist.push("Thunder Gym");';
  const shift = ['let nowPlaying = playlist.shift();', 'console.log(nowPlaying);'];
  const PUSH_ASSIGN = '`push` changes the array and gives back the new length, so `playlist = playlist.push(...)` replaces your array with a number. Write the `push` on its own line, with no `playlist =` in front.';
  notes('edges', [
    ['nothing added yet', start, 'The last song is still on the playlist. Remove it with `playlist.pop()`, and remember the parentheses.'],
    ['pop with no parentheses', add('playlist.pop;'), 'The last song is still on the playlist. Remove it with `playlist.pop()`, and remember the parentheses.'],
    ['forgetting what pop gives back', add('playlist.pop();', 'console.log(playlist[playlist.length - 1]);'), 'That prints the song that is last now. `pop` gives back the song it removed, so save it: `let removed = playlist.pop();`. Then print `removed`.'],
    ['never printing the song', add('playlist.pop();'), 'The song came off the playlist, and now it needs printing. `pop` gives back the song it removed, so save it: `let removed = playlist.pop();`. Then print `removed`.'],
    ['popping twice', add('playlist.pop();', 'console.log(playlist.pop());'), 'Two songs came off the end, because every `pop()` removes one more song. Call it once, and save what it gives back: `let removed = playlist.pop();`'],
    ['push not done', add(...pop), 'Add `"Thunder Gym"` to the end with `push`.'],
    ['a fixed index for push', add(...pop, 'playlist[4] = "Thunder Gym";'), 'You set a spot by number, and on a longer playlist that replaces a song. `push` adds to the end, however long the array is.'],
    ['writing over the last spot', add(...pop, 'playlist[playlist.length - 1] = "Thunder Gym";'), 'That wrote over the last song. `push` adds a new spot at the end, however long the array is.'],
    ['assigning push to a const', add(...pop, 'playlist = playlist.push("Thunder Gym");'), PUSH_ASSIGN],
    ['assigning push to a let', add(...pop, 'playlist = playlist.push("Thunder Gym");').replace('const playlist', 'let playlist'), PUSH_ASSIGN],
    ['square brackets on push', add(...pop, 'playlist.push["Thunder Gym"];'), '`push` is a method, so it takes parentheses, not square brackets: `playlist.push("Thunder Gym");`'],
    ['plus on its own', add(...pop, 'playlist + "Thunder Gym";'), '`+` cannot add an item to an array. Use `playlist.push("Thunder Gym");`'],
    ['plus assigned back', add(...pop, 'playlist = playlist + "Thunder Gym";').replace('const playlist', 'let playlist'), '`+` turned your array into one long string, because it cannot add an item to an array. Use `push` instead.'],
    ['unshift for push', add(...pop, 'playlist.unshift("Thunder Gym");'), '`unshift` adds to the front. `push` adds to the end.'],
    ['shift not done', add(...pop, push), 'The first song is still on the playlist. Remove it with `playlist.shift()`.'],
    ['shift used to add', add(...pop, push, 'playlist.shift();', 'playlist.shift("Senior Sunset");'), '`shift` removes the first song and ignores what you pass it. `unshift` is the method that adds to the front.'],
    ['shifting twice', add(...pop, push, 'playlist.shift();', 'console.log(playlist.shift());'), 'Two songs came off the front, because every `shift()` removes one more song. Call it once, and save what it gives back: `let nowPlaying = playlist.shift();`'],
    ['forgetting what shift gives back', add(...pop, push, 'playlist.shift();', 'console.log(playlist[0]);'), 'Print the song you removed. `shift` gives it back, so save it: `let nowPlaying = playlist.shift();`. Then print `nowPlaying`.'],
    ['unshift not done', add(...pop, push, ...shift), 'Add `"Senior Sunset"` to the front with `unshift`.'],
    ['writing over the first spot', add(...pop, push, ...shift, 'playlist[0] = "Senior Sunset";'), 'That wrote over the first song. `unshift` adds a new song in front, and it moves every other song back one spot.'],
    ['push for unshift', add(...pop, push, ...shift, 'playlist.push("Senior Sunset");'), '`push` adds to the end. Use `unshift` to add to the front.'],
  ]);

  test('the shared notes say the same as the checks', () => {
    expect(lint(attempt('edges', add(...pop, 'playlist.push["Thunder Gym"];')))).toEqual(['playlist.push is a method, so it takes parentheses, not square brackets: playlist.push("Thunder Gym").']);
    expect(lint(attempt('edges', add(...pop, 'playlist + "Thunder Gym";')))).toEqual(['+ can\'t add an item to an array. It turns playlist into text, and this line then throws that text away. To add to the end, write playlist.push("Thunder Gym");']);
    expect(lint(attempt('edges', add(...pop, 'playlist = playlist.push("Thunder Gym");')))).toEqual(['push changes the array and gives back its new length, so this line replaces playlist with a number. Write playlist.push("Thunder Gym"); with no playlist = in front.']);
  });

  correct('edges', [
    ['the answer key', EDGES_DONE],
    ['printing straight from pop and shift', add('console.log(playlist.pop());', push, 'console.log(playlist.shift());', 'playlist.unshift("Senior Sunset");')],
    ['reading the song before removing it', add('let removed = playlist[playlist.length - 1];', 'playlist.pop();', 'console.log(removed);', push, 'let first = playlist[0];', 'playlist.shift();', 'console.log(first);', 'playlist.unshift("Senior Sunset");')],
    ['let, single quotes, and labels with template literals', start.replace('const ', 'let ').replace('// Make the four changes here, in order.\n', "const removed = playlist.pop();\nconsole.log(`Removed: ${removed}`);\nplaylist.push('Thunder Gym');\nconst played = playlist.shift();\nconsole.log('Played: ' + played);\nplaylist.unshift('Senior Sunset');\n")],
    ['one label for both songs on a line', add('const removed = playlist.pop();', 'console.log("Removed", removed, "from", playlist);', push, ...shift, 'playlist.unshift("Senior Sunset");')],
    ['assigning to the end instead of push', add(...pop, 'playlist[playlist.length] = "Thunder Gym";', ...shift, 'playlist.unshift("Senior Sunset");')],
    ['a loop that prints the list after each change', add(...pop, push, ...shift, 'playlist.unshift("Senior Sunset");', 'for (const song of playlist) {', '  console.log(song);', '}')],
    ['blank lines', add('', ...pop, '', push, '', ...shift, '', 'playlist.unshift("Senior Sunset");', '')],
  ]);
});

describe('step 6: search', () => {
  const start = spec('search').files[0].text;
  const add = (body: string) => start.replace('// Decide what to print.\n', `${body}\n`);
  const save = 'let spot = playlist.indexOf(request);\n';
  const NUMBER = '"That song is number " + (spot + 1) + "."';
  const shape = (test: string, found: string) => add(`${save}if (${test}) {\n  console.log(${found});\n} else {\n  console.log("Not on the playlist yet.");\n}`);
  const MINUS_ONE = '`indexOf` gave -1 because that song is not on the playlist, and your code treated -1 as a song number. Test for it first: `if (spot === -1)`.';
  notes('search', [
    ['nothing added yet', start, 'When the request is on the playlist, find it with `playlist.indexOf(request)`, then print that number plus 1.'],
    ['comparing with the whole array', add('if (request === playlist) {\n  console.log("That song is number 1.");\n}'), '`===` compares the request with the whole array, which is never true. `playlist.includes(request)` looks through the items.'],
    ['quote marks around request', add('if (playlist.includes("request")) {\n  console.log("That song is number 1.");\n}'), 'With quote marks, `"request"` is the word request. Take them away, so that `includes` looks for what the student typed.'],
    ['includes with no parentheses', shape('playlist.includes', NUMBER), '`playlist.includes` with no parentheses names the method without calling it, so the `if` always passes. Write `playlist.includes(request)`.'],
    ['typed songs', add('if (request === "last bell") {\n  console.log("That song is number 3.");\n}'), 'Your code only knows the songs you typed. Use `playlist.includes(request)`, so that it follows the list when the list changes.'],
    ['printing the index', shape('spot !== -1', '"That song is number " + spot + "."'), 'People count from 1, so the song at index 3 is number 4. Print the index plus 1.'],
    ['plus glued onto the text', shape('spot !== -1', '"That song is number " + spot + 1 + "."'), 'The checks tried the song at index 3, and your program printed 31. `+` glued the 1 onto the text instead of adding. Put parentheses around the math, like `(spot + 1)`.'],
    ['spot greater than 0', shape('spot > 0', NUMBER), 'The first song is at index 0, and your code treated it as missing. Compare what `indexOf` gives back with -1.'],
    ['spot as true or false', shape('spot', NUMBER), 'The first song is at index 0, and your code treated it as missing. Compare what `indexOf` gives back with -1.'],
    ['-1 used as a position', add(`${save}console.log(${NUMBER});`), MINUS_ONE],
    ['-1 used as an index', add(`${save}if (spot >= -1) {\n  console.log("That song is number " + (spot + 1) + ": " + playlist[spot]);\n}`), MINUS_ONE],
    ['a crash on a song that is missing', add(`${save}console.log(playlist[spot].toUpperCase() + " is number " + (spot + 1) + ".");`), STOPPED(9)],
    ['nothing printed when missing', add(`${save}if (spot !== -1) {\n  console.log(${NUMBER});\n}`), 'When the song is not on the playlist, print `Not on the playlist yet.`'],
  ], ['Thunder Gym']);

  test('removing the prompt gets a clear note', () => {
    expect(note(attempt('search', start.replace('prompt("What song do you want to hear?")', '"last bell"') + save))).toBe('Keep the `prompt` line, so that your program asks for a request every time it runs.');
  });

  test('a crash from Cancel does not hide the checks, since they answer their own prompts', () => {
    const s = attempt('search', SEARCH_DONE, [null]);
    expect(s.last?.error?.type).toBe('TypeError');
    expect(help(s)).toContain('prompt gives back null when you press Cancel.');
    expect(s.checks?.every((c) => c.ok)).toBe(true);
  });

  const LOWER_PROMPT = start.replace('prompt("What song do you want to hear?")', 'prompt("What song do you want to hear?").toLowerCase()');
  correct('search', [
    ['the answer key', SEARCH_DONE],
    ['spot >= 0 and a template literal', shape('spot >= 0', '`That song is number ${spot + 1}.`')],
    ['spot != -1 and alert', shape('spot != -1', NUMBER).replaceAll('console.log', 'alert')],
    ['includes, then indexOf', add('if (playlist.includes(request)) {\n  console.log("That song is number " + (playlist.indexOf(request) + 1) + ".");\n} else {\n  console.log("Not on the playlist yet.");\n}')],
    ['lowercase at the prompt, with other wording', LOWER_PROMPT.replace('// Decide what to print.\n', 'let spot = playlist.indexOf(request);\nif (spot < 0) {\n  console.log("We do not have that one.");\n} else {\n  console.log(`Number ${spot + 1} in line`);\n}\n')],
    ['a test print of -1 beside the right answer', SEARCH_DONE.replace('let spot = playlist.indexOf(request);', 'let spot = playlist.indexOf(request);\nconsole.log(spot);')],
    ['a loop that searches', add('let spot = -1;\nfor (let i = 0; i < playlist.length; i++) {\n  if (playlist[i] === request) {\n    spot = i;\n  }\n}\nif (spot === -1) {\n  console.log("Not on the playlist yet.");\n} else {\n  console.log("That song is number " + (spot + 1) + ".");\n}')],
  ], ['Thunder Gym']);
});

describe('fixes from the second student panel', () => {
  const start = spec('read').files[0].text;
  const third = 'console.log(playlist[2]);\nconsole.log(playlist.length);\n';

  test('printing the last index says so, and shows where the index goes', () => {
    expect(note(attempt('read', `${start}${third}console.log(playlist.length - 1);\n`))).toBe('That printed the index of the last song, not the song. Put the index inside the square brackets: `playlist[...]`.');
  });

  const program = (body: string) => `let requests = ["Neon Lockers", "Bus Stop Rain", "Last Bell"];\nlet song = prompt("What song do you want to hear?");\n${body}`;

  test('a push with no else is named, when the student already tests for the song', () => {
    expect(note(attempt('program', program('if (requests.includes(song)) {\n  console.log("That song is already on the list.");\n}\nrequests.push(song);\nconsole.log(requests.join(", "));\nconsole.log(requests.length);\n'), ['Thunder Gym']))).toBe('The `push` ran even when the song was on the list. Put it in the `else` part of your `if`.');
  });

  test('a count printed only when a song was added says where to move it', () => {
    expect(note(attempt('program', program('if (requests.includes(song)) {\n  console.log("That song is already on the list.");\n} else {\n  requests.push(song);\n  console.log(requests.join(", "));\n  console.log(requests.length);\n}\n'), ['Thunder Gym']))).toBe('Your count only prints when a song was added. Move it after your `if` and `else`, so that it always prints.');
  });
});

describe('step 7: program', () => {
  const start = 'let requests = ["Neon Lockers", "Bus Stop Rain", "Last Bell"];\n';
  const ask = 'let song = prompt("What song do you want to hear?");\n';
  const addIt = 'if (requests.includes(song)) {\n  console.log("That song is already on the list.");\n} else {\n  requests.push(song);\n}\n';
  const showIt = 'console.log(requests.join(", "));\n';
  const countIt = 'console.log(requests.length + " songs");\n';
  const answers = ['Thunder Gym'];
  notes('program', [
    ['nothing written', '// Song requests for the dance.\n', 'Name your array `requests`, so that this lab can try your code on a different list.'],
    ['a renamed array', 'let songs = ["a", "b", "c"];\n', 'Name your array `requests`, so that this lab can try your code on a different list.'],
    ['two songs', 'let requests = ["a", "b"];\n', 'Start `requests` with at least three songs.'],
    ['round parentheses', 'let requests = ("a", "b", "c");\n', 'Round parentheses do not make an array, so `requests` holds only the last value inside them. Use square brackets.'],
    ['no prompt', start, 'Your program never asks for a song. Use `prompt`, and save the answer in a variable.'],
  ]);
  notes('program', [
    ['not added', start + ask, 'Add the song to the end of `requests` with `push`.'],
    ['assigning push', `${start}${ask}requests = requests.push(song);\n`, '`push` changes the array and gives back the new length, so `requests = requests.push(...)` replaces your array with a number. Write the `push` on its own line, with no `requests =` in front.'],
    ['plus', `${start}${ask}requests = requests + song;\n`, '`+` turned your array into one long string, because it cannot add an item to an array. Use `push` instead.'],
    ['a fixed index', `${start}${ask}requests[3] = song;\n`, 'You set a spot by number, and that replaces a song on a different list. `push` adds to the end, however long the array is.'],
    ['the word song', `${start}${ask}requests.push("song");\n`, 'With quote marks, `"song"` is the word song. Take them away, so that `push` adds what the user typed.'],
    ['square brackets on push', `${start}${ask}requests.push[song];\n`, '`push` is a method, so it takes parentheses, not square brackets.'],
    ['the if turned around', `${start}${ask}if (requests.includes(song)) {\n  requests.push(song);\n}\n`, 'Your code has a `push`, but it did not run for a new song. Check the test in your `if`.'],
    ['always adding', `${start}${ask}requests.push(song);\n`, 'A song that was already on the list got added a second time. Test with `requests.includes(song)` before you add it.'],
    ['no message for a repeat', `${start}${ask}if (!requests.includes(song)) {\n  requests.push(song);\n}\n`, 'When the song is already on the list, print a message that says so.'],
    ['alert on the array', `${start}${ask}${addIt}alert(requests);\n`, '`alert` shows an array with bare commas and no spaces. `join` lets you choose what goes between the songs: `requests.join(", ")`.'],
    ['console.log on the array', `${start}${ask}${addIt}console.log(requests);\n`, '`console.log` prints the array with its brackets and quote marks. `requests.join(", ")` gives you a plain line of text to print.'],
    ['the list printed too early', `${start}${ask}${showIt}${addIt}`, 'That list was printed before the new song went on. Print it after your `push`.'],
    ['join with nothing inside', `${start}${ask}${addIt}console.log(requests.join());\n`, 'With nothing between its parentheses, `join` puts a bare comma between the items. Put `", "` between the parentheses.'],
    ['join that is not used', `${start}${ask}${addIt}requests.join(", ");\n`, '`join` gives back a new string and leaves the array alone. Print what it gives back: `console.log(requests.join(", "));`'],
    ['no list', `${start}${ask}${addIt}`, 'Print the whole list with `requests.join(", ")`.'],
    ['no count', `${start}${ask}${addIt}${showIt}`, 'Print how many songs are on the list with `requests.length`.'],
    ['the count printed too early', `${start}${ask}${countIt}${addIt}${showIt}`, 'That count was printed before the new song went on. Print `requests.length` after your `push`.'],
    ['a typed count', `${start}${ask}${addIt}${showIt}console.log(4);\n`, 'Print how many songs are on the list with `requests.length`.'],
  ], answers);

  const pick = 'let spot = Math.floor(Math.random() * requests.length);\nconsole.log("Next up: " + requests[spot]);\n';
  correct('program', [
    ['the answer key', PROGRAM_DONE],
  ], answers);
  correct('program', [
    ['const and single quotes', `const requests = ['a', 'b', 'c'];\nconst song = prompt('Song?');\nif (requests.indexOf(song) === -1) {\n  requests.push(song);\n} else {\n  alert('Already there!');\n}\nalert(requests.join(', '));\nalert('Songs: ' + requests.length);\nalert(\`Next: \${requests[Math.floor(Math.random() * requests.length)]}\`);\n`],
    ['a lowercased request and a message for each case', `let requests = ["a", "b", "c"];\nlet song = prompt("Song?").toLowerCase();\nif (!requests.includes(song)) {\n  requests.push(song);\n  console.log("Added " + song);\n} else {\n  console.log(song + " is on the list already.");\n}\n${showIt}${countIt}${pick}`],
    ['a name asked first', `let requests = ["a", "b", "c"];\nlet name = prompt("What is your name?");\n${ask}${addIt}${showIt}${countIt}${pick}`],
    ['a question asked last', `${start}${ask}${addIt}${showIt}${countIt}${pick}let more = prompt("Anything else?");\n`],
    ['a list built with push', `let requests = [];\nrequests.push("a");\nrequests.push("b");\nrequests.push("c");\n${ask}${addIt}${showIt}${countIt}${pick}`],
    ['a loop that asks until Cancel', `${start}let song = prompt("Song?");\nwhile (song !== null) {\n  ${addIt.replaceAll('\n', '\n  ')}song = prompt("Song?");\n}\n${showIt}${countIt}${pick}`],
    ['a loop that looks for a repeat', `${start}${ask}let found = false;\nfor (let i = 0; i < requests.length; i++) {\n  if (requests[i] === song) {\n    found = true;\n  }\n}\nif (found) {\n  console.log("Already there.");\n} else {\n  requests.push(song);\n}\n${showIt}${countIt}${pick}`],
    ['extra blank lines and a count in a sentence', `\n\n${start}\n\n${ask}\n${addIt}\n${showIt}\nconsole.log(\`There are \${requests.length} songs.\`);\n\n${pick}\n`],
  ], ['Thunder Gym', null, null]);
});

describe('step 8: reflection', () => {
  const step = lab.steps.find((s) => s.id === 'reflect')!;
  test('asks for at least 40 words, and the answer key has them', () => {
    const q = step.questions![0];
    expect(q.kind === 'text' && q.minWords).toBe(40);
    expect(jsArraysSolution.reflect.text!.explain.split(/\s+/).length).toBeGreaterThanOrEqual(40);
  });
});

describe('optional extra challenge: remove', () => {
  const start = spec('remove').files[0].text;
  const add = (body: string) => `${start}${body}\n`;
  const SPLICE = 'let spot = requests.indexOf(song);\n';
  const SAFE = (test: string, body: string) => add(`${SPLICE}if (${test}) {\n  ${body}\n} else {\n  console.log("That song is not on the list.");\n}`);
  notes('remove', [
    ['nothing added yet', start, 'Find the song with `requests.indexOf(song)`, then remove it with `splice`.'],
    ['pop', add('requests.pop();'), '`pop` removes the last song, whatever the user typed. Find the song with `indexOf`, then use `splice`.'],
    ['one value in splice', SAFE('spot !== -1', 'requests.splice(spot);').replace('let spot = requests.indexOf(song);', 'let spot = 1;'), '`splice` with one value removes everything from that index to the end. Add a second value, 1, to remove one song.'],
    ['a fixed index', add('requests.splice(1, 1);'), 'A fixed index only finds one song. Use `requests.indexOf(song)` to find the index.'],
    ['spot greater than 0', SAFE('spot > 0', 'requests.splice(spot, 1);'), 'The first song is at index 0, and your code left it on the list. Compare what `indexOf` gives back with -1.'],
    ['splice with -1', add(`${SPLICE}requests.splice(spot, 1);`), '`indexOf` gave -1, and `splice(-1, 1)` removes the last song. Test for -1 before you call `splice`.'],
    ['no message', add(`${SPLICE}if (spot !== -1) {\n  requests.splice(spot, 1);\n}`), 'When the song is not on the list, print a message that says so.'],
    ['no list', SAFE('spot !== -1', 'requests.splice(spot, 1);'), 'Print what is left with `requests.join(", ")`, after your `if` and `else`.'],
    ['alert on the array', `${SAFE('spot !== -1', 'requests.splice(spot, 1);')}alert(requests);\n`, '`alert` shows an array with bare commas and no spaces. `join` lets you choose what goes between the songs: `requests.join(", ")`.'],
  ], ['Last Bell']);
  correct('remove', [
    ['the answer key', REMOVE_DONE],
    ['includes and a template literal', add('if (requests.includes(song)) {\n  requests.splice(requests.indexOf(song), 1);\n} else {\n  console.log(`No ${song} here.`);\n}\nconsole.log(requests.join(", "));')],
    ['spot >= 0 and alert', add(`${SPLICE}if (spot >= 0) {\n  requests.splice(spot, 1);\n} else {\n  alert("Not found");\n}\nalert(requests.join(" / "));`)],
  ], ['Last Bell']);
});

describe('optional extra challenge: pick', () => {
  const start = spec('pick').files[0].text;
  const pick = (line: string, print = 'console.log(playlist[spot]);') => start.replace('// Pick a random song here.\n', `${line}\n${print}\n`);
  notes('pick', [
    ['nothing picked yet', start, 'Print one song picked at random.'],
    ['no Math.floor', pick('let spot = Math.random() * playlist.length;'), '`Math.random() * playlist.length` gives a decimal like 2.7, and no item has a decimal index. Put `Math.floor(...)` around it to round down.'],
    ['Math.round', pick('let spot = Math.round(Math.random() * playlist.length);'), '`Math.round` can round up to `playlist.length`, which is one past the last index, and then you get undefined. Use `Math.floor`, which always rounds down.'],
    ['adding 1', pick('let spot = Math.floor(Math.random() * playlist.length) + 1;'), '`Math.floor(Math.random() * playlist.length)` is already a good index. Adding 1 skips the first song and can land past the end.'],
    ['no parentheses on Math.random', pick('let spot = Math.floor(Math.random * playlist.length);'), '`Math.random` needs its parentheses: `Math.random()`.'],
    ['a fixed multiplier', pick('let spot = Math.floor(Math.random() * 5);'), 'Your pick never reaches the end of a longer list. Multiply by `playlist.length` instead of a fixed number.'],
    ['printing the index', pick('let spot = Math.floor(Math.random() * playlist.length);', 'console.log(spot);'), 'That prints the index. Print the song at that index: put the number in square brackets after `playlist`.'],
    ['the same song every time', pick('let spot = 2;'), 'Your program picks the same song on every run. Use `Math.random()` to work out the index.'],
    ['printing every song in a loop', pick('for (let i = 0; i < playlist.length; i++) {', 'console.log(playlist[i]);\n}'), 'Your program prints more than one song. Print only the one song at the random index.'],
    ['floor too soon', pick('let spot = Math.floor(Math.random()) * playlist.length;'), '`Math.floor(Math.random())` is always 0, because it rounds down before you multiply. Put the whole multiplication inside `Math.floor(...)`.'],
    ['lowercase math', pick('let spot = math.floor(math.random() * playlist.length);'), STOPPED(3)],
  ]);

  test('the editor names the lowercase math', () => {
    expect(help(attempt('pick', pick('let spot = math.floor(math.random() * playlist.length);')))).toBe('There is no variable called math. Did you mean Math? JavaScript treats capital and lowercase letters as different.');
  });

  correct('pick', [
    ['the answer key', PICK_DONE],
    ['let, single quotes, and a template literal', "let playlist = ['a', 'b', 'c', 'd', 'e'];\nconst spot = Math.floor(Math.random() * playlist.length);\nalert(`First dance: ${playlist[spot]}`);\n"],
    ['Math.trunc', 'let playlist = ["a", "b", "c", "d", "e"];\nconsole.log(playlist[Math.trunc(Math.random() * playlist.length)]);\n'],
  ]);
});

describe('mistakes from the student panel', () => {
  test('quote marks around an empty array', () => {
    expect(note(attempt('make', MAKE_DONE.replace('let requests = [];', 'let requests = "[]";')))).toBe('Those quote marks make it a string that only looks like an array. Take the quote marks off.');
  });

  test('a crash on a later line keeps the prints that worked', () => {
    const s = attempt('read', READ_DONE.replace('playlist[playlist.length - 1]', 'playlist[length - 1]'));
    expect(s.checks?.filter((c) => c.ok).map((c) => c.id)).toEqual(['third', 'count']);
    expect(help(s)).toBe('length belongs to an array, like names.length. Put the name of your variable and a dot in front of it.');
  });

  test('a method with no array in front of it', () => {
    expect(help(attempt('edges', EDGES_DONE.replace('playlist.pop()', 'pop()')))).toBe('pop belongs to an array, like names.pop(). Put the name of your variable and a dot in front of it.');
  });

  test('shift after unshift removes the new song', () => {
    const code = EDGES_DONE.replace('let nowPlaying = playlist.shift();\nconsole.log(nowPlaying);\nplaylist.unshift("Senior Sunset");', 'playlist.unshift("Senior Sunset");\nlet nowPlaying = playlist.shift();\nconsole.log(nowPlaying);');
    expect(note(attempt('edges', code))).toBe('Your `shift` ran after your `unshift`, so it removed Senior Sunset. Make the changes in the order listed.');
  });

  test('the name of a song passed to splice', () => {
    const code = REMOVE_DONE.replace('requests.splice(spot, 1);', 'requests.splice(song, 1);');
    expect(note(attempt('remove', code, ['Last Bell']))).toBe('`splice` needs an index, not the name of the song. Find the index with `requests.indexOf(song)` first.');
  });
});

describe('the lab as a whole', () => {
  test('has 7 to 10 steps through the submit step, and the extra step after it', () => {
    const submit = lab.steps.findIndex((s) => s.kind === 'submit');
    expect(submit + 1).toBeLessThanOrEqual(10);
    expect(submit + 1).toBeGreaterThanOrEqual(7);
    expect(lab.steps[submit - 1].id).toBe('reflect');
    expect(lab.steps.slice(submit + 1).every((s) => s.extra && s.title.startsWith('Optional extra challenge: '))).toBe(true);
  });

  test('asks at most one question in a step, and few in the lab', () => {
    const coding = lab.steps.filter((s) => s.id !== 'reflect');
    expect(Math.max(...coding.map((s) => s.questions?.length ?? 0))).toBeLessThanOrEqual(1);
    expect(coding.flatMap((s) => s.questions ?? [])).toHaveLength(2);
  });

  test('a stuck student on the first check has a hint before the first Run', () => {
    const s = spec('read');
    expect(firstUnmet(s, jsModel.init(s))?.id).toBe('third');
  });

  test('every step of the answer key leaves its checks passing, and the report shows the code', () => {
    const now = Date.now();
    const session = new LabSession(lab, { labId: lab.id, labVersion: lab.version, studentId: 'test', startedAt: now, updatedAt: now, activeMs: 0, step: 0, maxStep: 0, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] });
    for (let i = 0; i < lab.steps.length; i++) {
      playStep(session, jsArraysSolution[session.step.id]);
      if (i < lab.steps.length - 1) session.goTo(i + 1);
    }
    const report = buildReport(lab, session.progress, { id: 'test', name: 'Test Student', period: 'Period 1', createdAt: 0 }, 'submitted');
    expect(report.code?.map((c) => c.step)).toEqual(['make', 'read', 'change', 'edges', 'search', 'program', 'remove', 'pick']);
    expect(report.goals.every((g) => g.done)).toBe(true);
    expect(report.goals.filter((g) => g.extra).every((g) => g.points === 0)).toBe(true);
  });

  test('student text stays clear of words the Voice section bans', () => {
    const strings: string[] = [];
    for (const s of lab.steps) {
      strings.push(s.title, s.body);
      for (const d of s.demos ?? []) {
        if (d.kind === 'note') strings.push(d.md);
        if (d.kind === 'js') for (const c of d.checks ?? []) strings.push(c.label, ...(c.hints ?? []));
      }
      for (const q of s.questions ?? []) strings.push(q.prompt, ...(q.kind === 'choice' ? q.options.map((o) => o.feedback ?? '') : []));
    }
    const text = strings.join('\n');
    expect(text).not.toMatch(/—|\bjust\b|\bsimply\b|\beasy\b|\beasier\b|\bobviously\b|\bthing\b|\bbonus\b|extra credit/i);
  });
});
