import { describe, expect, test } from 'vitest';
import { jsModel, type JsState } from '../../demos/js';
import type { DemoInput, JsSpec } from '../../demos/types';
import { LabSession } from '../../runtime/session';
import { buildReport } from '../../store/report';
import { playStep } from '../solution';
import { STYLE } from './code';
import { jsDomLab } from './index';
import { CARDS_DONE, CONTENTS_DONE, EVERY_DONE, GRID_DONE, HELLO_DONE, jsDomSolution, LIST_DONE, MORE_DONE, ONE_DONE } from './solution';

const spec = (step: string): JsSpec => jsDomLab.steps.find((s) => s.id === step)!.demos!.find((d) => d.kind === 'js') as JsSpec;

/** Types `code` into script.js and presses Run, with prompt answers and preview clicks to follow. */
function attempt(step: string, code: string, inputs: DemoInput[] = []): JsState {
  const s = spec(step);
  let state = jsModel.apply(s, jsModel.apply(s, jsModel.init(s), { edit: 'script.js', code }), { run: true });
  for (const input of inputs) state = jsModel.apply(s, state, input);
  return state;
}

/** Everything the student reads about this attempt: the error's help, the notes, and the first unmet check. */
const said = (s: JsState): string[] => [...(s.last?.error?.help ? [s.last.error.help] : []), ...(s.notes ?? []).map((n) => n.text), ...(s.checks ?? []).filter((c) => !c.ok && c.note).map((c) => c.note!)];

const allPassed = (s: JsState) => (s.checks ?? []).length > 0 && s.checks!.every((c) => c.ok);

type Wrong = [name: string, code: string, words: string, inputs?: DemoInput[]];
type Right = [name: string, code: string, inputs?: DemoInput[]];

function wrongAttempts(step: string, cases: Wrong[]) {
  describe(`${step}: a wrong attempt gets a note that names it`, () => {
    for (const [name, code, words, inputs] of cases) {
      test(name, () => {
        const s = attempt(step, code, inputs);
        expect(said(s)).toContain(words);
        expect(allPassed(s)).toBe(false);
      });
    }
  });
}

function rightAttempts(step: string, cases: Right[]) {
  describe(`${step}: other correct styles pass`, () => {
    for (const [name, code, inputs] of cases) {
      test(name, () => {
        const s = attempt(step, code, inputs);
        expect(s.last?.status).toBe('ok');
        expect(s.checks?.filter((c) => !c.ok).map((c) => c.note)).toEqual([]);
        expect(allPassed(s)).toBe(true);
        expect(s.notes).toBeUndefined();
      });
    }
  });
}

const STOPPED = 'The program stopped before it finished. Read the error under your page, fix it, and press Run.';
const T = 'let title = document.getElementById("title");\n';
const A = 'let about = document.getElementById("about");\n';
const L = 'let favorites = ["pizza", "soccer", "drawing"];\nlet list = document.getElementById("favorites");\n';
const C = 'let count = 144;\nlet grid = document.getElementById("grid");\n';
const H = 'let headings = document.querySelectorAll("h2");\n';
const P = 'let titles = ["Chess club", "Robot arm", "Bake sale"];\nlet details = ["We meet on Fridays.", "It stacks blocks.", "We raised $80."];\nlet box = document.getElementById("cards");\n';
const M = 'let grid = document.getElementById("grid");\nlet button = document.getElementById("more");\n';
const ADD = 'let cell = document.createElement("div");\ncell.className = "cell";\ngrid.appendChild(cell);\n';
const TASK = `${T}title.textContent = "Sam";\n`;
const WORDS = `${TASK}document.getElementById("tagline").textContent = "I bake.";\n`;
const FULL_LOOP = (body: string) => `${L}for (let i = 0; i < favorites.length; i++) {\n${body}\n}\n`;

describe('starting code', () => {
  for (const step of jsDomLab.steps.filter((s) => s.demos?.some((d) => d.kind === 'js')).map((s) => s.id)) {
    test(`${step} runs clean, draws no note, and passes no check`, () => {
      const s = spec(step);
      const done = jsModel.apply(s, jsModel.init(s), { run: true });
      expect(done.last?.status).toBe('ok');
      expect(done.notes).toBeUndefined();
      expect(done.checks?.[0].ok).toBe(false);
      expect(done.checks?.[0].note).toBeTruthy();
    });
  }

  test('index.html is read only in every coding step', () => {
    for (const s of jsDomLab.steps) for (const d of s.demos ?? []) if (d.kind === 'js') expect(d.files.find((f) => f.name === 'index.html')?.locked, d.id).toBe(true);
  });

  test('the page needs nothing from outside the site', () => {
    for (const s of jsDomLab.steps) for (const d of s.demos ?? []) if (d.kind === 'js') for (const f of d.files) expect(f.text, f.name).not.toMatch(/https?:|\/\/cdn|url\(/);
  });

  test('the first page shows in the preview before Run', () => {
    expect(jsModel.init(spec('hello')).last).toBeUndefined();
    const r = jsModel.apply(spec('hello'), jsModel.init(spec('hello')), { run: true });
    expect(r.last?.page?.body).toContain('Your Name');
  });
});

// --- step 1 ---

wrongAttempts('hello', [
  ['a # in the id', 'let title = document.getElementById("#title");\ntitle.textContent = "Sam";', 'getElementById("#title") found no element. getElementById takes the id alone, and the # belongs only in a CSS selector. Write getElementById("title").'],
  ['getElementByID', 'let title = document.getElementByID("title");\ntitle.textContent = "Sam";', 'document has no method called getElementByID. Did you mean getElementById? Capital and lowercase letters count in JavaScript.'],
  ['getElementsById', 'let title = document.getElementsById("title");\ntitle.textContent = "Sam";', 'document has no method called getElementsById. An id belongs to one element, so the name has no s: getElementById.'],
  ['a misspelled id', 'let title = document.getElementById("titel");\ntitle.textContent = "Sam";', 'getElementById("titel") found no element, so it gave back null. The ids on this page are title, tagline, about. Did you mean "title"?'],
  ['textcontent', `${T}title.textcontent = "Sam";`, 'An element has no property called textcontent, so nothing changed on the page. A browser gives no error for this. Did you mean textContent? Capital and lowercase letters count in JavaScript.'],
  ['innerHtml', `${T}title.innerHtml = "Sam";`, 'An element has no property called innerHtml, so nothing changed on the page. A browser gives no error for this. Did you mean innerHTML? Capital and lowercase letters count in JavaScript.'],
  ['textContent called like a method', `${T}title.textContent("Sam");`, 'textContent is a property, not a method, so it takes no parentheses. Set it with an equals sign, like this: title.textContent = "new value";'],
  ['no change at all', T, 'The heading still says "Your Name". Set `textContent` on `title`, then press Run.'],
  ['the tagline left alone', TASK, 'The paragraph under the heading has not changed. Open `index.html` to find its id, then find it the way the first line finds `title`.'],
  ['an empty heading', `${T}title.textContent = "";`, 'The heading is empty now. Put your name in quotes after the equals sign.'],
  ['a dash in the style name', `${WORDS}title.style.background-color = "gold";`, 'JavaScript reads the dash in background-color as a minus sign, so this line tries to subtract. Property names in JavaScript use a capital letter where CSS uses a dash. Write backgroundColor.'],
  ['a color with no quotes', `${WORDS}title.style.color = gold;`, 'gold has no quotes, so JavaScript looks for a variable called gold. Text goes in quotes, so write "gold".'],
  ['a dot in the class', `${WORDS}title.classList.add(".highlight");`, 'A class name has no dot here. The dot belongs only in a CSS selector. Write classList.add("highlight").'],
  ['a misspelled class', `${WORDS}title.classList.add("highlght");`, 'No rule in style.css uses the class highlght, so this class changes nothing on the page. Did you mean highlight?'],
  ['title.class', `${WORDS}title.class = "highlight";`, 'An element has no property called class, so nothing changed on the page. A browser gives no error for this. Did you mean className?'],
  ['no look changed', WORDS, 'The heading looks the same as before. Set a `style` on `title`, or add the class `highlight`.'],
]);

rightAttempts('hello', [
  ['textContent with one variable each', HELLO_DONE],
  ['innerHTML, querySelector, and style', 'const a = document.querySelector("#title");\na.innerHTML = "Sam";\na.style.color = "gold";\nconst b = document.querySelector("#tagline");\nb.innerHTML = "I <em>build</em> sites.";'],
  ['no variables, a tag selector, and className', 'document.querySelector("h1").textContent = "Sam";\ndocument.querySelector("h1").className = "accent";\ndocument.querySelector("header p").textContent = "I build sites.";'],
  ['setAttribute', `${WORDS}title.setAttribute("style", "color: gold");`],
  ['style and a class together', `${WORDS}title.style.backgroundColor = "gold";\ntitle.classList.add("highlight");`],
]);

test('hello: a class with a rule the student wrote in style.css passes', () => {
  const s = spec('hello');
  let state = jsModel.apply(s, jsModel.init(s), { edit: 'style.css', code: `${STYLE}\n.fancy { color: gold; }\n` });
  state = jsModel.apply(s, state, { edit: 'script.js', code: `${WORDS}title.classList.add("fancy");` });
  state = jsModel.apply(s, state, { run: true });
  expect(allPassed(state)).toBe(true);
});

// --- step 2 ---

wrongAttempts('one', [
  ['made and never added', `${A}let fact = document.createElement("p");\nfact.textContent = "I have two cats.";`, 'The <p> element made on this line never went on the page. Use appendChild to add it to an element that is on the page.'],
  ['made and never added, in the check', `${A}let fact = document.createElement("p");\nfact.textContent = "I have two cats.";`, 'You made an element, but it is not on the page yet. Put your variable inside `about.appendChild()`.'],
  ['appendChild with a string', `${A}about.appendChild("I have two cats.");`, 'appendChild takes an element, and this is a string. Make an element with document.createElement and set its textContent first. To add a string as it is, use append.'],
  ['a tag with brackets', `${A}let fact = document.createElement("<p>");`, 'createElement takes the tag name alone, with no angle brackets or spaces. Write createElement("p").'],
  ['a tag with no quotes', `${A}let fact = document.createElement(p);`, 'p has no quotes, so JavaScript looks for a variable called p. Text goes in quotes, so write "p".'],
  ['added to the body', `${A}let fact = document.createElement("p");\nfact.textContent = "x";\ndocument.body.appendChild(fact);`, 'Your new element is on the page, but outside the About me section. Call `appendChild` on `about`.'],
  ['text set on the section', `${A}about.textContent = "I have two cats.";`, 'The text of `about` changed, but the page has no new element. Use `document.createElement` to make one.'],
  ['an empty element', `${A}let fact = document.createElement("p");\nabout.appendChild(fact);`, 'Your new element is empty, so the page looks the same. Set its `textContent`.'],
  ['text on the section after the add', `${A}let fact = document.createElement("p");\nabout.appendChild(fact);\nabout.textContent = "x";`, 'The text of `about` changed, but the page has no new element. Use `document.createElement` to make one.'],
]);

rightAttempts('one', [
  ['createElement and appendChild', ONE_DONE],
  ['innerHTML +=', `${A}about.innerHTML += "<p>I have two cats.</p>";`],
  ['append with const, before the text is set', `const about = document.getElementById("about");\nconst fact = document.createElement("span");\nabout.append(fact);\nfact.textContent = "I have two cats.";`],
  ['prepend and querySelector', `let about = document.querySelector("#about");\nlet fact = document.createElement("p");\nfact.textContent = "I have two cats.";\nabout.prepend(fact);`],
]);

// --- step 3 ---

const BAD_ITEM = '  let item = document.createElement("li");\n  item.textContent = favorites[i];\n  list.appendChild(item);';

wrongAttempts('list', [
  ['one element, above the loop', `${L}let item = document.createElement("li");\nfor (let i = 0; i < favorites.length; i++) {\n  item.textContent = favorites[i];\n  list.appendChild(item);\n}`, 'The list shows one item, because the loop adds the same element each time. Move `document.createElement("li")` inside the loop.'],
  ['one element, the shared note', `${L}let item = document.createElement("li");\nfor (let i = 0; i < favorites.length; i++) {\n  item.textContent = favorites[i];\n  list.appendChild(item);\n}`, 'The same <li> element was added 3 times, so it only moved, and the page shows it once. Call createElement inside the loop, so each pass makes a new element.'],
  ['textContent on the list', FULL_LOOP('  list.textContent = favorites[i];'), 'The list has text, but no `<li>` elements. Make one `<li>` for each string.'],
  ['one past the end', `${L}for (let i = 0; i <= favorites.length; i++) {\n${BAD_ITEM}\n}`, 'The list has one item too many, because the loop runs past the end of the array. Use `i < favorites.length`.'],
  ['a loop with a fixed number', `${L}for (let i = 0; i < 3; i++) {\n${BAD_ITEM}\n}`, 'The list stops after 3 items, and the array can be longer. Use `favorites.length` in the loop.'],
  ['innerHTML = in the loop', FULL_LOOP('  list.innerHTML = "<li>" + favorites[i] + "</li>";'), 'Each pass of the loop replaced the list, so only the last item is left. Use `+=` with `innerHTML`, or use `appendChild`.'],
  ['tags as text', FULL_LOOP('  list.append("<li>" + favorites[i] + "</li>");'), 'The page shows the tags as plain text, so the list has no `<li>` elements. Use `createElement`, or use `innerHTML` with `+=`.'],
  ['items typed by hand', `${L}list.innerHTML = "<li>pizza</li><li>soccer</li><li>drawing</li>";`, 'The list did not follow the array. Build each item from `favorites` in a loop, so the array decides what the page shows.'],
  ['the whole array on every item', FULL_LOOP('  let item = document.createElement("li");\n  item.textContent = favorites;\n  list.appendChild(item);'), 'Every item shows the same text. Use `favorites[i]`, so each item shows one string.'],
  ['the same index each pass', FULL_LOOP('  let item = document.createElement("li");\n  item.textContent = favorites[0];\n  list.appendChild(item);'), 'Every item shows the same text. Use `favorites[i]`, so each item shows one string.'],
  ['no loop', L, 'The list is empty. Write a loop that adds one `<li>` for each string in `favorites`.'],
  ['a renamed array', 'let foods = ["pizza", "soccer", "drawing"];\nlet list = document.getElementById("favorites");\nfor (let i = 0; i < foods.length; i++) {\n  list.innerHTML += "<li>" + foods[i] + "</li>";\n}', 'Keep the variable named `favorites` at the top of `script.js`, so the checks can try other values.'],
  ['the array left at 3 strings', FULL_LOOP(BAD_ITEM), 'Add one more string to `favorites`, then press Run. Change only the array.'],
]);

const FOUR = 'let favorites = ["ramen", "chess", "hiking", "jazz"];\n';

rightAttempts('list', [
  ['for and appendChild', LIST_DONE],
  ['for...of and append', `${FOUR}const list = document.getElementById("favorites");\nfor (const food of favorites) {\n  const item = document.createElement("li");\n  item.textContent = food;\n  list.append(item);\n}`],
  ['innerHTML +=', `${FOUR}let list = document.querySelector("#favorites");\nfor (let i = 0; i < favorites.length; i++) {\n  list.innerHTML += "<li>" + favorites[i] + "</li>";\n}`],
  ['while and innerHTML on the item', `${FOUR}let list = document.getElementById("favorites");\nlet i = 0;\nwhile (i < favorites.length) {\n  let item = document.createElement("li");\n  item.innerHTML = favorites[i];\n  list.appendChild(item);\n  i++;\n}`],
  ['words added to each item', `${FOUR}let list = document.getElementById("favorites");\nfor (let i = 0; i < favorites.length; i++) {\n  list.innerHTML += "<li>I like " + favorites[i].toUpperCase() + "</li>";\n}`],
  ['push adds the fourth string', `let favorites = ["ramen", "chess", "hiking"];\nfavorites.push("jazz");\nlet list = document.getElementById("favorites");\nfor (let f of favorites) {\n  list.innerHTML += "<li>" + f + "</li>";\n}`],
]);

test('list: one more string makes one more item, with no HTML edited', () => {
  const three = attempt('list', FULL_LOOP(BAD_ITEM));
  const four = attempt('list', LIST_DONE);
  expect(three.last?.page?.body.match(/<li>/g)).toHaveLength(3);
  expect(four.last?.page?.body.match(/<li>/g)).toHaveLength(4);
  expect(four.files.find((f) => f.name === 'index.html')?.text).toBe(three.files.find((f) => f.name === 'index.html')?.text);
});

// --- step 4 ---

const SQUARES = (body: string, top = C) => `${top}for (let i = 0; i < count; i++) {\n  let cell = document.createElement("div");\n${body}\n  grid.appendChild(cell);\n}`;
const SHADE = '  cell.style.backgroundColor = "hsl(" + i * 5 + ", 80%, 60%)";';

wrongAttempts('grid', [
  ['a fixed number in the loop', `${C}for (let i = 0; i < 144; i++) {\n  grid.innerHTML += '<div class="cell"></div>';\n}`, 'The number of squares did not follow `count`. Use `i < count` in the loop, not a number.'],
  ['the element given to classList.add', SQUARES('  cell.classList.add(cell);'), 'A class name goes in quotes, like classList.add("big"). This line gave it an element.'],
  ['no class', SQUARES(SHADE), 'The squares are there, but they have no size yet. Give each one the class `cell`.'],
  ['cell.class', SQUARES('  cell.class = "cell";'), 'An element has no property called class, so nothing changed on the page. A browser gives no error for this. Did you mean className?'],
  ['one element, above the loop', `${C}let cell = document.createElement("div");\ncell.className = "cell";\nfor (let i = 0; i < count; i++) {\n  grid.appendChild(cell);\n}`, 'The grid has one square, because the loop adds the same element each time. Move `document.createElement("div")` inside the loop.'],
  ['every square one color', SQUARES('  cell.className = "cell";\n  cell.style.backgroundColor = "gold";'), 'Every square is the same color. Build the color from `i`, so it changes on each pass.'],
  ['no color', SQUARES('  cell.className = "cell";'), 'The squares have no color yet. Set `cell.style.backgroundColor` inside the loop.'],
  ['i inside the quotes', SQUARES('  cell.className = "cell";\n  cell.style.backgroundColor = "hsl(i, 80%, 60%)";'), 'JavaScript does not look inside quotes, so `i` in that string is only a letter. Build the string with `+`, the way the instructions show.'],
  ['a renamed variable', 'let squares = 144;\nlet grid = document.getElementById("grid");\nfor (let i = 0; i < squares; i++) {\n  grid.innerHTML += \'<div class="cell"></div>\';\n}', 'Keep the variable named `count` at the top of `script.js`, so the checks can try other values.'],
  ['count left at 144', SQUARES(`  cell.className = "cell";\n${SHADE}`), 'Change `count` to 400 on the first line, then press Run. The loop stays the same.'],
  ['an empty grid', C, 'The grid is empty. In a loop that runs `count` times, make a `div` and add it to `grid`.'],
]);

const FOUR_HUNDRED = 'let count = 400;\nlet grid = document.getElementById("grid");\n';

rightAttempts('grid', [
  ['createElement and className', GRID_DONE],
  ['classList, append, a template string, and while', `const count = 400;\nconst grid = document.querySelector("#grid");\nlet i = 0;\nwhile (i < count) {\n  const cell = document.createElement("div");\n  cell.classList.add("cell");\n  cell.style.background = \`hsl(\${i * 3}, 70%, 50%)\`;\n  grid.append(cell);\n  i += 1;\n}`],
  ['innerHTML += with a style attribute', `${FOUR_HUNDRED}for (let i = 0; i < count; i++) {\n  grid.innerHTML += '<div class="cell" style="background-color: hsl(' + i + ', 80%, 60%)"></div>';\n}`],
  ['rgb colors from Math.random', `${FOUR_HUNDRED}for (let i = 0; i < count; i++) {\n  let cell = document.createElement("div");\n  cell.className = "cell";\n  let red = Math.floor(Math.random() * 256);\n  cell.style.backgroundColor = "rgb(" + red + ", 100, 200)";\n  grid.appendChild(cell);\n}`],
]);

test('grid: 400 squares from a script under 10 lines', () => {
  const s = attempt('grid', GRID_DONE);
  expect(s.last?.page?.made).toBe(400);
  expect(s.last?.page?.lines).toBeLessThan(10);
});

// --- step 5 ---

wrongAttempts('every', [
  ['a property set on the list', `${H}headings.textContent = "x";`, 'querySelectorAll gives a list of elements, not one element, so setting textContent on the list changes nothing. A browser gives no error for this. Use a loop and set textContent on each element.'],
  ['style on the list', `${H}headings.style.color = "red";`, 'querySelectorAll gives a list of elements, not one element, so the list has no style. Use a loop, and use style on each element, with [i] after the name of the list.'],
  ['querySelector', 'let first = document.querySelector("h2");\nfirst.classList.add("accent");', '`querySelector("h2")` finds only the first match, and this page has 4. Use `querySelectorAll` and a loop to reach all of them.'],
  ['querySelector with the loop', 'let items = document.querySelector("h2");\nfor (let i = 0; i < items.length; i++) {\n  items[i].classList.add("accent");\n}', 'An element has no length, so a loop over it never runs. querySelector and getElementById give one element. To get a list, use querySelectorAll.'],
  ['querySelector with the loop, in the check', 'let items = document.querySelector("h2");\nfor (let i = 0; i < items.length; i++) {\n  items[i].classList.add("accent");\n}', '`querySelector("h2")` finds only the first match, and this page has 4. Use `querySelectorAll` and a loop to reach all of them.'],
  ['a dot in the class', `${H}for (let i = 0; i < headings.length; i++) {\n  headings[i].classList.add(".accent");\n}`, 'The class went on with a dot in its name, so no CSS rule matches it. Take the dot out of the string.'],
  ['a class with no rule', `${H}for (let i = 0; i < headings.length; i++) {\n  headings[i].classList.add("big");\n}`, 'That class has no rule in `style.css`, so the headings look the same. Use `accent`.'],
  ['classList on the list, in a loop', `${H}for (let i = 0; i < headings.length; i++) {\n  headings.classList.add("accent");\n}`, 'querySelectorAll gives a list of elements, not one element, so the list has no classList. Use a loop, and use classList on each element, with [i] after the name of the list.'],
  ['a dot on a tag', 'let headings = document.querySelectorAll(".h2");\nfor (let i = 0; i < headings.length; i++) {\n  headings[i].classList.add("accent");\n}', 'querySelectorAll(".h2") looks for the class h2, and no element has it. To find <h2> tags, write "h2" with no dot.'],
  ['indexes typed by hand', `${H}headings[0].classList.add("accent");\nheadings[1].classList.add("accent");\nheadings[2].classList.add("accent");\nheadings[3].classList.add("accent");`, 'Some headings changed and others did not. Loop over the whole list, so this works on a page with any number of headings.'],
  ['nothing on the headings', H, 'The headings look the same as before. Use `document.querySelectorAll("h2")`, then add the class `accent` to each heading in a loop.'],
]);

rightAttempts('every', [
  ['for and classList', EVERY_DONE],
  ['for...of and style', `for (const h of document.querySelectorAll("main h2")) {\n  h.style.color = "tomato";\n}`],
  ['getElementsByTagName and className', `let heads = document.getElementsByTagName("h2");\nfor (let i = 0; i < heads.length; i++) {\n  heads[i].className = "accent";\n}`],
]);

// --- step 6 ---

const CARD_LOOP = (extra = '  card.innerHTML = "<h3>" + titles[i] + "</h3><p>" + details[i] + "</p>";') => `${P}for (let i = 0; i < titles.length; i++) {\n  let card = document.createElement("div");\n  card.className = "card";\n${extra}\n  box.appendChild(card);\n}`;

wrongAttempts('cards', [
  ['one array', 'let titles = ["Chess club", "Robot arm", "Bake sale"];\n', 'Make two arrays at the top of your script, such as `titles` and `details`, with at least 3 strings in each.'],
  ['arrays of different lengths', 'let titles = ["Chess club", "Robot arm", "Bake sale"];\nlet details = ["We meet on Fridays."];\n', 'Your arrays need the same number of items, with at least 3 in each, so `titles[0]` and `details[0]` go together.'],
  ['no loop yet', P, 'The `cards` element is empty. Write a loop that adds one `div` to it for each index.'],
  ['no class', `${P}for (let i = 0; i < titles.length; i++) {\n  box.innerHTML += "<div><h3>" + titles[i] + "</h3></div>";\n}`, 'The cards are there, but they have no border or size yet. Give each one the class `card`.'],
  ['one element, above the loop', `${P}let card = document.createElement("div");\ncard.className = "card";\nfor (let i = 0; i < titles.length; i++) {\n  card.textContent = titles[i];\n  box.appendChild(card);\n}`, 'The page has one card, because the loop adds the same element each time. Move `document.createElement("div")` inside the loop.'],
  ['a card short of the array', `${P}for (let i = 0; i < 2; i++) {\n  box.innerHTML += '<div class="card">' + titles[i] + "</div>";\n}`, 'The page has 2 cards and your arrays have 3 items. Make the loop run once per item, with `.length`.'],
  ['cards typed by hand', `${P}box.innerHTML = '<div class="card">Chess club We meet on Fridays.</div><div class="card">Robot arm It stacks blocks.</div><div class="card">Bake sale We raised $80.</div>';`, 'The cards did not follow your arrays. Use the arrays and `.length` in the loop, so a new item makes a new card.'],
  ['a card shows one array', CARD_LOOP('  card.textContent = titles[i];'), 'Each card needs both of its values. Use `[i]` on both arrays, and put both values on the card.'],
  ['the same index each pass', CARD_LOOP('  card.textContent = titles[0] + details[0];'), 'The cards do not change from one to the next. Use `titles[i]` and `details[i]` in the loop, so each card shows its own values.'],
  ['the whole arrays on every card', CARD_LOOP('  card.textContent = titles + " " + details;'), 'The cards do not change from one to the next. Use `titles[i]` and `details[i]` in the loop, so each card shows its own values.'],
  ['the h3 and p added to cards, not the card', `${P}for (let i = 0; i < titles.length; i++) {\n  let card = document.createElement("div");\n  card.classList.add("card");\n  let heading = document.createElement("h3");\n  heading.textContent = titles[i];\n  let text = document.createElement("p");\n  text.textContent = details[i];\n  box.appendChild(heading);\n  box.appendChild(text);\n  box.appendChild(card);\n}`, 'Your cards are empty. Add the `h3` and the `p` to each card, not to the element with the id `cards`.'],
]);

rightAttempts('cards', [
  ['createElement, h3, p, and append', CARDS_DONE],
  ['innerHTML +=', `${P}for (let i = 0; i < titles.length; i++) {\n  box.innerHTML += '<div class="card"><h3>' + titles[i] + "</h3><p>" + details[i] + "</p></div>";\n}`],
  ['other names, numbers, and const', `const teams = ["Hawks", "Bears", "Owls", "Foxes"];\nconst wins = [12, 9, 7, 3];\nconst holder = document.querySelector("#cards");\nfor (let n = 0; n < teams.length; n++) {\n  const c = document.createElement("div");\n  c.classList.add("card");\n  c.textContent = teams[n] + " won " + wins[n] + " games";\n  holder.appendChild(c);\n}`],
  ['for...of and a counter', `${P}let i = 0;\nfor (const t of titles) {\n  box.innerHTML += '<div class="card"><h3>' + t + "</h3><p>" + details[i] + "</p></div>";\n  i++;\n}`],
  ['three parallel arrays', `let places = ["Lima", "Oslo", "Kyoto"];\nlet notes = ["Food", "Fjords", "Temples"];\nlet years = [2030, 2031, 2032];\nlet box = document.getElementById("cards");\nfor (let i = 0; i < places.length; i++) {\n  box.innerHTML += '<div class="card"><h3>' + places[i] + "</h3><p>" + notes[i] + " in " + years[i] + "</p></div>";\n}`],
  ['an array of objects', `let books = [{ title: "Holes", note: "Fun" }, { title: "Dune", note: "Long" }, { title: "Hatchet", note: "Tense" }];\nlet box = document.getElementById("cards");\nfor (let i = 0; i < books.length; i++) {\n  box.innerHTML += '<div class="card"><h3>' + books[i].title + "</h3><p>" + books[i].note + "</p></div>";\n}`],
  ['an array of objects and for...of', `const books = [{ title: "Holes", pages: 233 }, { title: "Dune", pages: 412 }, { title: "Hatchet", pages: 186 }];\nconst box = document.getElementById("cards");\nfor (const b of books) {\n  const card = document.createElement("div");\n  card.className = "card";\n  card.textContent = b.title + " has " + b.pages + " pages";\n  box.append(card);\n}`],
]);

// --- optional extra challenge: table of contents ---

const TOC = `${H}let toc = document.getElementById("toc");\n`;

wrongAttempts('contents', [
  ['a list typed by hand', `${TOC}toc.innerHTML = "<li>About me</li><li>My projects</li><li>Places I want to see</li><li>Say hello</li>";`, 'This list has the right words, but it was typed by hand. Read each heading\'s `textContent` in the loop, so the list follows the page.'],
  ['nothing added to the list', TOC, 'The table of contents is empty. In a loop, add one `<li>` to the element with the id `toc`.'],
  ['the same text for each item', `${TOC}for (let i = 0; i < headings.length; i++) {\n  toc.innerHTML += "<li>" + headings[0].textContent + "</li>";\n}`, 'Every item shows the same text. Use `headings[i].textContent`, so each item shows its own heading.'],
  ['the list as text', `${TOC}for (let i = 0; i < headings.length; i++) {\n  let item = document.createElement("li");\n  item.textContent = headings;\n  toc.appendChild(item);\n}`, 'Every item shows the same text. Use `headings[i].textContent`, so each item shows its own heading.'],
  ['the headings moved into the list', `${TOC}for (let i = 0; i < headings.length; i++) {\n  let item = document.createElement("li");\n  item.appendChild(headings[i]);\n  toc.appendChild(item);\n}`, 'The headings moved into your list, and the sections lost them. Adding an element that is already on the page moves it. Use each heading\'s `textContent`, not the heading itself.'],
  ['an element joined into a string', `${TOC}for (let i = 0; i < headings.length; i++) {\n  toc.innerHTML += "<li>" + headings[i] + "</li>";\n}`, 'An element was used as text, so the page shows [object HTMLHeadingElement]. To show its text, use its textContent. To add the element itself, use appendChild, not + or +=.'],
]);

rightAttempts('contents', [
  ['for and appendChild', CONTENTS_DONE],
  ['for...of and innerHTML +=', `const toc = document.querySelector("#toc");\nfor (const h of document.querySelectorAll("main h2")) {\n  toc.innerHTML += "<li>" + h.textContent + "</li>";\n}`],
  ['getElementsByTagName and links', `let heads = document.getElementsByTagName("h2");\nlet toc = document.getElementById("toc");\nfor (let i = 0; i < heads.length; i++) {\n  let item = document.createElement("li");\n  let link = document.createElement("a");\n  link.textContent = heads[i].textContent;\n  item.append(link);\n  toc.append(item);\n}`],
  ['numbers added to each item', `${TOC}for (let i = 0; i < headings.length; i++) {\n  toc.innerHTML += "<li>" + (i + 1) + ". " + headings[i].textContent + "</li>";\n}`],
]);

// --- optional extra challenge: a button ---

const CLICKS: DemoInput[] = [{ click: '#more' }];
const HANDLER = (body: string) => `${M}button.addEventListener("click", function () {\n${body}\n});\n`;

wrongAttempts('more', [
  ['the handler called', `${M}function addSquare() {\n${ADD}}\nbutton.addEventListener("click", addSquare());`, 'The click has no function to call. Keep the `function () { }` shape from the starting code.'],
  ['code outside the function', `${M}${ADD}button.addEventListener("click", function () {\n});`, 'The square appeared right away, and clicks add nothing. Move your code inside the function.'],
  ['one element, outside the function', `${M}let cell = document.createElement("div");\ncell.className = "cell";\nbutton.addEventListener("click", function () {\n  grid.appendChild(cell);\n});`, 'Only the first click added a square. Make the new element inside the function, so each click makes a new one.'],
  ['nothing inside the function', HANDLER(''), 'A click adds no squares yet. Inside the function, make a `div` with the class `cell`, and add it to `grid`.'],
  ['no class', HANDLER('  grid.appendChild(document.createElement("div"));'), 'Each click should add one square with the class `cell`.'],
  ['a mistake that shows only on a click', HANDLER('  grid.appendChild(square);'), 'Your code stops when the button is clicked. Click the button on your page to see the error.'],
]);

rightAttempts('more', [
  ['createElement and className', MORE_DONE, CLICKS],
  ['innerHTML +=', HANDLER('  grid.innerHTML += \'<div class="cell"></div>\';'), CLICKS],
  ['an arrow function and append', `const grid = document.querySelector("#grid");\ndocument.getElementById("more").addEventListener("click", () => {\n  const cell = document.createElement("div");\n  cell.classList.add("cell");\n  grid.append(cell);\n});`, CLICKS],
  ['a named function passed by name', `${M}function addSquare() {\n${ADD}}\nbutton.addEventListener("click", addSquare);`, CLICKS],
]);

test('more: a click that stops with an error does not tick the click goal', () => {
  const s = attempt('more', HANDLER('  grid.appendChild(square);'), CLICKS);
  const facts = jsModel.facts(spec('more'), s);
  expect(facts.clicks).toBe(1);
  const clicked = jsDomLab.steps.find((x) => x.id === 'more')!.goals!.find((g) => g.id === 'clicked')!;
  const met = (f: typeof facts) => clicked.check({ ev: { type: 'ui:demo', demo: 'more', facts: f } } as never);
  expect(met(facts)).toBe(false);
  expect(met(jsModel.facts(spec('more'), attempt('more', MORE_DONE, CLICKS)))).toBe(true);
});

test('more: a click re-runs through the model, and replays', () => {
  const s = attempt('more', MORE_DONE, [{ click: '#more' }, { click: '#more' }]);
  expect(s.clicks).toEqual(['#more', '#more']);
  expect(s.last?.page?.body.match(/class="cell"/g)).toHaveLength(2);
  expect(jsModel.facts(spec('more'), s).clicks).toBe(2);
  const again = JSON.parse(JSON.stringify(s)) as JsState;
  expect(jsModel.facts(spec('more'), again).clicks).toBe(2);
});

describe('lab', () => {
  test('every check has a hint ladder of at least two rungs', () => {
    for (const s of jsDomLab.steps) for (const d of s.demos ?? []) if (d.kind === 'js') for (const c of d.checks ?? []) expect(c.hints?.length, c.id).toBeGreaterThanOrEqual(2);
  });

  test('check hints use only backticks, the one mark they draw', () => {
    for (const s of jsDomLab.steps) for (const d of s.demos ?? []) if (d.kind === 'js') for (const c of d.checks ?? []) for (const h of c.hints ?? []) expect(h).not.toMatch(/\*\*/);
  });

  test('a stopped program says so, not what is missing', () => {
    expect(said(attempt('hello', 'let x = document.getElementById("nope");\nx.textContent = "a";'))).toContain(STOPPED);
  });

  test('the teacher sees the code from every coding step', () => {
    const now = Date.now();
    const session = new LabSession(jsDomLab, { labId: jsDomLab.id, labVersion: jsDomLab.version, studentId: 's', startedAt: now, updatedAt: now, activeMs: 0, step: 0, maxStep: 0, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] });
    for (const step of jsDomLab.steps) {
      playStep(session, jsDomSolution[step.id]);
      if (step.kind === 'submit' || step.extra) break;
      session.goTo(session.progress.step + 1);
    }
    const report = buildReport(jsDomLab, session.progress, { id: 's', name: 'Sam', period: '1', createdAt: 0 }, 'submitted');
    expect(report.code?.map((c) => c.step)).toEqual(['hello', 'one', 'list', 'grid', 'every', 'cards']);
    expect(report.score.auto).toBe(report.score.autoMax);
  });

  test('the optional extra challenge comes after submit, and its title says what it is', () => {
    const extras = jsDomLab.steps.filter((s) => s.extra);
    expect(extras.map((s) => s.id)).toEqual(['contents', 'more']);
    for (const s of extras) expect(s.title).toMatch(/^Optional extra challenge: /);
    expect(jsDomLab.steps.at(-3)?.kind).toBe('submit');
  });
});
