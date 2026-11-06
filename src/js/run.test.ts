import { describe, expect, test } from 'vitest';
import { HostObject, Query, errorText, parseFiles, runFiles, type RunOptions, type Runtime, type Value } from './index';

const run = (code: string, options: RunOptions = {}) => runFiles([{ name: 'script.js', text: code }], options);
const out = (code: string, options: RunOptions = {}) => run(code, options).lines.map((l) => l.text);
const stopText = (code: string) => {
  const r = run(code);
  return r.error ? r.error.msg : r.limit?.text;
};

describe('language this editor leaves out', () => {
  const cases: [string, string][] = [
    ['class A {}', 'class is not available in this editor.'],
    ['let a = new Array();', 'new is not available in this editor. To make an array, use square brackets: let list = [];'],
    ['let a = new Map();', 'new is not available in this editor.'],
    ['try { } catch (e) { }', 'try and catch are not available in this editor.'],
    ['throw 5;', 'throw is not available in this editor.'],
    ['let f = async () => 1;', 'async functions are not available in this editor.'],
    ['function* g() { }', 'Generator functions are not available in this editor.'],
    ['let r = /a/;', 'Regular expressions, written between / marks, are not available in this editor.'],
    ['let [a, b] = [1, 2];', 'Destructuring is not available in this editor. Make one variable at a time.'],
    ['let {a} = {a: 1};', 'Destructuring is not available in this editor. Make one variable at a time.'],
    ['f(...x);', 'The spread operator, written with ..., is not available in this editor.'],
    ['let a = {b: 1}; a?.b;', 'Optional chaining, written with ?., is not available in this editor.'],
    ['new Date();', 'new is not available in this editor.'],
    ['this.x;', 'this is not available in this editor. Pass the value in as a parameter instead.'],
    ['import x from "y";', 'import is not available in this editor.'],
    ['Date.now();', 'Date is not available in this editor.'],
    ['typeof Date;', 'Date is not available in this editor.'],
    ['Object.keys({});', 'Object is not available in this editor.'],
    ['JSON.stringify({});', 'JSON is not available in this editor.'],
    ['window.alert(1);', 'window is not available in this editor.'],
    ['document.title;', 'document is not available in this editor.'],
    ['setTimeout(() => 1, 5);', 'setTimeout is not available in this editor.'],
    ['fetch("x");', 'fetch is not available in this editor.'],
    ['eval("1");', 'eval is not available in this editor.'],
    ['globalThis.x;', 'globalThis is not available in this editor.'],
    ['function f() { return arguments; } f();', 'arguments is not available in this editor.'],
    ['Array(5);', 'Array() is not available in this editor. Write an array with square brackets, like [1, 2, 3].'],
    ['Array.from("ab");', 'Array.from is not available in this editor.'],
    ['Math.sin(1);', 'Math.sin is not available in this editor.'],
    ['Number.MAX_VALUE;', 'Number.MAX_VALUE is not available in this editor.'],
    ['String.fromCharCode(65);', 'String.fromCharCode is not available in this editor.'],
    ['console.table([]);', 'console.table is not available in this editor.'],
    ['[1].flat();', 'flat is not available in this editor.'],
    ['"a".charCodeAt(0);', 'charCodeAt is not available in this editor.'],
    ['"a".replaceAll("a", "b");', 'replaceAll is not available in this editor.'],
    ['"a".match("a");', 'match is not available in this editor.'],
    ['(1).toPrecision(2);', 'toPrecision is not available in this editor.'],
    ['({}).hasOwnProperty("a");', 'hasOwnProperty is not available in this editor.'],
    ['[].constructor;', 'constructor is not available in this editor.'],
    ['"a".constructor;', 'constructor is not available in this editor.'],
    ['(5).constructor;', 'constructor is not available in this editor.'],
    ['({}).__proto__;', '__proto__ is not available in this editor.'],
    ['let o = {}; o["__proto__"] = 1;', '__proto__ is not available in this editor.'],
    ['let o = {}; o["con" + "structor"];', 'constructor is not available in this editor.'],
    ['let o = {__proto__: null};', '__proto__ is not available in this editor.'],
    ['let o = {constructor: 1};', 'constructor is not available in this editor.'],
    ['function f() { } f.prototype;', 'prototype is not available in this editor.'],
    ['function f() { } f.call();', 'call is not available in this editor.'],
    ['function f() { } f.constructor("return 1")();', 'constructor is not available in this editor.'],
    ['parseInt.constructor;', 'constructor is not available in this editor.'],
    ['let p = [].push; p(1);', 'push has to be called on an array in this editor, like list.push().'],
    ['Math.x = 1;', 'Changing Math is not available in this editor.'],
    ['console.log = 1;', 'Changing console is not available in this editor.'],
    ['"a".replace("a", () => "b");', 'replace with a function is not available in this editor. Use a string for the new text.'],
  ];
  for (const [code, msg] of cases) {
    test(code, () => {
      const r = run(code);
      expect(r.status).toBe('error');
      expect(r.error?.type).toBe('NotAvailable');
      expect(r.error?.msg).toBe(msg);
      expect(errorText(r.error!)).toBe(msg);
    });
  }
  test('a name the student declared takes priority', () => {
    expect(out('let document = 5; let Date = 1; function fetch() { return 2; } console.log(document, Date, fetch());')).toEqual(['5 1 2']);
  });
  test('a key the browser leaves out of an object is only a missing key', () => {
    expect(out('console.log({}.nope, [].nope, "a".nope, (5).nope);')).toEqual(['undefined undefined undefined undefined']);
  });
});

describe('infinite loops', () => {
  test('a loop that changes nothing stops at 100,000 passes, with the wording from the brief', () => {
    const r = run('console.log("before");\nlet i = 0;\nwhile (i < 5) {\n  console.log;\n}');
    expect(r.status).toBe('limit');
    expect(r.limit).toEqual({ why: 'loop', file: 'script.js', line: 3, text: 'The loop on line 3 ran 100,000 times without stopping. Its condition is i < 5, and i stayed 0 the whole time.' });
    expect(r.lines.map((l) => l.text)).toEqual(['before']);
  });
  test('two names that stayed the same are both named', () => {
    expect(stopText('let i = 0; let n = 2;\nwhile (i < n) { }')).toBe('The loop on line 2 ran 100,000 times without stopping. Its condition is i < n, and i stayed 0 and n stayed 2 the whole time.');
  });
  test('arrays are watched by length', () => {
    expect(stopText('let a = [1, 2];\nlet i = 0;\nwhile (i < a.length) { }')).toBe('The loop on line 3 ran 100,000 times without stopping. Its condition is i < a.length, and i stayed 0 and a.length stayed 2 the whole time.');
  });
  test('a variable that grows gets its own wording', () => {
    expect(stopText('let i = 1;\nwhile (i > 0) {\n  i++;\n}')).toMatch(/^The loop on line 2 ran 2,\d{3},\d{3} times without stopping\. Its condition is i > 0, and i kept growing, from 1 to 2,\d{3},\d{3}, but the condition never became false\.$/);
  });
  test('a variable that shrinks gets its own wording', () => {
    expect(stopText('for (let i = 0; i < 5; i--) {\n}')).toMatch(/Its condition is i < 5, and i kept shrinking, from 0 to -[\d,]+, but the condition never became false\.$/);
  });
  test('while (true) and for (;;) say what would end them', () => {
    expect(stopText('let x = 0;\nwhile (true) { x++; }')).toMatch(/Its condition is true, which never changes, so only a break statement can end the loop\.$/);
    expect(stopText('for (;;) { }')).toMatch(/It has no condition, so only a break statement can end it, and no break ran\.$/);
  });
  test('a for...of over a list that keeps growing', () => {
    expect(stopText('let a = [1];\nfor (const x of a) { a.push(x); }')).toMatch(/a\.length kept growing, so the loop never reached the end of the list\.$/);
  });
  test('the stuck outer loop is named, even when an inner loop is the one running', () => {
    expect(run('let i = 0;\nwhile (i < 5) {\n  for (let j = 0; j < 100000; j++) { }\n}').limit?.line).toBe(2);
  });
  test('the running loop is named when the outer one is moving', () => {
    expect(run('for (let i = 0; i < 2; i++) {\n  let j = 1;\n  while (j > 0) { j++; }\n}').limit?.line).toBe(3);
  });
  test('correct loops that run a long time are left alone', () => {
    expect(out('let t = 0;\nfor (let i = 0; i < 1000000; i++) { t += i; }\nconsole.log(t);')).toEqual(['499999500000']);
    expect(out('let t = 0; let i = 0;\nwhile (i < 5) { t++; if (t > 150000) break; }\nconsole.log(t);')).toEqual(['150001']);
    expect(out('let done = false; let n = 0;\nwhile (!done) { n++; if (n === 150000) done = true; }\nconsole.log(n);')).toEqual(['150000']);
    expect(out('let done = false; let n = 0;\nfunction tick() { n++; if (n === 150000) done = true; }\nwhile (!done) { tick(); }\nconsole.log(n);')).toEqual(['150000']);
  });
  test('a program with no loop still stops', () => {
    expect(run('function f(n) { return n < 2 ? n : f(n - 1) + f(n - 2); }\nf(40);').limit?.why).toBe('steps');
  });
  test('a hidden run with a small budget stops quickly', () => {
    expect(run('let x = 1;\nwhile (x > 0) { x++; }', { maxSteps: 1000 }).limit?.why).toBe('loop');
  });
  test('runaway recursion is a RangeError, and the output stays', () => {
    const r = run('console.log("a");\nfunction f(n) { return f(n + 1); }\nf(0);');
    expect(r.error?.type).toBe('RangeError');
    expect(r.error?.msg).toBe('Maximum call stack size exceeded');
    expect(r.lines.map((l) => l.text)).toEqual(['a']);
  });
  test('a built-in can not run past the budget', () => {
    expect(run('let a = [1, 2, 3];\nwhile (true) { a = a.concat(a); }').status).toBe('limit');
    expect(run('let a = [];\na[4000000000] = 1;\nconsole.log(a.length, a);\na.forEach((x) => x);').status).toBe('limit');
  });
});

describe('output limits', () => {
  test('output stops at 2,000 lines with a message', () => {
    const r = run('for (let i = 0; ; i++) {\n  console.log(i);\n}');
    expect(r.lines).toHaveLength(2000);
    expect(r.limit).toMatchObject({ why: 'output', line: 2, text: 'This program printed 2,000 lines, so it was stopped. A loop may be running more times than you meant.' });
  });
  test('a very long line is cut', () => {
    expect(out('console.log("x".repeat(5000));')[0]).toHaveLength(1001);
  });
  test('a string that doubles forever stops', () => {
    expect(run('let s = "a";\nwhile (true) { s += s; }').limit?.why).toBe('memory');
    expect(run('"a".repeat(100000000);').limit?.why).toBe('memory');
  });
  test('values that share parts many times over print and convert in reasonable time', () => {
    const r = run('let a = [];\nfor (let i = 0; i < 40; i++) { a.push(a.slice()); }\nconsole.log(a);');
    expect(r.status).toBe('ok');
    expect(r.lines[0].text.length).toBeLessThanOrEqual(1001);
  });
});

describe('output lines', () => {
  test('alert and console.log land in one list, in order, marked', () => {
    expect(run('console.log("a");\nalert([1, 2, 3]);\nconsole.error("b");').lines).toEqual([
      { kind: 'log', text: 'a', file: 'script.js', line: 1 },
      { kind: 'alert', text: '1,2,3', file: 'script.js', line: 2 },
      { kind: 'log', text: 'b', error: true, file: 'script.js', line: 3 },
    ]);
  });
});

describe('prompts', () => {
  test('a prompt with no answer waits, keeping what came before', () => {
    const r = run('console.log("hi");\nlet a = prompt("Name?", "Ann");\nconsole.log(a);');
    expect(r.status).toBe('waiting');
    expect(r.waiting).toEqual({ kind: 'prompt', message: 'Name?', default: 'Ann' });
    expect(r.lines.map((l) => l.text)).toEqual(['hi']);
  });
  test('answers replay in order, and each one is shown', () => {
    const r = run('let a = prompt("A");\nlet b = confirm("B");\nconsole.log(a, b);\nlet c = prompt("C");', { answers: ['x', ''] });
    expect(r.waiting?.message).toBe('C');
    expect(r.lines).toEqual([
      { kind: 'prompt', text: 'A', answer: 'x', file: 'script.js', line: 1 },
      { kind: 'confirm', text: 'B', answer: '', file: 'script.js', line: 2 },
      { kind: 'log', text: 'x true', file: 'script.js', line: 3 },
    ]);
  });
  test('Cancel gives null from prompt and false from confirm', () => {
    expect(out('console.log(prompt("A"), confirm("B"));', { answers: [null, null] }).at(-1)).toBe('null false');
  });
});

describe('Math.random', () => {
  const code = 'console.log(Math.random(), Math.random());';
  test('the same seed gives the same numbers', () => {
    expect(out(code, { seed: 3 })).toEqual(out(code, { seed: 3 }));
  });
  test('another seed gives other numbers', () => {
    expect(out(code, { seed: 3 })).not.toEqual(out(code, { seed: 4 }));
  });
  test('values fall in 0 to 1', () => {
    const [text] = out('let ok = true; for (let i = 0; i < 2000; i++) { let r = Math.random(); if (r < 0 || r >= 1) ok = false; } console.log(ok);', { seed: 9 });
    expect(text).toBe('true');
  });
});

describe('data replaces first values', () => {
  const nums = 'let nums = [1, 2, 3];\nlet total = 0;\nfor (const n of nums) {\n  total += n;\n}\nconsole.log(total);';
  test('a let or const with a value', () => {
    expect(out(nums, { data: { nums: [10, 20] } })).toEqual(['30']);
    expect(out('const a = [1];\nconsole.log(a);', { data: { a: ['x', [2]] } })).toEqual(["['x', [2]]"]);
  });
  test('a var, including one inside a block', () => {
    expect(out('var a = 1;\nconsole.log(a);', { data: { a: 2 } })).toEqual(['2']);
    expect(out('if (true) {\n  var a = 1;\n}\nconsole.log(a);', { data: { a: 2 } })).toEqual(['2']);
  });
  test('a declaration with the value on a later line', () => {
    expect(out('let a;\na = [1];\nconsole.log(a);', { data: { a: [5] } })).toEqual(['[5]']);
    expect(out('let a;\na = 1;\na = 2;\nconsole.log(a);', { data: { a: 9 } })).toEqual(['2']);
  });
  test('a variable with no declaration', () => {
    expect(out('nums = [1];\nconsole.log(nums);', { data: { nums: [7] } })).toEqual(['[7]']);
  });
  test('the program can still change the value', () => {
    expect(out('let a = [1];\na.push(2);\nconsole.log(a);', { data: { a: [] } })).toEqual(['[2]']);
    expect(out('let n = 1;\nn = n + 1;\nconsole.log(n);', { data: { n: 5 } })).toEqual(['6']);
  });
  test('a prompt in the replaced value is not asked', () => {
    expect(run('let n = prompt("n");\nconsole.log(n);', { data: { n: '5' } }).status).toBe('ok');
  });
  test('each run gets its own copy', () => {
    const data = { a: [1] };
    run('let a = [];\na.push(2);', { data });
    expect(data).toEqual({ a: [1] });
  });
  test('holes survive', () => {
    expect(out('let a = 1;\nconsole.log(a);', { data: { a: [1, , 3] } })).toEqual(['[1, empty, 3]']);
  });
  test('objects convert', () => {
    expect(out('let o = 1;\nconsole.log(o.a.b, o);', { data: { o: { a: { b: 2 } } } })).toEqual(['2 {a: {b: 2}}']);
  });
  test('a name the program never declares is reported', () => {
    expect(run('let a = 1;', { data: { b: 1 } }).dataMissing).toEqual(['b']);
    expect(run('let a = 1;', { data: { a: 2 } }).dataMissing).toEqual([]);
  });
  test('a variable inside a function or a block is not replaced', () => {
    const r = run('function f() {\n  let a = 1;\n  return a;\n}\nif (true) {\n  let b = 1;\n  console.log(b);\n}\nconsole.log(f());', { data: { a: 5, b: 5 } });
    expect(r.lines.map((l) => l.text)).toEqual(['1', '1']);
    expect(r.dataMissing).toEqual(['a', 'b']);
  });
});

describe('final variables', () => {
  test('are plain values', () => {
    const r = run('let a = [1, , "x"];\nconst o = {k: [true]};\nvar n = NaN;\nlet u;\nfunction f() { }\nlet g = () => 1;\nimplicit = 2;\n{ let inner = 1; }');
    expect(r.vars).toEqual({ a: [1, , 'x'], o: { k: [true] }, n: NaN, u: undefined, f: '[function f]', g: '[function g]', implicit: 2 });
  });
  test('a variable that never got its value is left out', () => {
    expect(Object.keys(run('nope();\nlet late = 1;\nvar early = 2;').vars)).toEqual(['early']);
  });
  test('a value that holds itself is safe', () => {
    expect(run('let a = [];\na.push(a);').vars).toEqual({ a: ['[circular]'] });
  });
});

describe('several files', () => {
  const files = (...texts: string[]) => texts.map((text, i) => ({ name: `f${i}.js`, text }));
  test('share globals and run in order', () => {
    expect(runFiles(files('let a = 1;\nfunction f() { return a + 1; }', 'console.log(f(), a);')).lines.map((l) => l.text)).toEqual(['2 1']);
  });
  test('a file that isn\'t JavaScript does not run', () => {
    expect(runFiles([{ name: 'page.html', text: '<p>' }, { name: 'a.js', text: 'console.log(1);' }]).lines.map((l) => l.text)).toEqual(['1']);
  });
  test('a syntax error in any file stops everything, and names the file', () => {
    const r = runFiles(files('console.log(1);', 'let = ;'));
    expect(r.lines).toEqual([]);
    expect(r.error?.pos.file).toBe('f1.js');
  });
  test('the same let in two files is an error at the second file', () => {
    const r = runFiles(files('let a = 1;\nconsole.log("one");', 'console.log("two");\nlet a = 2;'));
    expect(r.lines.map((l) => l.text)).toEqual(['one']);
    expect(r.error).toMatchObject({ type: 'SyntaxError', msg: "Identifier 'a' has already been declared", pos: { file: 'f1.js', line: 2 } });
  });
  test('errors name the right file', () => {
    expect(runFiles(files('function f() {\n  nope();\n}', 'f();')).error?.pos).toMatchObject({ file: 'f0.js', line: 2 });
  });
});

class FakeElement extends HostObject {
  text = 'old';
  readonly allow = { get: ['textContent', 'id'], set: ['textContent'], call: ['getAttribute'] };
  label() {
    return '<p id=intro>';
  }
  get(name: string): Value {
    return name === 'textContent' ? this.text : 'intro';
  }
  set(name: string, value: Value, rt: Runtime) {
    if (name === 'textContent') this.text = rt.str(value);
  }
  call(name: string, args: Value[], rt: Runtime): Value {
    return `${name}:${rt.str(args[0])}`;
  }
}

class FakeDocument extends HostObject {
  readonly allow = { get: ['title'], call: ['getElementById', 'each', 'querySelectorAll'] };
  constructor(
    readonly el: FakeElement,
    readonly title = 'My page',
  ) {
    super();
  }
  label() {
    return 'document';
  }
  get(): Value {
    return this.title;
  }
  call(name: string, args: Value[], rt: Runtime): Value {
    if (name === 'getElementById') return rt.str(args[0]) === 'intro' ? this.el : null;
    if (name === 'each') return rt.call(args[0], undefined, [1, 2]);
    return new FakeList([this.el, this.el]);
  }
}

class FakeList extends HostObject {
  readonly allow = {};
  constructor(readonly list: Value[]) {
    super();
  }
  label() {
    return 'NodeList';
  }
  items() {
    return this.list;
  }
}

describe('host objects', () => {
  const hosted = (code: string, el = new FakeElement()) => run(code, { hosts: () => ({ document: new FakeDocument(el) }) });
  test('get, set, and call go through the allowed names', () => {
    const el = new FakeElement();
    const r = hosted('let p = document.getElementById("intro");\nconsole.log(document.title, p.textContent, p.getAttribute("x"));\np.textContent = "new " + 1;\nconsole.log(p, [p], typeof p, document);', el);
    expect(r.lines.map((l) => l.text)).toEqual(['My page old getAttribute:x', '<p id=intro> [<p id=intro>] object document']);
    expect(el.text).toBe('new 1');
  });
  test('a name that is not allowed stops', () => {
    expect(hosted('document.cookie;').error?.msg).toBe('document.cookie is not available in this editor.');
    expect(hosted('document.write("x");').error?.msg).toBe('document.write is not available in this editor.');
    expect(hosted('document.title = "x";').error?.msg).toBe('Setting document.title is not available in this editor.');
    expect(hosted('document.constructor;').error?.type).toBe('NotAvailable');
    expect(hosted('document["__pro" + "to__"];').error?.type).toBe('NotAvailable');
  });
  test('host calls can run a student function', () => {
    expect(hosted('console.log(document.each((a, b) => a + b));').lines[0].text).toBe('3');
  });
  test('a null from a host gives the usual error', () => {
    expect(hosted('document.getElementById("nope").textContent;').error?.msg).toBe("Cannot read properties of null (reading 'textContent')");
  });
  test('for...of reads a list', () => {
    expect(hosted('for (const x of document.querySelectorAll("p")) console.log(x);').lines.map((l) => l.text)).toEqual(['<p id=intro>', '<p id=intro>']);
  });
  test('without hosts, document is still not available', () => {
    expect(run('document.title;').error?.type).toBe('NotAvailable');
  });
  test('the name can not be replaced', () => {
    expect(hosted('document = 5;\nconsole.log(document);').lines[0].text).toBe('document');
  });
});

describe('the step-through trace', () => {
  const steps = (code: string, options: RunOptions = {}) => run(code, { trace: true, ...options }).trace!;
  test('each loop test is its own step, and says its result', () => {
    const says = steps('for (let i = 0; i < 2; i++) {\n  console.log(i);\n}').map((s) => [s.line, s.say]);
    expect(says).toEqual([
      [1, 'The program is about to start.'],
      [1, 'i is now 0.'],
      [1, 'i < 2 is true, so the loop runs.'],
      [2, 'console.log ran.'],
      [1, 'i is now 1.'],
      [1, 'i < 2 is true, so the loop runs.'],
      [2, 'console.log ran.'],
      [1, 'i is now 2.'],
      [1, 'i < 2 is false, so the loop ends.'],
      [1, 'The program finished.'],
    ]);
  });
  test('a value that isn\'t a boolean says how it counts', () => {
    expect(steps('let x = 3;\nif (x) {\n}')[2].say).toBe('x is 3, which counts as true, so the if block runs.');
    expect(steps('let x = "";\nif (x) {\n} else {\n}')[2].say).toBe("x is '', which counts as false, so the else block runs.");
  });
  test('variables, arrays, and output are recorded, with changes marked', () => {
    const t = steps('let a = [1, 2];\na[1] = 5;\nconsole.log(a[1]);');
    const last = t[t.length - 2];
    expect(t[2].frames[0].vars[0]).toEqual({ name: 'a', text: '[1, 5]', changed: true, items: [{ text: '1' }, { text: '5', changed: true }] });
    expect(last.frames[0].vars[0]).toEqual({ name: 'a', text: '[1, 5]', items: [{ text: '1' }, { text: '5' }] });
    expect(t[2].out).toBe(0);
    expect(last.out).toBe(1);
  });
  test('holes are marked', () => {
    expect(steps('let a = [1, , 3];')[1].frames[0].vars[0].items).toEqual([{ text: '1', changed: undefined }, { text: 'empty', hole: true }, { text: '3' }].map((x) => JSON.parse(JSON.stringify(x))));
  });
  test('a call has its own frame, and hoisted functions stay out of the table', () => {
    const t = steps('function square(x) {\n  let y = x * x;\n  return y;\n}\nlet r = square(3);');
    expect(t.map((s) => s.say)).toEqual(['The program is about to start.', 'Calling square with x = 3.', 'y is now 9.', 'square returns 9.', 'r is now 9.', 'The program finished.']);
    expect(t[2].frames.map((f) => f.name)).toEqual(['square', 'Global']);
    expect(t[2].frames[0].vars.map((v) => v.name)).toEqual(['x', 'y']);
    expect(t[2].frames[1].vars).toEqual([]);
    expect(t[4].frames.map((f) => f.name)).toEqual(['Global']);
  });
  test('a name not reached yet is hidden', () => {
    expect(steps('let a = 1;\nlet b = 2;')[1].frames[0].vars.map((v) => v.name)).toEqual(['a']);
  });
  test('an endless loop is cut, and says so', () => {
    const r = run('let i = 0;\nwhile (true) {\n  i++;\n}', { trace: true });
    expect(r.status).toBe('cut');
    expect(r.trace).toHaveLength(2000);
    expect(r.trace!.at(-1)).toMatchObject({ end: 'cut', say: 'The step-through stops after 2,000 steps. Run the program to see the rest.' });
  });
  test('a prompt ends the trace until it has an answer', () => {
    const code = 'let n = prompt("n");\nconsole.log(n);';
    expect(steps(code).at(-1)).toMatchObject({ end: 'waiting', line: 1, say: 'The program is waiting for your answer to: n' });
    expect(steps(code, { answers: ['5'] }).at(-1)?.end).toBe('done');
  });
  test('a crash ends the trace with the help text', () => {
    expect(steps('let x = 1;\nnope();').at(-1)).toMatchObject({ end: 'error', line: 2 });
  });
});

describe('help on runtime errors', () => {
  const help = (code: string) => run(code).error?.help;
  test('a misspelled variable', () => {
    expect(help('let total = 0;\nconsole.log(totl);')).toBe('There is no variable called totl. Did you mean total?');
    expect(help('let arr = [];\nconsole.log(Arr);')).toBe('There is no variable called Arr. Did you mean arr? JavaScript treats capital and lowercase letters as different.');
    expect(help('Console.log("x");')).toBe('There is no variable called Console. Did you mean console? JavaScript treats capital and lowercase letters as different.');
  });
  test('a misspelled method', () => {
    expect(help('let arr = [];\narr.Push(1);')).toBe('An array has no method called Push. Did you mean arr.push? JavaScript treats capital and lowercase letters as different.');
    expect(help('let s = "a";\ns.toUppercase();')).toBe('A string has no method called toUppercase. Did you mean s.toUpperCase? JavaScript treats capital and lowercase letters as different.');
    expect(help('Math.flor(1);')).toMatch(/Did you mean Math\.floor\?/);
  });
  test('length with parentheses', () => {
    expect(help('let arr = [];\narr.length();')).toBe('length is a property, not a method, so it has no parentheses. Write arr.length with nothing after it.');
  });
  test('reading a property past the end of an array', () => {
    expect(help('let arr = [1];\narr[3].x;')).toBe('arr[3] is undefined. That usually means the index is past the end of the array, and an array of n items has indexes 0 to n - 1. Check the index, or the loop that sets it.');
  });
  test('reading a property of a missing value', () => {
    expect(help('let u;\nu.x;')).toBe('u is undefined, so it has no properties to read. Check where u gets its value.');
  });
  test('const', () => {
    expect(help('const c = 1;\nc = 2;')).toBe("c was declared with const, so it can't be given a new value. Change const to let where c is declared.");
    expect(help('const a = [1];\na = [2];')).toBe("a was declared with const, so it can't be given a whole new array. You can still change it one item at a time, with an index or a method like push. If you do want a new array, change const to let where a is declared.");
  });
  test('used before its line', () => {
    expect(help('console.log(x);\nlet x = 1;')).toBe('x is used before the line that declares it. Move the let or const line above this line.');
  });
  test('every error has help', () => {
    for (const code of ['nope;', 'let a = 1; a();', 'let u; u.x;', 'let u; u.x = 1;', 'for (const a of 5) { }', '"x" in 5;', '[].reduce((a, b) => a);', '[1].map(5);', '"a".repeat(-1);', '(1).toFixed(101);', '(1).toString(1);', 'let a = []; a.length = -1;', '[1].sort(5);', 'let o = {toString: 1, valueOf: 1}; o + 1;']) {
      expect(help(code), code).toBeTruthy();
    }
  });
});

describe('Query', () => {
  const q = (code: string) => new Query(parseFiles([{ name: 'script.js', text: code }]).programs);
  const code = `// a comment with push(1)
let nums = [1, 2];
const label = "a" + 1;
for (let i = 0; i < nums.length; i++) {
  console.log(nums[i]);
  while (i > 9) {
    nums.push(1, "x");
  }
}
function add(a, b = 1) {
  for (const n of nums) {
    alert(n);
  }
  return a + b;
}
let dbl = (x) => x * 2;
do {
  total = 1;
  total++;
} while (false);
`;
  test('loops', () => {
    expect(q(code).loops().map(({ kind, line, test, head, depth, inFunction }) => ({ kind, line, test, head, depth, inFunction }))).toEqual([
      { kind: 'for', line: 4, test: 'i < nums.length', head: 'let i = 0; i < nums.length; i++', depth: 0, inFunction: undefined },
      { kind: 'while', line: 6, test: 'i > 9', head: 'i > 9', depth: 1, inFunction: undefined },
      { kind: 'for-of', line: 11, test: 'nums', head: 'const n of nums', depth: 0, inFunction: 'add' },
      { kind: 'do', line: 17, test: 'false', head: 'false', depth: 0, inFunction: undefined },
    ]);
  });
  test('calls', () => {
    expect(q(code).calls('push').map(({ name, callee, receiver, args, line, inLoop }) => ({ name, callee, receiver, args, line, inLoop }))).toEqual([{ name: 'push', callee: 'nums.push', receiver: 'nums', args: ['1', '"x"'], line: 7, inLoop: true }]);
    expect(q(code).calls('console.log')).toHaveLength(1);
    expect(q(code).calls('log')).toHaveLength(1);
    expect(q(code).calls('alert')[0]).toMatchObject({ inLoop: true, inFunction: 'add' });
    expect(q(code).calls('nope')).toEqual([]);
  });
  test('declarations', () => {
    expect(q(code).declared('nums')).toMatchObject({ kind: 'let', line: 2, init: '[1, 2]', scope: 'top', inLoop: false });
    expect(q(code).declared('label')).toMatchObject({ kind: 'const', init: '"a" + 1' });
    expect(q(code).declared('i')).toMatchObject({ kind: 'let', line: 4, scope: 'block' });
    expect(q(code).declared('add')).toMatchObject({ kind: 'function', scope: 'top' });
    expect(q(code).declared('total')).toBeUndefined();
  });
  test('functions', () => {
    expect(q(code).fn('add')).toMatchObject({ params: ['a', 'b'], arrow: false, line: 10 });
    expect(q(code).fn('dbl')).toMatchObject({ params: ['x'], arrow: true, line: 16 });
    expect(q(code).functions()).toHaveLength(2);
  });
  test('uses and assignments', () => {
    expect(q(code).uses('nums')).toEqual([4, 5, 7, 11]);
    expect(q(code).assigned('total')).toEqual([18, 19]);
    expect(q(code).uses('nope')).toEqual([]);
  });
  test('code with comments removed keeps strings and line numbers', () => {
    const c = q('// push\nlet u = "http://x"; /* a\nb */ let v = 1;').code();
    expect(c).not.toContain('push');
    expect(c).toContain('http://x');
    expect(c.split('\n')).toHaveLength(3);
  });
});
