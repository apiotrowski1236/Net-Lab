import type { JsCheck, JsCheckCtx, JsFile } from '../../demos/types';

/** Starting code and hidden checks for the lab. Notes and hints here are what a student reads under the editor. */

type Run = ReturnType<JsCheckCtx['run']>;
type RunOptions = NonNullable<Parameters<JsCheckCtx['run']>[0]>;

const script = (text: string): JsFile[] => [{ name: 'script.js', text }];

/** A longer playlist for hidden runs, so code that only fits the real one shows up. */
const SONGS = ['Aqua', 'Birch', 'Coral', 'Dune', 'Ember', 'Fjord', 'Glow'];

// --- what every check needs ---

function stopped(r: Pick<Run, 'status' | 'error'>): string | undefined {
  if (r.status === 'error' && r.error) return `Your program stopped on line ${r.error.pos.line} before it finished. The Output panel explains the error. Fix that line, then press Run.`;
  if (r.status === 'limit') return 'Your program ran too long and had to be stopped. Check any loop you wrote.';
  return undefined;
}

const keepName = (name: string) => `Keep the name \`${name}\` for your array, so that this lab can try your code on a different list.`;

const CONST_NOTE = '`const` stops you from giving the variable a whole new value, but the items inside the array can still change. Use an index to change one spot, or `push` to add an item.';

/** A run that crashed, ran away, or lost a variable, in that order. */
function trouble(r: Run): string | undefined {
  if (r.error?.code === 'const-assign') return CONST_NOTE;
  return stopped(r) ?? (r.dataMissing.length ? keepName(r.dataMissing[0]) : undefined);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Three or more of these items in a row with one separator between them: a list printed in a line. Words can separate items on one line (` and `), but not across lines, where `Song: a` on each line is three separate prints. */
function listIn(items: string[]): RegExp {
  const one = `(?:${items.map(escaped).join('|')})`;
  return new RegExp(`${one}([^A-Za-z0-9]{1,8}|[^\\n]{1,12}?)${one}(?:\\1${one})+`, 'g');
}

/** Printed lines with any printed list taken out, since a list holds every song and would pass "did it print this song". */
const loose = (lines: { text: string }[], items: string[]) => lines.map((l) => l.text.replace(listIn(items), ' '));

const printed = (lines: { text: string }[], items: string[], song: string) => loose(lines, items).some((t) => t.includes(song));

/** The list printed so a person can read it: the same separator throughout, and not a bare comma, a bare space, or the quote marks of a printed array. */
function readable(text: string, items: string[]): boolean {
  const re = new RegExp(`${escaped(items[0])}(.{1,12}?)${items.slice(1).map(escaped).join('\\1')}`, 'gs');
  return [...text.matchAll(re)].some(([, sep]) => sep !== ',' && !/['"]/.test(sep) && (sep.trim() !== '' || sep.includes('\n')));
}

/** Why a list wasn't shown well, in the words of the mistake. Undefined if it wasn't one of these. */
function listMistake(c: JsCheckCtx, r: Run, items: string[], name: string): string | undefined {
  if (r.text.includes(items.join(','))) {
    if (c.calls('join').some((k) => !k.args.length)) return 'With nothing between its parentheses, `join` puts a bare comma between the items. Put `", "` between the parentheses.';
    return `\`alert\` shows an array with bare commas and no spaces. \`join\` lets you choose what goes between the songs: \`${name}.join(", ")\`.`;
  }
  if (r.text.includes(`'${items[0]}', '${items[1]}'`)) return `\`console.log\` prints the array with its brackets and quote marks. \`${name}.join(", ")\` gives you a plain line of text to print.`;
  if (c.calls('join').length && c.notes.some((n) => n.rule === 'result-unused')) return `\`join\` gives back a new string and leaves the array alone. Print what it gives back: \`console.log(${name}.join(", "));\`.`;
  return undefined;
}

/** Forty runs of Math.random are enough for a fair pick to reach the end of the list, and a fixed multiplier never will. */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

/** What's wrong with a random pick, judged across many runs. */
function pickMistake(c: JsCheckCtx, runs: Run[], items: string[], name: string): string | undefined {
  for (const r of runs) {
    const bad = trouble(r);
    if (bad) return bad;
  }
  const lines = runs.flatMap((r) => loose(r.output, items));
  const code = c.code();
  if (lines.some((t) => /\bundefined\b|\bNaN\b/.test(t))) {
    if (/Math\.random\b(?!\s*\()/.test(code)) return '`Math.random` needs its parentheses: `Math.random()`.';
    if (/Math\.round/.test(code)) return `\`Math.round\` can round up to \`${name}.length\`, which is one past the last index, and then you get undefined. Use \`Math.floor\`, which always rounds down.`;
    if (/Math\.ceil/.test(code)) return `\`Math.ceil\` can round up to \`${name}.length\`, which is one past the last index, and then you get undefined. Use \`Math.floor\`, which always rounds down.`;
    if (!/Math\.floor|Math\.trunc|parseInt/.test(code)) return `\`Math.random() * ${name}.length\` gives a decimal like 2.7, and no item has a decimal index. Put \`Math.floor(...)\` around it to round down.`;
    if (/\+\s*1/.test(code)) return `\`Math.floor(Math.random() * ${name}.length)\` is already a good index. Adding 1 skips the first song and can land past the end.`;
    return `Your program sometimes reads an index with no song in it, and prints undefined. Use \`Math.floor(Math.random() * ${name}.length)\` for the index.`;
  }
  if (runs.some((r) => items.filter((s) => printed(r.output, items, s)).length > 1)) return 'Your program prints more than one song. Print only the one song at the random index.';
  const picked = items.flatMap((s, i) => (lines.some((t) => t.includes(s)) ? [i] : []));
  if (!picked.length) {
    if (new Set(lines.filter((t) => /\b\d+\b/.test(t))).size > 1) return `That prints the index. Print the song at that index: put the number in square brackets after \`${name}\`.`;
    return 'Print one song picked at random.';
  }
  if (picked.length === 1) {
    if (/Math\.floor\(\s*Math\.random\(\)\s*\)/.test(code)) return '`Math.floor(Math.random())` is always 0, because it rounds down before you multiply. Put the whole multiplication inside `Math.floor(...)`.';
    return 'Your program picks the same song on every run. Use `Math.random()` to work out the index.';
  }
  if (Math.max(...picked) + 1 <= items.length - 2) return `Your pick never reaches the end of a longer list. Multiply by \`${name}.length\` instead of a fixed number.`;
  return undefined;
}

// --- step 1: warmup ---

export const WARMUP = script(`let playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell"];

alert("The dance starts at 7:00.");
`);

export const LOG_PLAYLIST: JsCheck = {
  id: 'log-playlist',
  label: 'Print playlist with console.log',
  test(c) {
    const items = ['Aqua', 'Birch'];
    const r = c.run({ data: { playlist: items } });
    const bad = trouble(r);
    if (bad) return bad;
    const logs = r.output.filter((l) => l.kind === 'log').map((l) => l.text).join('\n');
    if (items.every((s) => logs.includes(s))) return undefined;
    if (items.every((s) => r.text.includes(s))) return 'That prints with `alert`. Use `console.log` for this task, so that you see the array with its square brackets.';
    if (/playlist/i.test(logs)) return 'The quote marks make that the word playlist. Take them away, so that `console.log` prints the array.';
    if (items.some((s) => logs.includes(s))) return 'That prints one song. Put `playlist` between the parentheses with no index, so that you print the whole array.';
    return 'Add a line under the `alert` that prints `playlist` with `console.log`.';
  },
  hints: ['Start a new line under the `alert`.', 'Write `console.log`, then put what you want to print between parentheses.', 'Write `console.log(playlist);` with no quote marks.'],
};

// --- step 2: make ---

export const MAKE = script(`// Add a third song to this array.
let openers = ["Neon Lockers", "Bus Stop Rain"];

// Tickets sold by each grade: 40, 55, 62, and 71.
let ticketsSold = 0;

// Nobody has asked for a song yet.
let requests = "";

console.log(openers);
console.log(ticketsSold);
console.log(requests);
`);

const roundParens = (c: JsCheckCtx, name: string) => new RegExp(`\\b${name}\\s*=\\s*\\(`).test(c.code());
const parensNote = (name: string) => `Round parentheses do not make an array, so \`${name}\` holds only the last value inside them. Use square brackets.`;

export const OPENERS: JsCheck = {
  id: 'openers',
  label: 'Give openers three songs',
  test(c) {
    const bad = stopped(c);
    if (bad) return bad;
    if (!('openers' in c.vars)) return keepName('openers');
    const v = c.vars.openers;
    if (!Array.isArray(v)) return roundParens(c, 'openers') ? parensNote('openers') : '`openers` is not an array. Put the songs inside square brackets.';
    if (v.length === 1 && typeof v[0] === 'string' && v[0].includes(',')) return 'That is one long string, because one pair of quote marks goes around all the songs. Put quote marks around each song, with the commas outside them.';
    if (v.length < 3) return `\`openers\` has ${v.length} ${v.length === 1 ? 'song' : 'songs'}. Add a comma, then a third song in quote marks.`;
    if (v.some((s) => typeof s !== 'string' || !s.trim())) return 'Every song is text, so each item needs a title inside quote marks.';
    return undefined;
  },
  hints: ['Items in an array have commas between them.', 'After `"Bus Stop Rain"`, add a comma and then your own song in quote marks.', 'The line should look like `let openers = ["Neon Lockers", "Bus Stop Rain", "My Song"];` with your own title.'],
};

export const TICKETS: JsCheck = {
  id: 'tickets',
  label: 'Make ticketsSold an array of four numbers',
  test(c) {
    if (!('ticketsSold' in c.vars)) return keepName('ticketsSold');
    const v = c.vars.ticketsSold;
    if (!Array.isArray(v)) return roundParens(c, 'ticketsSold') ? parensNote('ticketsSold') : '`ticketsSold` still holds one value. Put the four numbers inside square brackets, with commas between them.';
    if (v.some((n) => typeof n === 'string')) return 'Those numbers have quote marks, which makes them strings. Take the quote marks away.';
    return JSON.stringify(v) === '[40,55,62,71]' ? undefined : 'Put these four numbers in the array, in this order: 40, 55, 62, 71.';
  },
  hints: ['Replace the 0 with an array.', 'Numbers in an array have no quote marks.', 'Write `let ticketsSold = [40, 55, 62, 71];`.'],
};

export const REQUESTS: JsCheck = {
  id: 'requests',
  label: 'Make requests an empty array',
  test(c) {
    if (!('requests' in c.vars)) return keepName('requests');
    const v = c.vars.requests;
    if (Array.isArray(v)) return v.length ? 'An empty array has nothing between its square brackets, not even quote marks.' : undefined;
    if (v === '') return 'An empty string is not an empty array. Replace the quote marks with square brackets.';
    if (typeof v === 'string' && v.trim() === '[]') return 'Those quote marks make it a string that only looks like an array. Take the quote marks off.';
    if (typeof v === 'object' && v !== null) return 'Curly braces make an object. An empty array is two square brackets with nothing between them.';
    return 'Make `requests` an empty array: two square brackets with nothing between them.';
  },
  hints: ['An empty array has no items, so nothing goes between its brackets.', 'Replace `""` with square brackets.', 'Write `let requests = [];`.'],
};

// --- step 3: read ---

export const READ = script(`let playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon", "Hallway Echo"];

// The first song is at index 0.
console.log(playlist[0]);

// Print the third song.


// Print how many songs are on the playlist.


// Print the last song.

`);

const READ_LIST = ['Neon Lockers', 'Bus Stop Rain', 'Last Bell', 'Cafeteria Moon', 'Hallway Echo'];
const TYPED_SONG = 'You typed the name of the song. Read it from the array with an index, so that your code keeps working when the playlist changes.';

const longer = (c: JsCheckCtx) => c.run({ data: { playlist: SONGS } });

export const THIRD: JsCheck = {
  id: 'third',
  label: 'Print the third song',
  test(c) {
    const r = longer(c);
    // A crash on a later line doesn't undo a print that worked.
    if (printed(r.output, SONGS, 'Coral')) return undefined;
    const bad = trouble(r);
    if (bad) return bad;
    if (printed(c.output, READ_LIST, 'Last Bell')) return TYPED_SONG;
    if (printed(r.output, SONGS, 'Dune')) return 'Indexes count from 0, so `playlist[3]` is the fourth song. The third song is at index 2.';
    if (loose(r.output, SONGS).some((t) => t.includes('playlist['))) return 'The quote marks turn that into plain text. Take them away, so that JavaScript reads the index.';
    if (r.text.match(listIn(SONGS))) return 'That prints the whole array. Put an index in square brackets after `playlist`, so that you print one song.';
    return 'Add a line that prints the third song, using an index.';
  },
  hints: ['The first song is at index 0, so count up from there.', 'The third song is at index 2.', 'Write `console.log(playlist[2]);`.'],
};

export const COUNT: JsCheck = {
  id: 'count',
  label: 'Print how many songs are on the playlist',
  test(c) {
    const r = longer(c);
    const lines = loose(r.output, SONGS);
    if (lines.some((t) => /\b7\b/.test(t))) return undefined;
    const bad = trouble(r);
    if (bad) return bad;
    if (lines.some((t) => /\b6\b/.test(t))) return '`playlist.length - 1` is the last index. The number of songs is `playlist.length`, with nothing subtracted.';
    if (c.output.some((l) => /\b5\b/.test(l.text))) return 'You typed the number. Use `playlist.length`, so that the count stays right when songs are added.';
    return 'Add a line that prints `playlist.length`.';
  },
  hints: ['Every array knows how many items it has.', '`length` is a property, so it has no parentheses.', 'Write `console.log(playlist.length);`.'],
};

export const LAST: JsCheck = {
  id: 'last',
  label: 'Print the last song',
  test(c) {
    const r = longer(c);
    const bad = trouble(r);
    if (bad) return bad;
    if (printed(r.output, SONGS, 'Glow')) return undefined;
    if (printed(r.output, SONGS, 'Ember')) return 'Index 4 only works while the playlist has 5 songs. Work out the index from `playlist.length`, so that it finds the last song on a longer list.';
    if (printed(c.output, READ_LIST, 'Hallway Echo')) return TYPED_SONG;
    if (loose(c.output, READ_LIST).some((t) => t.includes('undefined'))) return 'Your code read one spot past the end, so it printed undefined. The indexes stop one short of the length, so the last song is at `playlist.length - 1`.';
    return 'Add a line that prints the last song. Work out its index from `playlist.length`.';
  },
  hints: ['A playlist of 5 songs has indexes 0 to 4.', 'The last index is always one less than the length.', 'Write `console.log(playlist[playlist.length - 1]);`.'],
};

// --- step 4: change ---

export const CHANGE = script(`const playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon"];
const votes = [12, 9, 15, 7];

// Make your three changes here.


console.log(playlist);
console.log(votes);
`);

const VOTES = [3, 5, 8, 13, 21, 34, 55];
const RETYPED = 'You typed out a whole new array. Change one spot instead, so that the rest of the list stays as it was.';
const changed = (c: JsCheckCtx) => c.run({ data: { playlist: SONGS, votes: VOTES } });
const has = (v: unknown, item: unknown) => Array.isArray(v) && v.includes(item);

export const SECOND: JsCheck = {
  id: 'second',
  label: 'Replace the second song with Thunder Gym',
  test(c) {
    const r = changed(c);
    const bad = trouble(r);
    if (bad) return bad;
    const p = r.vars.playlist;
    if (!Array.isArray(p)) return '`playlist` needs to stay an array. Assign to one index, like `playlist[1] = "Thunder Gym";`.';
    const want = 'Thunder Gym';
    if (p[1] === want) return p[0] === 'Aqua' && p[2] === 'Coral' ? undefined : RETYPED;
    if (p[2] === want) return 'Indexes count from 0, so `playlist[2]` is the third song. The second song is at index 1.';
    if (p[0] === want) return '`playlist[0]` is the first song. The second song is at index 1.';
    if (p[p.length - 1] === want) return 'That added a song to the end. This task replaces the second song, so assign to index 1.';
    if (has(c.vars.playlist, want)) return RETYPED;
    return 'Give `playlist[1]` a new value with one equals sign.';
  },
  hints: ['The second song is at index 1.', 'Use `=` to give that spot a new value. The new song needs quote marks.', 'Write `playlist[1] = "Thunder Gym";`.'],
};

export const LAST_SPOT: JsCheck = {
  id: 'last-spot',
  label: 'Replace the last song with Parking Lot Stars',
  test(c) {
    const r = changed(c);
    const bad = trouble(r);
    if (bad) return bad;
    const p = r.vars.playlist as unknown[];
    const want = 'Parking Lot Stars';
    if (p.length === SONGS.length && p[p.length - 1] === want) return undefined;
    if (p.length > SONGS.length && p[p.length - 1] === want) return '`playlist.length` is one past the end, so that added a new spot and left the last song alone. The last song is at `playlist.length - 1`.';
    if (p.includes(want)) return 'That index is a fixed number, so it does not follow the list when the list grows. Use `playlist.length - 1` for the index.';
    if (has(c.vars.playlist, want)) return RETYPED;
    return 'Give the last spot a new value. Use `playlist.length - 1` for the index.';
  },
  hints: ['The last index is one less than the length.', 'Put `playlist.length - 1` inside the square brackets.', 'Write `playlist[playlist.length - 1] = "Parking Lot Stars";`.'],
};

export const VOTE: JsCheck = {
  id: 'vote',
  label: 'Add 1 to the third number in votes',
  test(c) {
    const r = changed(c);
    const bad = trouble(r);
    if (bad) return bad;
    const v = r.vars.votes;
    if (!Array.isArray(v)) return '`votes` needs to stay an array. Assign to one index, like `votes[2] = votes[2] + 1;`.';
    if (v[2] === 9 && v[0] === 3 && v[3] === 13) return undefined;
    if (v[3] === 14) return 'Indexes count from 0, so `votes[3]` is the fourth number. The third number is at index 2.';
    if (v[2] === 16) return 'You typed the new total. Add 1 to the number that is already there, so that it works for any number of votes.';
    if (has(c.vars.votes, 16)) return RETYPED;
    if (v[2] === 1) return 'That line set the number to 1. To add 1, write `votes[2] += 1;`.';
    if (c.notes.some((n) => n.rule === 'result-unused')) return 'That line works out the new number and then drops it. Save it back into the array with `=`.';
    return 'Add 1 to `votes[2]`.';
  },
  hints: ['The third number is at index 2.', 'The new value is the old value plus 1.', 'Write `votes[2] = votes[2] + 1;` or `votes[2] += 1;`.'],
};

// --- step 5: edges ---

export const EDGES = script(`const playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon", "Hallway Echo"];

// push adds to the end. pop removes from the end.
// unshift adds to the front. shift removes from the front.

// Make the four changes here, in order.


console.log(playlist);
`);

const pushAssign = (name: string) => `\`push\` changes the array and gives back the new length, so \`${name} = ${name}.push(...)\` replaces your array with a number. Write the \`push\` on its own line, with no \`${name} =\` in front.`;
const PLUS_ARRAY = '`+` turned your array into one long string, because it cannot add an item to an array. Use `push` instead.';
const POP_RETURN = '`pop` gives back the song it removed, so save it: `let removed = playlist.pop();`. Then print `removed`.';
const TWO_SHIFTS = 'Two songs came off the front, because every `shift()` removes one more song. Call it once, and save what it gives back: `let nowPlaying = playlist.shift();`.';

/** Whether the code left the array an array, and the run usable. */
function arrayLeft(c: JsCheckCtx, r: Run, name = 'playlist'): string | undefined {
  const reassigned = r.error?.code === 'const-assign' || typeof r.vars[name] === 'number';
  if (reassigned && c.notes.some((n) => n.rule === 'assign-push')) return pushAssign(name);
  const bad = trouble(r);
  if (bad) return bad;
  const p = r.vars[name];
  if (typeof p === 'string') return PLUS_ARRAY;
  return Array.isArray(p) ? undefined : `\`${name}\` needs to stay an array.`;
}

const WANT_END = 'Thunder Gym';
const WANT_FRONT = 'Senior Sunset';

export const POP: JsCheck = {
  id: 'pop',
  label: 'Remove the last song with pop, and print it',
  test(c) {
    const r = longer(c);
    const bad = arrayLeft(c, r);
    if (bad) return bad;
    const p = r.vars.playlist as unknown[];
    if (p.includes('Glow')) return 'The last song is still on the playlist. Remove it with `playlist.pop()`, and remember the parentheses.';
    if (!p.includes('Fjord') && c.calls('pop').length > 1) return 'Two songs came off the end, because every `pop()` removes one more song. Call it once, and save what it gives back: `let removed = playlist.pop();`.';
    if (printed(r.output, SONGS, 'Glow')) return undefined;
    if (printed(r.output, SONGS, 'Fjord')) return `That prints the song that is last now. ${POP_RETURN}`;
    return `The song came off the playlist, and now it needs printing. ${POP_RETURN}`;
  },
  hints: ['Call it on the array: `playlist.pop()`. It takes no value, and it removes the last item.', '`pop` also gives back the item it removed, so you can save it in a variable.', 'Write `let removed = playlist.pop();`, then `console.log(removed);`.'],
};

export const PUSH: JsCheck = {
  id: 'push',
  label: 'Add Thunder Gym to the end with push',
  test(c) {
    const r = longer(c);
    const bad = arrayLeft(c, r);
    if (bad) return bad;
    const p = r.vars.playlist as unknown[];
    // Fjord is last once the pop is done, so the new song belongs after it. Later steps can change the front.
    const song = p.indexOf(WANT_END);
    const end = p.indexOf('Fjord');
    if (song >= 0) {
      if (end < 0) return 'That wrote over the last song. `push` adds a new spot at the end, however long the array is.';
      if (song > end) return undefined;
      if (song === 0) return '`unshift` adds to the front. `push` adds to the end.';
      return 'You set a spot by number, and on a longer playlist that replaces a song. `push` adds to the end, however long the array is.';
    }
    const code = c.code();
    if (/\.push\s*\[/.test(code)) return '`push` is a method, so it takes parentheses, not square brackets: `playlist.push("Thunder Gym");`.';
    if (/\bplaylist\s*\+/.test(code)) return '`+` cannot add an item to an array. Use `playlist.push("Thunder Gym");`.';
    return 'Add `"Thunder Gym"` to the end with `push`.';
  },
  hints: ['`push` goes after the array name and a dot.', 'The new song goes between the parentheses, in quote marks.', 'Write `playlist.push("Thunder Gym");`.'],
};

export const SHIFT: JsCheck = {
  id: 'shift',
  label: 'Remove the first song with shift, and print it',
  test(c) {
    const r = longer(c);
    const bad = arrayLeft(c, r);
    if (bad) return bad;
    const p = r.vars.playlist as unknown[];
    if (p.includes('Aqua')) {
      const first = c.calls('unshift')[0];
      if (first && c.calls('shift').some((k) => k.line > first.line)) return 'Your `shift` ran after your `unshift`, so it removed Senior Sunset. Make the changes in the order listed.';
      return 'The first song is still on the playlist. Remove it with `playlist.shift()`.';
    }
    if (/\.shift\(\s*["'`]/.test(c.code())) return '`shift` removes the first song and ignores what you pass it. `unshift` is the method that adds to the front.';
    if (!p.includes('Birch') && p[0] !== WANT_FRONT) return TWO_SHIFTS;
    if (printed(r.output, SONGS, 'Aqua')) return undefined;
    return 'Print the song you removed. `shift` gives it back, so save it: `let nowPlaying = playlist.shift();`. Then print `nowPlaying`.';
  },
  hints: ['`shift` works like `pop`, at the front of the array.', 'Like `pop`, `shift` gives back the song it removed.', 'Write `let nowPlaying = playlist.shift();`, then `console.log(nowPlaying);`.'],
};

export const UNSHIFT: JsCheck = {
  id: 'unshift',
  label: 'Add Senior Sunset to the front with unshift',
  test(c) {
    const r = longer(c);
    const bad = arrayLeft(c, r);
    if (bad) return bad;
    const p = r.vars.playlist as unknown[];
    const done = [WANT_FRONT, 'Birch', 'Coral', 'Dune', 'Ember', 'Fjord', WANT_END];
    if (JSON.stringify(p) === JSON.stringify(done)) return undefined;
    if (p[0] === WANT_FRONT) return c.calls('unshift').length ? TWO_SHIFTS : 'That wrote over the first song. `unshift` adds a new song in front, and it moves every other song back one spot.';
    if (p.includes(WANT_FRONT)) return '`push` adds to the end. Use `unshift` to add to the front.';
    return 'Add `"Senior Sunset"` to the front with `unshift`.';
  },
  hints: ['`unshift` works like `push`, at the front of the array.', 'The new song goes between the parentheses, in quote marks.', 'Write `playlist.unshift("Senior Sunset");`.'],
};

// --- step 6: search ---

export const SEARCH = script(`const banned = ["detention anthem", "food fight", "skip class"];
const playlist = ["neon lockers", "bus stop rain", "last bell", "cafeteria moon"];

let request = prompt("What song do you want to hear?");

// The arrays are in lowercase, so the request needs to be too.
request = request.toLowerCase();

// Decide what to print.

`);

const KEEP_PROMPT = 'Keep the `prompt` line, so that your program asks for a request every time it runs.';

const asked = (c: JsCheckCtx, answer: string) => c.run({ prompts: [answer], data: { banned: ['zeta', 'yak', 'quill'], playlist: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] } });
const saysBanned = (r: Run) => /banned/i.test(r.text);
const numbersIn = (r: Run) => (r.text.match(/-?\d+/g) ?? []).map(Number);

export const IS_BANNED: JsCheck = {
  id: 'is-banned',
  label: 'Say when the request is banned',
  test(c) {
    const yes = asked(c, 'yak');
    const no = asked(c, 'alpha');
    if (yes.status === 'waiting') return 'Your program asks more than one question. This task needs one `prompt`.';
    const bad = trouble(yes) ?? trouble(no);
    if (bad) return bad;
    if (!yes.facts.prompts) return KEEP_PROMPT;
    if (saysBanned(yes) && !saysBanned(no)) return undefined;
    const code = c.code();
    if (saysBanned(yes)) {
      if (/\.includes\s*\)/.test(code)) return '`banned.includes` with no parentheses names the method without calling it, so the `if` always passes. Write `banned.includes(request)`.';
      if (/\.indexOf/.test(code)) return '`indexOf` gives -1 for a song it cannot find, and -1 counts as true in an `if`. Use `banned.includes(request)`, which gives true or false.';
      return 'Your program says every song is banned. Test the request with `banned.includes(request)`.';
    }
    if (/\brequest\s*===?\s*banned\b|\bbanned\s*===?\s*request\b/.test(code)) return '`===` compares the request with the whole array, which is never true. `banned.includes(request)` looks through the items.';
    if (/includes\(\s*["'`]request/.test(code)) return 'With quote marks, `"request"` is the word request. Take them away, so that `includes` looks for what the student typed.';
    if (saysBanned(c.run({ prompts: ['food fight'] }))) return 'Your code only knows the songs you typed. Use `banned.includes(request)`, so that it follows the list when the list changes.';
    return 'If `banned` includes the request, print `Sorry, that song is banned.`';
  },
  hints: ['Start with `if (...)`, and put the test between the parentheses.', '`banned.includes(request)` gives true or false.', 'Write `if (banned.includes(request)) {`, and print `Sorry, that song is banned.` inside the braces.'],
};

export const POSITION: JsCheck = {
  id: 'position',
  label: 'Print the number of a song on the list, counting from 1',
  test(c) {
    const found = asked(c, 'delta');
    const bad = trouble(found);
    if (bad) return bad;
    const fourth = numbersIn(found);
    const first = numbersIn(asked(c, 'alpha'));
    if (fourth.includes(31)) return 'That printed 31, because `+` glued the 1 onto the text instead of adding. Put parentheses around the math, like `(spot + 1)`.';
    if (fourth.includes(3) && !fourth.includes(4)) return 'People count from 1, so the song at index 3 is number 4. Print the index plus 1.';
    if (!fourth.includes(4)) return 'When the request is on the playlist, find it with `playlist.indexOf(request)`, then print that number plus 1.';
    if (!first.includes(1)) return 'The first song is at index 0, and your code treated it as missing. Compare what `indexOf` gives back with -1.';
    return undefined;
  },
  hints: ['After the `}` of your first `if`, add `else if (playlist.includes(request)) {`.', 'Inside it, write `let spot = playlist.indexOf(request);`. People count from 1, so the number to print is `spot + 1`.', 'Write `console.log("That song is number " + (spot + 1) + ".");`.'],
};

export const NOT_FOUND: JsCheck = {
  id: 'not-found',
  label: 'Say when the song is not on the playlist',
  test(c) {
    const r = asked(c, 'omega');
    const bad = trouble(r);
    if (bad) return bad;
    const said = numbersIn(r);
    // A line that says so is the answer, and a -1 beside it is a student's own test print.
    if (!/not on/i.test(r.text) && (said.includes(0) || said.includes(-1) || /undefined/.test(r.text))) return '`indexOf` gave -1 because that song is not on the playlist, and your code treated -1 as a song number. Test for it first: `if (spot === -1)`.';
    return r.text.trim() && !saysBanned(r) ? undefined : 'When the song is not on the playlist, print `Not on the playlist yet.`';
  },
  hints: ['What is left after your first two tests is a song that is not on the playlist.', 'Add `else {` after the last `}`.', 'Inside the `else`, write `console.log("Not on the playlist yet.");`.'],
};

// --- step 7: program ---

export const PROGRAM = script(`// Song requests for the dance.
`);

const BOOTH = ['aqua', 'birch', 'coral', 'dune', 'ember', 'fjord', 'glow', 'haze', 'iris'];
const NEW_SONG = 'zephyr';
const WITH_NEW = [...BOOTH, NEW_SONG];

/**
 * Runs a program that asks for a song. A student may ask something else first,
 * or keep asking until Cancel, so later prompts get the same song, then Cancel.
 */
function asking(c: JsCheckCtx, song: string, options: RunOptions = {}): Run {
  let fallback: Run | undefined;
  let last: Run | undefined;
  for (const prompts of [[song], [song, null], [song, song], [song, song, null]]) {
    last = c.run({ ...options, prompts });
    if (last.status === 'waiting') continue;
    if (has(last.vars.requests, song) && !has(last.vars.requests, null)) return last;
    fallback ??= last;
  }
  return fallback ?? last!;
}

const inBooth = (c: JsCheckCtx, song: string) => asking(c, song, { data: { requests: BOOTH } });

export const LIST: JsCheck = {
  id: 'list',
  label: 'Make an array named requests with at least three songs',
  test(c) {
    const r = asking(c, NEW_SONG);
    const bad = /^\s*\[/.test(c.declared('requests')?.init ?? '') ? arrayLeft(c, r, 'requests') : stopped(r);
    if (bad) return bad;
    if (!('requests' in r.vars)) return 'Name your array `requests`, so that this lab can try your code on a different list.';
    const v = r.vars.requests;
    if (Array.isArray(v) && v.filter((s) => s !== NEW_SONG).length >= 3) return undefined;
    if (roundParens(c, 'requests')) return parensNote('requests');
    return Array.isArray(v) ? 'Start `requests` with at least three songs.' : '`requests` needs to be an array, with square brackets around the songs.';
  },
  hints: ['Start with `let requests = [` and then your songs.', 'Each song goes in quote marks, with commas between the songs.', 'Write `let requests = ["Neon Lockers", "Bus Stop Rain", "Last Bell"];` with songs of your own.'],
};

export const ASK: JsCheck = {
  id: 'ask',
  label: 'Ask for a song with prompt',
  test(c) {
    const r = inBooth(c, NEW_SONG);
    const bad = trouble(r);
    if (bad) return bad;
    return r.facts.prompts ? undefined : 'Your program never asks for a song. Use `prompt`, and save the answer in a variable.';
  },
  hints: ['`prompt` gives back what the user typed.', 'Save the answer in a variable named `song`.', 'Write `let song = prompt("What song do you want to hear?");`.'],
};

export const ADD: JsCheck = {
  id: 'add',
  label: 'Add a new song to the end of requests',
  test(c) {
    const r = inBooth(c, NEW_SONG);
    const bad = arrayLeft(c, r, 'requests');
    if (bad) return bad;
    const p = r.vars.requests as unknown[];
    if (p[p.length - 1] === NEW_SONG && BOOTH.every((s) => p.includes(s))) return undefined;
    if (p.includes(NEW_SONG)) return 'You set a spot by number, and that replaces a song on a different list. `push` adds to the end, however long the array is.';
    if (p.includes('song')) return 'With quote marks, `"song"` is the word song. Take them away, so that `push` adds what the user typed.';
    if (p.includes(null)) return 'Ask for the song with your first `prompt`, so that this lab can answer it with a song title.';
    if (/\.push\s*\[/.test(c.code())) return '`push` is a method, so it takes parentheses, not square brackets.';
    if (c.calls('push').length) return 'Your code has a `push`, but it did not run for a new song. Check the test in your `if`.';
    return 'Add the song to the end of `requests` with `push`.';
  },
  hints: ['A new song goes on the end of the array.', '`requests.push(song)` adds it.', 'Put the `push` in the `else` part of your `if`, after you test for the song.'],
};

export const NO_REPEAT: JsCheck = {
  id: 'no-repeat',
  label: 'Do not add a song twice, and print a message',
  test(c) {
    const r = inBooth(c, 'coral');
    const bad = trouble(r);
    if (bad) return bad;
    if ((r.vars.requests as unknown[]).filter((s) => s === 'coral').length > 1) return 'A song that was already on the list got added a second time. Test with `requests.includes(song)` before you add it.';
    const blank = (t: string) => t.replace(new RegExp(WITH_NEW.join('|'), 'g'), '_').replace(/\d+/g, '#');
    const usual = loose(inBooth(c, NEW_SONG).output, WITH_NEW).map(blank);
    return loose(r.output, WITH_NEW).some((t) => !usual.includes(blank(t))) ? undefined : 'When the song is already on the list, print a message that says so.';
  },
  hints: ['`requests.includes(song)` tells you whether the song is already there.', 'Use it as the test in an `if`, with the `push` in the `else`.', 'Inside the `if`, write `console.log("That song is already on the list.");`.'],
};

export const SHOW_LIST: JsCheck = {
  id: 'show-list',
  label: 'Print the whole list with join',
  test(c) {
    const r = inBooth(c, NEW_SONG);
    const items = r.vars.requests as string[];
    if (readable(r.text, items)) return undefined;
    if (readable(r.text, items.slice(0, -1))) return 'That list was printed before the new song went on. Print it after your `push`.';
    return listMistake(c, r, items, 'requests') ?? 'Print the whole list with `requests.join(", ")`.';
  },
  hints: ['`join` gives back one string with all the songs in it.', 'Put what goes between the songs in the parentheses.', 'Write `console.log(requests.join(", "));` after your `if` and `else`.'],
};

export const HOW_MANY: JsCheck = {
  id: 'how-many',
  label: 'Print how many songs are on the list',
  test(c) {
    const numbers = (r: Run) => loose(r.output, WITH_NEW).flatMap((t) => (t.match(/\d+/g) ?? []).map(Number));
    const count = (r: Run) => (r.vars.requests as unknown[]).length;
    const added = inBooth(c, NEW_SONG);
    const repeat = inBooth(c, 'coral');
    if (numbers(added).includes(count(added))) return numbers(repeat).includes(count(repeat)) ? undefined : 'Use `requests.length` for the count, so that it is right when no song was added.';
    if (numbers(added).includes(count(added) - 1)) return 'That count was printed before the new song went on. Print `requests.length` after your `push`.';
    return 'Print how many songs are on the list with `requests.length`.';
  },
  hints: ['`length` tells you how many items an array has.', 'Print it after the new song has gone on the list.', 'Write `console.log(requests.length);`.'],
};

// --- optional extra challenge: remove ---

export const REMOVE = script(`const requests = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon"];

let song = prompt("Which song should come off the list?");

`);

const SHORT_LIST = ['aqua', 'birch', 'coral', 'dune', 'ember'];
const removing = (c: JsCheckCtx, song: string) => c.run({ prompts: [song], data: { requests: SHORT_LIST } });
const without = (song: string) => JSON.stringify(SHORT_LIST.filter((s) => s !== song));

export const TAKE_OFF: JsCheck = {
  id: 'take-off',
  label: 'Remove the song the student typed',
  test(c) {
    const r = removing(c, 'birch');
    const bad = trouble(r);
    if (bad) return bad;
    const p = r.vars.requests;
    if (JSON.stringify(p) === without('birch')) {
      if (JSON.stringify(removing(c, 'dune').vars.requests) !== without('dune')) return 'A fixed index only finds one song. Use `requests.indexOf(song)` to find the index.';
      return JSON.stringify(removing(c, 'aqua').vars.requests) === without('aqua') ? undefined : 'The first song is at index 0, and your code left it on the list. Compare what `indexOf` gives back with -1.';
    }
    if (JSON.stringify(p) === JSON.stringify(SHORT_LIST.slice(0, 1))) return '`splice` with one value removes everything from that index to the end. Add a second value, 1, to remove one song.';
    if (/\.splice\(\s*song\b/.test(c.code())) return '`splice` needs an index, not the name of the song. Find the index with `requests.indexOf(song)` first.';
    if (JSON.stringify(p) === JSON.stringify(SHORT_LIST.slice(0, -1))) return '`pop` removes the last song, whatever the user typed. Find the song with `indexOf`, then use `splice`.';
    return 'Find the song with `requests.indexOf(song)`, then remove it with `splice`.';
  },
  hints: ['`requests.indexOf(song)` gives the index. Save it in a variable named `spot`.', '`splice` needs two values: the index, then how many songs to remove.', 'Write `requests.splice(spot, 1);`.'],
};

export const NOT_THERE: JsCheck = {
  id: 'not-there',
  label: 'Leave the list alone when the song is not on it',
  test(c) {
    const r = removing(c, 'omega');
    const bad = trouble(r);
    if (bad) return bad;
    if (JSON.stringify(r.vars.requests) === JSON.stringify(SHORT_LIST.slice(0, -1))) return '`indexOf` gave -1, and `splice(-1, 1)` removes the last song. Test for -1 before you call `splice`.';
    if (JSON.stringify(r.vars.requests) !== JSON.stringify(SHORT_LIST)) return 'A song that is not on the list should not change the array. Test for -1 before you call `splice`.';
    return r.text.trim() ? undefined : 'When the song is not on the list, print a message that says so.';
  },
  hints: ['`indexOf` gives -1 when the song is not there.', 'Put the `splice` inside an `if`.', 'Write `if (spot === -1) {`, print a message, and put the `splice` in the `else`.'],
};

export const SHOW_LEFT: JsCheck = {
  id: 'show-left',
  label: 'Print the list with join',
  test(c) {
    const left = SHORT_LIST.filter((s) => s !== 'birch');
    const r = removing(c, 'birch');
    if (readable(r.text, left)) return undefined;
    return listMistake(c, r, left, 'requests') ?? 'Print what is left with `requests.join(", ")`, after your `if` and `else`.';
  },
  hints: ['Print the list after the `splice`.', 'Put the line after your `if` and `else`, so that it always runs.', 'Write `console.log(requests.join(", "));`.'],
};

// --- optional extra challenge: pick ---

export const PICK_START = script(`const playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon", "Hallway Echo"];

// Pick a random song here.

`);

export const PICK: JsCheck = {
  id: 'pick',
  label: 'Print one song picked at random',
  test(c) {
    return pickMistake(c, SEEDS.map((seed) => c.run({ seed, data: { playlist: SONGS } })), SONGS, 'playlist');
  },
  hints: ['First save a random index in a variable named `spot`.', 'Write `let spot = Math.floor(Math.random() * playlist.length);`.', 'Then print the song at that index: `console.log(playlist[spot]);`.'],
};
