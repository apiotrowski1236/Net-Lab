import { describe, expect, test } from 'vitest';
import { JsCheckCtx, jsModel, pageOf, type JsState } from '../demos/js';
import type { DemoInput, JsCheck, JsSpec } from '../demos/types';
import { parseFiles, runProgram } from '../js';
import { pageHosts, pageOfFiles, PageView } from './index';

const HTML = `<!doctype html><html><head><title>Me</title><link rel="stylesheet" href="style.css"></head><body>
<h1 id="title">Sam</h1><button id="more">More</button><ul id="list"><li>a</li></ul>
<script src="script.js"></script></body></html>`;

const make = (code: string, checks?: JsCheck[]): JsSpec => ({
  kind: 'js',
  id: 't',
  title: 't',
  files: [
    { name: 'index.html', text: HTML, locked: true },
    { name: 'style.css', text: 'h1 { color: navy; }' },
    { name: 'script.js', text: code },
  ],
  open: 'script.js',
  hosts: pageHosts,
  startPage: pageOfFiles,
  checks,
});

function play(spec: JsSpec, ...inputs: DemoInput[]): JsState {
  let s = jsModel.init(spec);
  for (const i of inputs) s = jsModel.apply(spec, s, i);
  return s;
}

const COUNTER = `let n = 0;
let b = document.getElementById("more");
b.addEventListener("click", function () {
  n = n + 1;
  let li = document.createElement("li");
  li.textContent = "item " + n;
  document.getElementById("list").appendChild(li);
  console.log(n);
});`;

describe('clicks are recorded inputs', () => {
  test('a click re-executes from the start, then dispatches in order', () => {
    const spec = make(COUNTER);
    const s = play(spec, { run: true }, { click: '#more' }, { click: '#more' });
    expect(s.clicks).toEqual(['#more', '#more']);
    expect(s.runs).toBe(1);
    expect(s.last?.page?.body).toContain('item 2');
    expect(s.last?.lines.map((l) => l.text)).toEqual(['1', '2']);
  });

  test('a path from the preview finds the same element as a selector', () => {
    const spec = make(COUNTER);
    const first = play(spec, { run: true });
    const path = /<button id="more" data-nl="([\d.]+)"/.exec(first.last!.page!.body)![1];
    const s = jsModel.apply(spec, first, { click: path });
    expect(s.last?.lines.map((l) => l.text)).toEqual(['1']);
  });

  test('the state is plain JSON, so a reload keeps the page', () => {
    const s = play(make(COUNTER), { run: true }, { click: '#more' });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  test('Math.random gives the same page on replay', () => {
    const spec = make(`let n = Math.random();
document.getElementById("title").textContent = n;
document.getElementById("more").addEventListener("click", function () { console.log("hi"); });`);
    const one = play(spec, { run: true });
    const two = jsModel.apply(spec, one, { click: '#more' });
    expect(two.last?.page?.body).toBe(one.last?.page?.body);
  });

  test('a click on code that changed, or a page with no listeners, is ignored', () => {
    const spec = make(COUNTER);
    const run = play(spec, { run: true });
    const edited = jsModel.apply(spec, run, { edit: 'script.js', code: 'let x = 1;' });
    expect(jsModel.apply(spec, edited, { click: '#more' })).toBe(edited);
    const plain = make('let x = 1;');
    const none = play(plain, { run: true });
    expect(jsModel.apply(plain, none, { click: '#more' })).toBe(none);
    expect(none.last?.page?.body).not.toContain('data-nl');
  });

  test('Run starts over with no clicks', () => {
    const s = play(make(COUNTER), { run: true }, { click: '#more' }, { run: true });
    expect(s.clicks).toBeUndefined();
    expect(s.last?.lines).toEqual([]);
  });

  test('a prompt in a handler waits, and the clicks survive the answer', () => {
    const spec = make(`document.getElementById("more").addEventListener("click", function () {
  document.getElementById("title").textContent = prompt("Name?");
});`);
    const asked = play(spec, { run: true }, { click: '#more' });
    expect(asked.waiting?.message).toBe('Name?');
    const s = jsModel.apply(spec, asked, { answer: 'Ann' });
    expect(s.clicks).toEqual(['#more']);
    expect(s.last?.page?.body).toContain('>Ann<');
  });

  test('Stop at a prompt keeps the page so far and judges the run as it stands', () => {
    const s = play(make('let t = document.getElementById("more");\nt.textContent = "changed";\nwhile (true) {\n  prompt("Again?");\n}'), { run: true }, { answer: 'x' }, { stop: true });
    expect(s.waiting).toBeUndefined();
    expect(s.last?.status).toBe('waiting');
    expect(s.last?.page).toBeDefined();
  });

  test('an error in a handler stops the run where it happened', () => {
    const s = play(make('document.getElementById("more").addEventListener("click", function () {\n  document.getElementById("nope").remove();\n});'), { run: true }, { click: '#more' });
    expect(s.last?.error?.pos.line).toBe(2);
  });

  test('DOMContentLoaded fires after the last line', () => {
    const s = play(make('document.addEventListener("DOMContentLoaded", function () { console.log("ready"); });\nconsole.log("first");'), { run: true });
    expect(s.last?.lines.map((l) => l.text)).toEqual(['first', 'ready']);
  });
});

describe('what a check sees', () => {
  test('the hidden run has its own page, clicks, data, and files', () => {
    const seen: unknown[] = [];
    const spec = make(`let words = ["x"];
let u = document.getElementById("list");
for (let w of words) { let li = document.createElement("li"); li.textContent = w; u.appendChild(li); }
document.getElementById("more").addEventListener("click", function () { u.textContent = ""; });`, [
      {
        id: 'c',
        label: 'c',
        test(c) {
          seen.push(c.page?.count('li'));
          seen.push(c.run({ data: { words: ['p', 'q', 'r'] } }).page?.count('li'));
          seen.push(c.run({ clicks: ['#more'] }).page?.count('li'));
          seen.push(c.run({ files: { 'index.html': '<ul id="list"></ul><button id="more">m</button>' } }).page?.count('li'));
          return undefined;
        },
      },
    ]);
    play(spec, { run: true });
    expect(seen).toEqual([2, 4, 0, 1]);
  });

  test('the view reads text, styles, classes, and what the script made', () => {
    let view: PageView | undefined;
    const spec = make('let t = document.getElementById("title");\nt.textContent = "  New   name ";\nt.style.background = "red";\nt.classList.add("big");\ndocument.body.appendChild(document.createElement("p"));', [
      {
        id: 'c',
        label: 'c',
        test(c: JsCheckCtx) {
          view = c.page;
          return undefined;
        },
      },
    ]);
    play(spec, { run: true });
    expect(view?.text('#title')).toBe('New name');
    expect(view?.style('#title', 'background-color')).toBe('red');
    expect(view?.find('#title')?.classes).toEqual(['big']);
    expect(view?.made).toBe(1);
    expect(view?.find('#title')?.original).toBe(true);
    expect(view?.texts('li')).toEqual(['a']);
    expect(view?.firstOnly()).toBeUndefined();
  });

  test('firstOnly names a querySelector that needed to be querySelectorAll', () => {
    let note: string | undefined;
    const spec = make('let h = document.querySelector("li, h1");', [
      {
        id: 'c',
        label: 'c',
        test(c) {
          note = c.page?.firstOnly();
          return undefined;
        },
      },
    ]);
    play(spec, { run: true });
    expect(note).toBe('`querySelector("li, h1")` finds only the first match, and this page has 2. Use `querySelectorAll` and a loop to reach all of them.');
  });

  test('a page too big to save is rebuilt, not lost', async () => {
    const { pageOf } = await import('../demos/js');
    const spec = make('let u = document.getElementById("list");\nfor (let i = 0; i < 9000; i++) {\n  let li = document.createElement("li");\n  li.className = "row";\n  li.textContent = i;\n  u.appendChild(li);\n}');
    const s = play(spec, { run: true });
    expect(s.last?.page?.big).toBe(true);
    expect(s.last?.page?.body).toBe('');
    expect(s.last?.page?.made).toBe(9000);
    expect(pageOf(spec, s)?.body).toContain('>8999</li>');
  });
});

describe('limits and what stays out', () => {
  const stop = (code: string) => play(make(code), { run: true }).last?.error;

  test.each(['svg', 'textarea'])('a style tag under %s cannot open a real tag', (box) => {
    const code = `let box = document.createElement("${box}");\nlet s = document.createElement("style");\ns.textContent = '</textarea><meta http-equiv="refresh" content="0;url=https://example.com/">';\nbox.appendChild(s);\ndocument.body.appendChild(box);`;
    expect(play(make(code), { run: true }).last?.page?.body).not.toContain('<meta');
  });

  test.each(['document.getElementById("nope");', 'document.body.innerHTML;', 'document.body.outerHTML;', 'document.body.textContent;', 'document.body.lastElementChild;', 'cells.nextElementSibling;', 'document.getElementsByClassName("nope").length;', 'document.getElementsByTagName("nope").length;', 'document.title;', 'cells.textContent = long;', 'cells.className = long;'])('a loop around %s pays for what it reads', (read) => {
    const files = make('').files;
    const steps = (code: string) => {
      const { programs } = parseFiles([...files.slice(0, -1), { name: 'script.js', text: code }]);
      return runProgram(programs, { hosts: (rt) => pageHosts(rt, files) }).steps;
    };
    const page = 'let long = "x".repeat(100000);\nlet cells = document.body.lastElementChild;\nfor (let i = 0; i < 4000; i++) {\n  document.body.appendChild(document.createElement("div"));\n}\n';
    const reads = steps(`${page}for (let i = 0; i < 100; i++) { ${read} }`) - steps(page);
    expect(reads).toBeGreaterThan(5000);
  });

  test('a forgotten i++ over a list ends with the loop message at every step count', () => {
    const files = make('').files;
    for (const list of ['getElementsByTagName("li")', 'querySelectorAll("li")']) {
      for (let pad = 0; pad < 60; pad++) {
        const code = `let a = 0;\n${'a = a + 1;\n'.repeat(pad)}let items = document.${list};\nlet i = 0;\nwhile (i < items.length) {\n  items[i].classList.add("x");\n}\n`;
        const { programs } = parseFiles([...files.slice(0, -1), { name: 'script.js', text: code }]);
        expect(runProgram(programs, { maxSteps: 3000, hosts: (rt) => pageHosts(rt, files) }).limit?.why).toBe('loop');
      }
    }
  });

  test('a long page stays as it was Run while the code is edited', () => {
    const spec = make('for (let i = 0; i < 6000; i++) {\n  let c = document.createElement("div");\n  c.textContent = "ran".repeat(20);\n  document.body.appendChild(c);\n}');
    const ran = play(spec, { run: true });
    expect(ran.last?.page?.big).toBe(true);
    const page = pageOf(spec, ran);
    const edited = jsModel.apply(spec, ran, { edit: 'script.js', code: 'document.body.textContent = "edited";' });
    expect(pageOf(spec, edited)).toBe(page);
  });

  test('a runaway loop stops at the element cap', () => {
    expect(stop('for (let i = 0; i < 50000; i++) { document.body.appendChild(document.createElement("p")); }')?.code).toBe('page-too-big');
  });

  test('a 100 by 100 grid fits', () => {
    const s = play(make('for (let i = 0; i < 10000; i++) {\n  let c = document.createElement("div");\n  document.body.appendChild(c);\n}'), { run: true });
    expect(s.last?.status).toBe('ok');
  });

  test('innerHTML += in a loop counts the page, not every parse', () => {
    expect(stop('let u = document.getElementById("list");\nfor (let i = 0; i < 600; i++) {\n  u.innerHTML += "<li>x</li>";\n}')).toBeUndefined();
  });

  const plain = [
    ['document.cookie;', 'document.cookie is not available in this editor.'],
    ['document.getElementById("title").scrollIntoView();', '<h1 id="title">.scrollIntoView is not available in this editor.'],
    ['document.getElementById("title").addEventListener("mouseover", function () { });', 'The mouseover event is not available in this editor. Use click.'],
    ['document.querySelector("a:hover");', 'The selector a:hover is not available in this editor.'],
    ['document.querySelector("a::before");', 'The selector a::before is not available in this editor.'],
    ['window.onload;', 'window is not available in this editor.'],
  ];
  for (const [code, msg] of plain) test(msg, () => expect(stop(code)?.msg).toBe(msg));

  test('script tags in the page do not run', () => {
    const s = play({ ...make('console.log("mine");'), files: [{ name: 'index.html', text: '<script>console.log("theirs");</script><p>x</p>' }, { name: 'script.js', text: 'console.log("mine");' }] }, { run: true });
    expect(s.last?.lines.map((l) => l.text)).toEqual(['mine']);
  });
});
