import type { JsCheck, JsFile } from '../../demos/types';
import type { PageNode, PageView } from '../../dom';

/** Starting code and checks for js-dom. A check reads the page a run left behind, so every style that works in a browser passes. */

export const START_NAME = 'Your Name';
export const START_TAGLINE = 'Write a sentence about yourself here.';
const START_GREETING = 'Welcome to my site.';

const page = (main: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My Site</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1 id="title">${START_NAME}</h1>
    <p id="tagline">${START_TAGLINE}</p>
  </header>
  <main>
${main}
  </main>
  <script src="script.js"></script>
</body>
</html>
`;

const ABOUT = `    <section id="about">
      <h2>About me</h2>
      <p>I like making things for the web.</p>
    </section>`;

export const HELLO_PAGE = page(ABOUT);
export const LOOK_PAGE = page(`    <p id="greeting">${START_GREETING}</p>\n${ABOUT}`);
export const ONE_PAGE = page(ABOUT);
export const LIST_PAGE = page(`    <section>
      <h2>My favorites</h2>
      <ul id="favorites"></ul>
    </section>`);
export const GRID_PAGE = page(`    <section>
      <h2>Color grid</h2>
      <div id="grid"></div>
    </section>`);

const SECTIONS = (heads: string[]) =>
  heads
    .map(
      (h) => `    <section>
      <h2>${h}</h2>
      <p>This part of my site is still growing.</p>
    </section>`,
    )
    .join('\n');
const TOC = `    <nav>
      <h3>On this page</h3>
      <ol id="toc"></ol>
    </nav>`;

export const HEADINGS = ['About me', 'My projects', 'Places I want to see', 'Say hello'];
/** The same page with other headings, so a list typed by hand shows. */
export const OTHER_HEADINGS = ['Music', 'Recipes', 'Book reviews', 'Games', 'Photos'];
export const EVERY_PAGE = page(`${TOC}\n${SECTIONS(HEADINGS)}`);
const OTHER_PAGE = page(`${TOC}\n${SECTIONS(OTHER_HEADINGS)}`);

export const CARDS_PAGE = page(`    <section>
      <h2>My projects</h2>
      <div id="cards"></div>
    </section>`);
export const MORE_PAGE = page(`    <section>
      <h2>Color grid</h2>
      <button id="more">Add a square</button>
      <div id="grid"></div>
    </section>`);

export const STYLE = `body {
  margin: 0;
  font-family: Georgia, serif;
  line-height: 1.5;
  color: #22303c;
  background: #f4f7fb;
}

header {
  padding: 10px 20px;
  text-align: center;
  color: white;
  background: #2f6f73;
}

h1 {
  margin: 0;
  font-size: 28px;
}

header p {
  margin: 0;
}

main {
  max-width: 640px;
  margin: 0 auto;
  padding: 0 20px 20px;
}

h2 {
  margin: 12px 0 8px;
  color: #2f6f73;
}

h3 {
  margin: 12px 0 4px;
}

ol,
ul {
  margin: 4px 0;
}

.highlight {
  padding: 2px 12px;
  border-radius: 6px;
  color: #22303c;
  background: #ffd76a;
}

.accent {
  border-bottom: 3px solid #d9694a;
}

#grid {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.cell {
  width: 14px;
  height: 14px;
  border-radius: 3px;
}

#cards {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.card {
  flex: 1 1 160px;
  padding: 0 14px 4px;
  border: 1px solid #c6d3df;
  border-radius: 10px;
  background: white;
}

.card p {
  margin: 4px 0;
}

button {
  margin-bottom: 8px;
  padding: 6px 14px;
  font: inherit;
}
`;

export const files = (html: string, script: string): JsFile[] => [
  { name: 'index.html', text: html, locked: true },
  { name: 'style.css', text: STYLE },
  { name: 'script.js', text: script },
];

export const HELLO_SCRIPT = `// Find the big heading by its id.
let title = document.getElementById("title");

// Add your code here.
`;

export const LOOK_SCRIPT = `let title = document.getElementById("title");
let greeting = document.getElementById("greeting");

// Add your code here.
`;

export const ONE_SCRIPT = `let about = document.getElementById("about");

// Add your code here.
`;

export const LIST_SCRIPT = `let favorites = ["pizza", "soccer", "drawing"];
let list = document.getElementById("favorites");

// Add your loop here.
`;

export const GRID_SCRIPT = `let count = 144;
let grid = document.getElementById("grid");

// Add your loop here.
`;

export const EVERY_SCRIPT = `// Add your code here.
`;

export const CARDS_SCRIPT = `// Add your arrays and your loop here.
`;

export const MORE_SCRIPT = `let grid = document.getElementById("grid");
let button = document.getElementById("more");

button.addEventListener("click", function () {
  // This code runs each time someone clicks the button.
});
`;

const STOPPED = 'The program stopped before it finished. Read the error under your page, fix that line, and press Run.';
const KEEP = (name: string) => `Keep the variable named \`${name}\` at the top of \`script.js\`, so the checks can try other values.`;

const noted = (notes: readonly { rule: string }[], rule: string) => notes.some((n) => n.rule === rule);
const has = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());

// --- step 1 ---

export const TITLE: JsCheck = {
  id: 'title',
  label: 'Put your name in the big heading',
  test(c) {
    const text = c.page!.text('#title');
    if (text === START_NAME) return c.ok ? 'The heading still says "Your Name". Set `textContent` on `title`, then press Run.' : STOPPED;
    return text ? undefined : 'The heading is empty now. Put your name in quotes after the equals sign.';
  },
  hints: ['`title` holds the heading. Change the text on that element.', 'The property for an element\'s text is `textContent`.', 'Write `title.textContent = "Sam Lee";` with your own name.'],
};

export const TAGLINE: JsCheck = {
  id: 'tagline',
  label: 'Change the sentence under the heading',
  test(c) {
    const text = c.page!.text('#tagline');
    if (text === START_TAGLINE) return c.ok ? 'The sentence under the heading has not changed. Open `index.html` to find its id, then find it the way the first line finds `title`.' : STOPPED;
    return text ? undefined : 'That paragraph is empty now. Give it a sentence about you.';
  },
  hints: ['Open the `index.html` tab and read the `id` on the paragraph under the heading.', 'Make a new variable with `document.getElementById("tagline")`.', 'Write `document.getElementById("tagline").textContent = "I build websites.";` with your own sentence.'],
};

// --- step 2 ---

export const LOOK: JsCheck = {
  id: 'look',
  label: 'Change how the heading looks',
  test(c) {
    const title = c.page!.find('#title');
    if (!title) return c.ok ? 'The heading is gone from the page. Keep the element with the id `title`.' : STOPPED;
    const dotted = title.classes.some((k) => k.startsWith('.'));
    if (title.attr('style') || (title.classes.length && !dotted && !noted(c.notes, 'class-no-rule'))) return undefined;
    if (!c.ok) return STOPPED;
    if (dotted) return 'The class went on with a dot in its name, so no CSS rule matches it. Take the dot out of the string.';
    if (title.classes.length) return 'That class has no rule in `style.css`, so the heading looks the same. Use `highlight`, or add your own rule.';
    return 'The heading looks the same as before. Set a `style` on `title`, or add the class `highlight`.';
  },
  hints: ['You can change a look two ways: set a `style` property, or add a class from `style.css`.', 'A style looks like `title.style.color = "gold";`. A color is a string, so it goes in quotes.', 'Write `title.classList.add("highlight");`.'],
};

export const GREET: JsCheck = {
  id: 'greet',
  label: 'Greet the visitor by name',
  test(c) {
    const asks = (who: string) => c.run({ prompts: [who, who, who, who] });
    const mia = asks('Mia');
    if (!mia.ok) return STOPPED;
    if (!mia.facts.prompts) return 'Use `prompt()` to ask for the visitor\'s name.';
    const zed = asks('Zed');
    if (!zed.ok) return STOPPED;
    const shown = mia.page!.text('#greeting');
    const other = zed.page!.text('#greeting');
    if (has(shown, 'Mia') && has(other, 'Zed')) return undefined;
    const held = Object.keys(mia.vars).find((k) => mia.vars[k] === 'Mia');
    if (held && new RegExp(`\\b${held}\\b`).test(shown)) return `The page shows the word ${held}, not the name. Quotes make it plain text, so take the quotes off \`${held}\`.`;
    if (shown === other && shown !== START_GREETING) return 'The greeting says the same words for every visitor. Join the variable that holds the answer to `prompt()` into the message.';
    return 'Put the answer from `prompt()` into the element with the id `greeting`.';
  },
  hints: ['`prompt()` gives back what the visitor typed, so store it in a variable.', 'Write `let name = prompt("What is your name?");`.', 'Write `greeting.textContent = "Welcome, " + name + "!";`.'],
};

// --- step 3 ---

const freshIn = (p: PageView, selector: string): PageNode[] => p.all(`${selector} *`).filter((n) => !n.original);

export const NEW_ELEMENT: JsCheck = {
  id: 'new-element',
  label: 'Add a new element to the About me section',
  test(c) {
    const p = c.page!;
    if (freshIn(p, '#about').length) return undefined;
    if (!c.ok) return STOPPED;
    if (noted(c.notes, 'never-added')) return 'You made an element, but it is not on the page yet. Add it with `about.appendChild(...)`, with your variable in the parentheses.';
    if (p.made > 0) return 'Your new element is on the page, but outside the About me section. Call `appendChild` on `about`.';
    if (!p.exists('#about h2')) return 'The text of `about` changed, but the page has no new element. Use `document.createElement` to make one.';
    return 'Use `document.createElement("p")` to make a new element, then add it to `about`.';
  },
  hints: ['`document.createElement("p")` makes a `<p>` that is not on the page yet. Store it in a variable.', 'Add it with `appendChild`, called on the element that will hold it.', 'Write `let fact = document.createElement("p");`, then `about.appendChild(fact);`.'],
};

export const NEW_TEXT: JsCheck = {
  id: 'new-text',
  label: 'Give the new element some text',
  test(c) {
    return freshIn(c.page!, '#about').some((n) => n.text) ? undefined : 'Your new element is empty, so the page looks the same. Set its `textContent`.';
  },
  hints: ['A new element starts out empty.', 'Set the text on your new variable, not on `about`.', 'Write `fact.textContent = "I have two cats.";` with your own fact.'],
};

// --- step 4 ---

const FIVE = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];

export const ITEMS: JsCheck = {
  id: 'items',
  label: 'Add one list item for each string in the array',
  test(c) {
    const r = c.run({ data: { favorites: FIVE } });
    if (r.dataMissing.length) return KEEP('favorites');
    if (!r.ok) return STOPPED;
    const p = r.page!;
    const got = p.texts('#favorites li');
    // The array as it ended, since a student may push to it.
    const want = Array.isArray(r.vars.favorites) ? r.vars.favorites.map(String) : FIVE;
    if (got.length === want.length && got.every((t, i) => has(t, want[i]))) return undefined;
    if (!got.length) {
      if (noted(c.notes, 'tags-as-text')) return 'The page shows the tags as plain text, so the list has no `<li>` elements. Use `createElement`, or use `innerHTML` with `+=`.';
      return p.text('#favorites') ? 'The list has text, but no `<li>` elements. Make one `<li>` for each string.' : 'The list is empty. Write a loop that adds one `<li>` for each string in `favorites`.';
    }
    if (got.length === 1) {
      if (noted(c.notes, 'moved-same-element')) return 'The list shows one item, because the loop adds the same element each time. Move `document.createElement("li")` inside the loop.';
      if (has(got[0], want[want.length - 1])) return 'Each pass of the loop replaced the list, so only the last item is left. Use `+=` with `innerHTML`, or use `appendChild`.';
    }
    if (got.length === want.length + 1) return 'The list has one item too many, because the loop runs past the end of the array. Use `i < favorites.length`.';
    if (got.every((t, i) => has(t, want[i]))) return `The list stops after ${got.length} items, and the array can be longer. Use \`favorites.length\` in the loop.`;
    return 'The list did not follow the array. Build each item from `favorites` in a loop, so the array decides what the page shows.';
  },
  hints: ['Start with a `for` loop that counts through `favorites`, like the loops from the last lab.', 'Inside the loop, make an `<li>`, set its `textContent` to `favorites[i]`, and add it to `list`.', 'Write `let item = document.createElement("li");`, then `item.textContent = favorites[i];`, then `list.appendChild(item);`.'],
};

export const ONE_MORE: JsCheck = {
  id: 'one-more',
  label: 'Add one more string to the array',
  test(c) {
    const a = c.vars.favorites;
    return Array.isArray(a) && a.length > 3 ? undefined : 'Add one more string to `favorites`, then press Run. Change only the array.';
  },
  hints: ['Go to the line that makes `favorites`.', 'Put a comma after the last string, then type a new string in quotes.', 'For example: `let favorites = ["pizza", "soccer", "drawing", "chess"];`.'],
};

// --- step 5 ---

export const CELLS: JsCheck = {
  id: 'cells',
  label: 'Make as many squares as count says',
  test(c) {
    const r = c.run({ data: { count: 30 } });
    if (r.dataMissing.length) return KEEP('count');
    if (!r.ok) return STOPPED;
    const p = r.page!;
    if (p.count('#grid .cell') === 30) return undefined;
    const any = p.count('#grid > *');
    if (!any) return 'The grid is empty. In a loop that runs `count` times, make a `div` and add it to `grid`.';
    if (any === 30) return 'The squares are there, but they have no size yet. Give each one the class `cell`.';
    if (any === 1 && noted(c.notes, 'moved-same-element')) return 'The grid has one square, because the loop adds the same element each time. Move `document.createElement("div")` inside the loop.';
    return 'The number of squares did not follow `count`. Use `i < count` in the loop, not a number.';
  },
  hints: ['Write a `for` loop with `i < count`.', 'Inside the loop, make a `div` and store it in a variable called `cell`.', 'Write `cell.className = "cell";`, then `grid.appendChild(cell);`.'],
};

export const COLORS: JsCheck = {
  id: 'colors',
  label: 'Give the squares different colors',
  test(c) {
    const cells = c.run({ data: { count: 30 } }).page!.all('#grid .cell');
    const colors = new Set(cells.map((n) => n.style('background-color')).filter(Boolean));
    if (colors.size > 1) return undefined;
    if (noted(c.notes, 'style-bad-value')) return 'JavaScript does not look inside quotes, so `i` in that string is only a letter. Build the string with `+`, the way the instructions show.';
    if (colors.size === 1) return 'Every square is the same color. Build the color from `i`, so it changes on each pass.';
    return 'The squares have no color yet. Set `cell.style.backgroundColor` inside the loop.';
  },
  hints: ['An `hsl()` color is a string, and its first number picks the color.', 'Use `i` for that first number, so each pass of the loop gets a new color.', 'Write `cell.style.backgroundColor = "hsl(" + i * 5 + ", 80%, 60%)";`.'],
};

export const MANY: JsCheck = {
  id: 'many',
  label: 'Change count to 400',
  test(c) {
    return c.page!.count('#grid .cell') >= 400 ? undefined : 'Change `count` to 400 on the first line, then press Run. The loop stays the same.';
  },
  hints: ['Find the line `let count = 144;`.', 'Write `let count = 400;`, then press Run.'],
};

// --- step 6 ---

const changed = (n: PageNode) => !!n.attr('style') || n.classes.length > 0;

export const EVERY: JsCheck = {
  id: 'every',
  label: 'Change every h2 on the page',
  test(c) {
    const r = c.run({ files: { 'index.html': OTHER_PAGE } });
    if (!r.ok) return STOPPED;
    const p = r.page!;
    const heads = p.all('h2');
    const done = heads.filter(changed).length;
    if (done === heads.length) return undefined;
    const first = p.firstOnly();
    if (first) return first;
    if (noted(c.notes, 'list-property')) return 'Setting a property on the list changes nothing. Write a loop, and set it on one heading at a time.';
    if (!done) return 'The headings look the same as before. Use `document.querySelectorAll("h2")`, then add the class `accent` to each heading in a loop.';
    return 'Some headings changed and others did not. Loop over the whole list, so this works on a page with any number of headings.';
  },
  hints: ['`document.querySelectorAll("h2")` gives a list of every `h2`.', 'A `for` loop can use the list\'s `.length`, and `headings[i]` is one heading.', 'Inside the loop, write `headings[i].classList.add("accent");`.'],
};

export const CONTENTS: JsCheck = {
  id: 'contents',
  label: 'Build the table of contents from the headings',
  test(c) {
    const r = c.run({ files: { 'index.html': OTHER_PAGE } });
    if (!r.ok) return STOPPED;
    const got = r.page!.all('#toc > *').map((n) => n.text);
    if (got.length === OTHER_HEADINGS.length && got.every((t, i) => has(t, OTHER_HEADINGS[i]))) return undefined;
    if (!got.length) return 'The table of contents is empty. In your loop, add one `<li>` to the element with the id `toc`.';
    if (got.length === HEADINGS.length && got.every((t, i) => has(t, HEADINGS[i]))) return 'This list has the right words, but it was typed by hand. Read each heading\'s `textContent` in the loop, so the list follows the page.';
    return 'The table of contents does not match the headings. Add one `<li>` for each `h2`, in order, with that heading\'s text.';
  },
  hints: ['Find the list with `document.getElementById("toc")`.', 'In the loop, make an `<li>` and set its `textContent` to the heading\'s `textContent`.', 'Write `item.textContent = headings[i].textContent;`, then `toc.appendChild(item);`.'],
};

// --- step 7 ---

type Plain = string | number;
const isPlain = (x: unknown): x is Plain => typeof x === 'string' || typeof x === 'number';

/** Arrays that line up by index, by name. A dabbler's array of objects comes back as one entry under `objects`. */
function rowsIn(vars: Record<string, unknown>): { arrays: Record<string, Plain[]>; objects?: { name: string; rows: Record<string, Plain>[] } } {
  const lists = Object.entries(vars).filter((e): e is [string, Plain[]] => Array.isArray(e[1]) && e[1].length >= 3 && e[1].every(isPlain));
  const lengths = new Map<number, [string, Plain[]][]>();
  for (const e of lists) lengths.set(e[1].length, [...(lengths.get(e[1].length) ?? []), e]);
  const best = [...lengths.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const arrays = best.length >= 2 ? Object.fromEntries(best) : {};
  for (const [name, v] of Object.entries(vars)) {
    if (!Array.isArray(v) || v.length < 3) continue;
    const rows = v as Record<string, Plain>[];
    if (rows.every((r) => r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).length >= 2 && Object.values(r).every(isPlain))) return { arrays, objects: { name, rows } };
  }
  return { arrays };
}

/** New values for the rows: one more row, and every value changed, so a card typed by hand can't pass. */
function otherData(vars: Record<string, unknown>): { data: Record<string, unknown>; want: string[][] } | undefined {
  const { arrays, objects } = rowsIn(vars);
  const names = Object.keys(arrays);
  const made = (label: string, row: number, like: Plain): Plain => (typeof like === 'number' ? 7000 + row * 11 : `${label}zq${row}`);
  if (names.length) {
    const size = arrays[names[0]].length + 1;
    const data = Object.fromEntries(names.map((n, k) => [n, Array.from({ length: size }, (_, row) => made(`v${k}`, row, arrays[n][0]))]));
    const want = Array.from({ length: size }, (_, row) => names.map((n) => String((data[n] as Plain[])[row])));
    return { data, want };
  }
  if (objects) {
    const keys = Object.keys(objects.rows[0]);
    const rows = Array.from({ length: objects.rows.length + 1 }, (_, row) => Object.fromEntries(keys.map((k, n) => [k, made(`v${n}`, row, objects.rows[0][k])])));
    return { data: { [objects.name]: rows }, want: rows.map((r) => keys.map((k) => String(r[k]))) };
  }
  return undefined;
}

export const ARRAYS: JsCheck = {
  id: 'arrays',
  label: 'Make two arrays of the same length, with at least 3 items each',
  test(c) {
    const { arrays, objects } = rowsIn(c.vars);
    if (Object.keys(arrays).length >= 2 || objects) return undefined;
    if (!c.ok) return STOPPED;
    const lists = Object.values(c.vars).filter(Array.isArray);
    if (lists.length >= 2) return 'Your arrays need the same number of items, with at least 3 in each, so `titles[0]` and `details[0]` go together.';
    return 'Make two arrays at the top of your script, such as `titles` and `details`, with at least 3 strings in each.';
  },
  hints: ['Choose something for your own site: projects, books, places, or teams.', 'One array holds a title for each card. The other holds a detail for each card.', 'Write `let titles = ["Chess club", "Robot arm", "Bake sale"];`, then a `details` array with 3 strings.'],
};

export const CARDS: JsCheck = {
  id: 'cards',
  label: 'Make one card for each item, in the cards element',
  test(c) {
    if (!c.ok) return STOPPED;
    const { arrays, objects } = rowsIn(c.vars);
    const size = Object.values(arrays)[0]?.length ?? objects?.rows.length ?? 0;
    const p = c.page!;
    const n = p.count('#cards .card');
    if (n === size) return undefined;
    const any = p.count('#cards > *');
    if (!any) return 'The `cards` element is empty. Write a loop that adds one `div` to it for each index.';
    if (any === size) return 'The cards are there, but they have no border or size yet. Give each one the class `card`.';
    if (any === 1 && noted(c.notes, 'moved-same-element')) return 'The page has one card, because the loop adds the same element each time. Move `document.createElement("div")` inside the loop.';
    return `The page has ${n} cards and your arrays have ${size} items. Make the loop run once per item, with \`.length\`.`;
  },
  hints: ['Write a `for` loop that counts through `titles`.', 'Make a `div` in the loop, and give it the class `card`.', 'Add each card with `document.getElementById("cards").appendChild(card);`.'],
};

export const FOLLOWS: JsCheck = {
  id: 'follows',
  label: 'Show both values on each card, from the arrays',
  test(c) {
    const other = otherData(c.vars);
    if (!other) return 'Keep your arrays at the top of your script, outside any loop.';
    const r = c.run({ data: other.data });
    if (r.dataMissing.length) return 'Keep your arrays at the top of your script, outside any loop, so the checks can try other values.';
    if (!r.ok) return STOPPED;
    const cards = r.page!.all('#cards .card').map((n) => n.outer.toLowerCase());
    if (cards.length !== other.want.length) return 'The cards did not follow your arrays. Use the arrays and `.length` in the loop, so a new item makes a new card.';
    const right = (card: string, row: string[]) => row.filter((v) => card.includes(v.toLowerCase())).length;
    if (other.want.every((row, i) => right(cards[i], row) >= 2)) return undefined;
    if (other.want.every((row, i) => right(cards[i], row) >= 1)) return 'Each card needs both of its values. Use `[i]` on both arrays, and put both values on the card.';
    return 'The cards do not change from one to the next. Use `titles[i]` and `details[i]` in the loop, not a number.';
  },
  hints: ['Each card needs a title and a detail from the same index.', 'Inside the loop, make an `h3` and a `p`, and add both to the card.', 'Write `heading.textContent = titles[i];`, then `text.textContent = details[i];`, then `card.append(heading, text);`.'],
};

// --- optional extra challenge ---

export const ADDS: JsCheck = {
  id: 'adds',
  label: 'Add one square for each click',
  test(c) {
    const start = c.run().page!.count('#grid .cell');
    const r = c.run({ clicks: ['#more', '#more', '#more'] });
    if (!r.ok) return STOPPED;
    const added = r.page!.count('#grid .cell') - start;
    if (added === 3) return undefined;
    if (noted(c.notes, 'handler-called')) return 'The click has no function to call. Keep the `function () { }` shape from the starting code.';
    if (start > 0 && added === 0) return 'The square appeared right away, and clicks add nothing. Move your code inside the function.';
    if (added === 1) return 'Only the first click added a square. Make the new element inside the function, so each click makes a new one.';
    if (!r.page!.count('#grid > *')) return 'A click adds no squares yet. Inside the function, make a `div` with the class `cell`, and add it to `grid`.';
    return 'Each click should add one square with the class `cell`.';
  },
  hints: ['The code inside the function runs once for each click.', 'Inside the function, make a `div` and give it the class `cell`.', 'Give it a color too, then write `grid.appendChild(cell);`.'],
};
