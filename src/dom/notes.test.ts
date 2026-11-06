import { describe, expect, test } from 'vitest';
import { jsModel, type JsState } from '../demos/js';
import type { JsSpec } from '../demos/types';
import { LINT_RULES } from '../js';
import { PAGE_RULES, pageHosts, pageOfFiles } from './index';

const HTML = `<!doctype html><html><head><title>Me</title><link rel="stylesheet" href="style.css"></head><body>
<h1 id="title" class="title">Sam</h1><p id="tagline">Hi</p><ul id="favorites"></ul><div class="card"><h2>A</h2></div><div class="card"><h2>B</h2></div>
<script src="script.js"></script></body></html>`;

const spec: JsSpec = {
  kind: 'js',
  id: 't',
  title: 't',
  files: [
    { name: 'index.html', text: HTML, locked: true },
    { name: 'style.css', text: '' },
    { name: 'script.js', text: '' },
  ],
  open: 'script.js',
  hosts: pageHosts,
  startPage: pageOfFiles,
};

function run(code: string): JsState {
  return jsModel.apply(spec, jsModel.apply(spec, jsModel.init(spec), { edit: 'script.js', code }), { run: true });
}

const E = 'let e = document.getElementById("title");\n';

describe('help on an error names the mistake', () => {
  const cases: [string, string, string][] = [
    ['# in an id', 'document.getElementById("#title").textContent = "x";', 'getElementById("#title") found no element. getElementById takes the id alone, and the # belongs only in a CSS selector. Write getElementById("title").'],
    ['getElementByID', 'document.getElementByID("title");', 'document has no method called getElementByID. Did you mean getElementById? Capital and lowercase letters count in JavaScript.'],
    ['getElementsById', 'document.getElementsById("title");', 'document has no method called getElementsById. An id belongs to one element, so the name has no s: getElementById.'],
    ['getElementByClass', 'document.getElementByClass("title");', 'document has no method called getElementByClass. To find elements by class, use document.querySelectorAll(".name") for all of them, or document.querySelector(".name") for the first one.'],
    ['a wrong id', 'document.getElementById("titel").textContent = "x";', 'getElementById("titel") found no element, so it gave back null. The ids on this page are title, tagline, favorites. Did you mean "title"?'],
    ['a wrong id set on an earlier line', 'let a = document.getElementById("titel");\nlet b = document.getElementById("nope");\na.style.color = "red";', 'getElementById("titel") found no element, so it gave back null. The ids on this page are title, tagline, favorites. Did you mean "title"?'],
    ['appendChild with a string', 'document.body.appendChild("text");', 'appendChild takes an element, and this is a string. Make an element with document.createElement and set its textContent first.'],
    ['appendChild on a string', 'let s = "x";\ns.appendChild(document.createElement("p"));', 's is not an element, so it has no appendChild. Elements come from document.getElementById, document.querySelector, and document.createElement.'],
    ['a dash in a style name', `${E}e.style.background-color = "red";`, 'JavaScript reads the dash in background-color as a minus sign, so this line tries to subtract. Property names in JavaScript use a capital letter where CSS uses a dash. Write backgroundColor.'],
    ['a color with no quotes', `${E}e.style.color = red;`, 'red has no quotes, so JavaScript looks for a variable called red. Text goes in quotes, so write "red".'],
    ['a bare word that is an id', 'document.querySelector("tagline").textContent = "x";', 'querySelector("tagline") looks for a <tagline> tag, and this page has none. An id needs a # in front, so write "#tagline".'],
    ['a wrong class', 'document.querySelector(".titel").textContent = "x";', 'querySelector(".titel") found no element, so it gave back null. The classes on this page are title, card. Did you mean ".title"?'],
    ['style on a list', 'document.querySelectorAll("h2").style.color = "red";', 'querySelectorAll gives a list of elements, not one element, so the list has no style. Use a loop, and use style on each element, with [i] after the name of the list.'],
    ['forEach on a collection', 'document.getElementsByClassName("card").forEach(function (c) { });', 'getElementsByClassName and children give a collection, which has no forEach. Use a for loop with an index, or use querySelectorAll.'],
    ['map on a list', 'document.querySelectorAll("h2").map(function (c) { });', 'A list of elements is not an array, so it has no map. Use a for loop with an index.'],
    ['document.write', 'document.write("hi");', 'document.write replaces the whole page in a real browser, so it is left out here. Find an element and set its textContent, or make one with createElement and add it with appendChild.'],
    ['a property called like a method', `${E}e.textContent("x");`, 'textContent is a property, not a method, so it takes no parentheses. Set it with an equals sign, like this: e.textContent = "new value";'],
    ['an id with no quotes', 'let e = document.getElementById(title);', 'title has no quotes, so JavaScript looks for a variable called title. Text goes in quotes, so write "title".'],
    ['a tag with brackets', 'let e = document.createElement("<p>");', 'createElement takes the tag name alone, with no angle brackets or spaces. Write createElement("p").'],
    ['no document in front', 'let e = getElementById("title");', 'getElementById belongs to document, so write document.getElementById.'],
    ['a capital D', 'let e = Document.getElementById("title");', 'The name for the page is document, in all lowercase letters.'],
    ['appending to document', 'document.appendChild(document.createElement("p"));', 'document stands for the whole page, which already has its one <html> element. Add to document.body, or to an element inside it.'],
    ['a list method that is not there', 'document.querySelectorAll("h2").classList.add("x");', 'querySelectorAll gives a list of elements, not one element, so the list has no classList. Use a loop, and use classList on each element, with [i] after the name of the list.'],
  ];
  for (const [name, code, help] of cases) test(name, () => expect(run(code).last?.error?.help).toBe(help));

  test('nothing is listed twice when the error says it', () => expect(run('document.getElementById("#title").textContent = "x";').notes).toBeUndefined());
  test('an error keeps V8 wording in the message', () => expect(run('document.getElementById("titel").textContent = "x";').last?.error?.msg).toBe("Cannot set properties of null (setting 'textContent')"));
  test('a run cut short says nothing about what it never reached', () => expect(run('let p = document.createElement("p");\ndocument.appendChild(p);').notes).toBeUndefined());
});

describe('a note where a browser says nothing', () => {
  const cases: [string, string, string, string][] = [
    ['textcontent', `${E}e.textcontent = "x";`, 'not-a-property', 'An element has no property called textcontent, so nothing changed on the page. A browser gives no error for this. Did you mean textContent? Capital and lowercase letters count in JavaScript.'],
    ['innerHtml', `${E}e.innerHtml = "x";`, 'not-a-property', 'An element has no property called innerHtml, so nothing changed on the page. A browser gives no error for this. Did you mean innerHTML? Capital and lowercase letters count in JavaScript.'],
    ['class', `${E}e.class = "x";`, 'not-a-property', 'An element has no property called class, so nothing changed on the page. A browser gives no error for this. Did you mean className?'],
    ['color', `${E}e.color = "red";`, 'not-a-property', 'An element has no property called color, so nothing changed on the page. A browser gives no error for this. Did you mean style.color?'],
    ['never added', 'let p = document.createElement("p");\np.textContent = "x";', 'never-added', 'The <p> element made on this line never went on the page. Use appendChild to add it to the element that should hold it.'],
    ['title with no dot', 'document.querySelector("title").textContent = "x";', 'selector-no-prefix', 'querySelector("title") looks for a <title> tag, and it found one. If you meant the element with the class title, write ".title".'],
    ['length on one element', 'let one = document.querySelector("h2");\nfor (let i = 0; i < one.length; i++) {\n}', 'element-length', 'An element has no length, so a loop over it never runs. querySelector and getElementById give one element. To get a list, use querySelectorAll.'],
    ['textContent on a list', 'let all = document.querySelectorAll("h2");\nall.textContent = "x";', 'list-property', 'querySelectorAll gives a list of elements, not one element, so setting textContent on the list changes nothing. A browser gives no error for this. Use a loop and set textContent on each element.'],
    ['one element in a loop', 'let u = document.getElementById("favorites");\nlet li = document.createElement("li");\nfor (let i = 0; i < 3; i++) {\n  li.textContent = "x" + i;\n  u.appendChild(li);\n}', 'moved-same-element', 'The same <li> element was added 3 times, so it only moved, and the page shows it once. Call createElement inside the loop, so each pass makes a new element.'],
    ['a dot in a class', `${E}e.classList.add(".big");`, 'class-with-dot', 'A class name has no dot here. The dot belongs only in a CSS selector. Write classList.add("big").'],
    ['tags in text', `${E}e.textContent = "<b>x</b>";`, 'tags-as-text', 'textContent shows tags as plain text, so the page prints the angle brackets. To make the tags work, use innerHTML.'],
    ['an element in a string', 'let u = document.getElementById("favorites");\nu.innerHTML += u.firstElementChild + document.createElement("li");', 'element-as-text', 'An element was used as text, so the page shows [object HTMLLIElement]. To show its text, use its textContent. To add the element itself, use appendChild.'],
    ['a style name', `${E}e.style.colour = "red";`, 'style-unknown', 'colour is not a CSS property, so nothing changed on the page. A browser gives no error for this. Did you mean style.color?'],
    ['a color', `${E}e.style.color = "bleu";`, 'style-bad-value', '"bleu" is not a color, so a browser ignores this line and color stays as it was.'],
    ['no unit', `${E}e.style.width = 100;`, 'style-bad-value', 'width needs a unit, so a browser ignores 100 with no error. Write "100px".'],
    ['a search that is checked first', 'let t = document.getElementById("#title");\nif (t) { t.textContent = "x"; }', 'id-with-hash', 'getElementById("#title") found no element. getElementById takes the id alone, and the # belongs only in a CSS selector. Write getElementById("title").'],
    ['an empty list', 'document.querySelectorAll(".nope").forEach(function (x) { });', 'selector-nothing', 'querySelectorAll(".nope") found no elements, so a loop over it has nothing to do. The classes on this page are title, card.'],
    ['addEventListener with a call', `${E}e.addEventListener("click", console.log("x"));`, 'handler-called', 'addEventListener needs a function, and this line gave it something else. If you wrote the name of a function with () after it, take the () away, so the click calls it and this line does not.'],
  ];
  for (const [name, code, rule, text] of cases) {
    test(name, () => {
      const notes = run(code).notes ?? [];
      expect(notes.find((n) => n.rule === rule)?.text).toBe(text);
    });
  }

  describe('a class with no rule', () => {
    const styled: JsSpec = { ...spec, files: spec.files.map((f) => (f.name === 'style.css' ? { ...f, text: '.highlight { color: gold; }' } : f)) };
    const notes = (code: string) => jsModel.apply(styled, jsModel.apply(styled, jsModel.init(styled), { edit: 'script.js', code }), { run: true }).notes;

    test('offers the closest class in the CSS', () => {
      expect(notes(`${E}e.classList.add("highlght");`)?.[0].text).toBe('No rule in style.css uses the class highlght, so this class changes nothing on the page. Did you mean highlight?');
    });
    test('names the class when nothing is close', () => {
      expect(notes(`${E}e.className = "zzz";`)?.[0].text).toBe('No rule in style.css uses the class zzz, so this class changes nothing on the page.');
    });
    test('a class with a rule draws no note', () => expect(notes(`${E}e.classList.add("highlight");`)).toBeUndefined());
    test('a class the script looks up again draws no note', () => expect(notes(`${E}e.classList.add("seen");\nlet a = document.querySelectorAll(".seen");`)).toBeUndefined());
  });

  test('a stylesheet with no classes draws no class note', () => expect(run(`${E}e.classList.add("on");`).notes).toBeUndefined());

  test('a dot on a tag name says so', () => {
    expect(run('document.querySelector(".h2").textContent = "x";').last?.error?.help).toBe('querySelector(".h2") looks for the class h2, and no element has it. To find <h2> tags, write "h2" with no dot.');
  });

  test('a note stays off for a step that sets lintOff', () => {
    const off = { ...spec, lintOff: ['not-a-property'] };
    const s = jsModel.apply(off, jsModel.apply(off, jsModel.init(off), { edit: 'script.js', code: `${E}e.textcontent = "x";` }), { run: true });
    expect(s.notes).toBeUndefined();
  });

  test('rule ids do not clash with the JavaScript rules', () => {
    expect(PAGE_RULES.filter((r) => (LINT_RULES as readonly string[]).includes(r))).toEqual([]);
  });

  test('moving an element once is not the loop mistake', () => {
    const r = run('let u = document.querySelector("#favorites");\nlet li = document.createElement("li");\nu.appendChild(li);\ndocument.body.appendChild(li);');
    expect(r.notes).toBeUndefined();
  });

  test('an element made, added, and removed was on the page', () => {
    expect(run('let p = document.createElement("p");\ndocument.body.appendChild(p);\np.remove();').notes).toBeUndefined();
  });

  test('an element inside a loose parent is noted once, on the parent', () => {
    const notes = run('let a = document.createElement("div");\nlet b = document.createElement("p");\na.appendChild(b);').notes ?? [];
    expect(notes.map((n) => n.line)).toEqual([1]);
  });
});

describe('correct code draws no note', () => {
  const clean = [
    `${E}e.textContent = "New";`,
    `${E}e.innerHTML = "<em>New</em>";`,
    `${E}e.style.color = "#ff0000";\ne.style.backgroundColor = "hsl(120, 50%, 50%)";\ne.style.width = "10px";\ne.style.margin = 0;`,
    'let u = document.querySelector("#favorites");\nfor (let w of ["a", "b"]) {\n  let li = document.createElement("li");\n  li.textContent = w;\n  u.append(li);\n}',
    'let u = document.getElementById("favorites");\nu.innerHTML += "<li>x</li>";',
    'let all = document.querySelectorAll(".card");\nfor (let i = 0; i < all.length; i++) {\n  all[i].classList.add("on");\n}',
    'document.querySelector("h1").textContent = "x";',
  ];
  for (const code of clean) test(code.slice(0, 50), () => expect(run(code).notes).toBeUndefined());
});
