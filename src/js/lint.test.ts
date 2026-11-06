import { describe, expect, test } from 'vitest';
import { lint, parseFiles, runProgram, type RunOptions } from './index';

function notes(code: string, options: RunOptions = {}, off: string[] = []) {
  const { programs, error } = parseFiles([{ name: 'script.js', text: code }]);
  if (error) throw new Error(`${error.type}: ${error.msg}`);
  return lint(programs, runProgram(programs, { answers: ['5', '3', '4'], ...options }), off);
}

const rules = (code: string, options?: RunOptions) => notes(code, options).map((n) => `${n.rule}:${n.line}`);

/** Code that must not get any note, each with a rule it sits close to. */
const CORRECT: [string, string][] = [
  ['assign-in-condition', 'let x = 5;\nif (x === 5) { console.log(x); }\nwhile (x > 0) { x--; }'],
  ['assign-in-condition', 'let line;\nlet n = 0;\nwhile ((line = n++) < 3) { console.log(line); }'],
  ['assign-in-condition', 'let x;\nif ((x = 5)) { console.log(x); }'],
  ['semicolon-after-header', 'let i = 0;\nfor (i = 0; i < 3; i++);\nconsole.log(i);'],
  ['semicolon-after-header', 'for (let i = 0; i < 3; i++) { console.log(i); }\nif (true) { console.log(1); } else { console.log(2); }'],
  ['semicolon-after-header', 'let a = [1, 2];\nwhile (a.pop());\nconsole.log(a);'],
  ['while-unchanged', 'let i = 0;\nwhile (i < 3) { i++; }\nconsole.log(i);'],
  ['while-unchanged', 'let a = [1, 2];\nwhile (a.length > 0) { a.pop(); }'],
  ['while-unchanged', 'let i = 0;\nwhile (i < 3) { i += 1; if (i === 2) break; }'],
  ['while-unchanged', 'let i = 0;\nfunction step() { i++; }\nwhile (i < 3) { step(); }'],
  ['while-unchanged', 'let o = {n: 0};\nwhile (o.n < 2) { o.n++; }'],
  ['while-unchanged', 'let i = 5;\nwhile (i < 3) { console.log(i); }'],
  ['while-unchanged', 'let i = 0;\ndo { i++; } while (i < 2);'],
  ['while-unchanged', 'let a = [1];\nlet b = a;\nwhile (a.length) { b.pop(); }'],
  ['index-at-length', 'let a = [1, 2];\nfor (let i = 0; i < a.length; i++) { console.log(a[i]); }\nconsole.log(a[a.length - 1]);'],
  ['index-at-length', 'let a = [1, 2];\nlet i = 0;\nwhile (a[i] !== undefined) { i++; }'],
  ['index-at-length', 'let a = [1, 2];\nlet i = 0;\nwhile (a[i]) { i++; }'],
  ['index-at-length', 'let a = [1, 2];\nif (a[2] === undefined) { console.log("end"); }'],
  ['index-at-length', 'let a = [1, 2];\na[a.length] = 3;\nconsole.log(a);'],
  ['index-at-length', 'let a = [1, 1, 2];\nlet n = 0;\nfor (let i = 0; i < a.length; i++) { if (a[i] === a[i + 1]) { n++; } }\nconsole.log(n);'],
  ['assign-push', 'let a = [];\nlet n = a.push(1);\nconsole.log(n, a);\na = a.slice();\na = a.concat([2]);'],
  ['assign-push', 'let a = [];\nlet b = [];\nb = a.push(1);\nconsole.log(b);'],
  ['method-no-parens', 'let a = [1];\nlet p = a.length;\nconsole.log(p, a.pop());\nlet f = a.push;\nconsole.log(typeof f);'],
  ['result-unused', '"use strict";\nlet a = [1];\na.push(2);\na.sort();\na.reverse();\na.forEach((x) => console.log(x));\nconsole.log(a.slice(1));'],
  ['result-unused', 'let a = [1];\nlet o = {f: function() { return 1; }};\no.f();\na.map((x) => { console.log(x); return x; });'],
  ['result-unused', 'function f() { return 1; }\nf();\nlet x = 1;\nx += 1;\nx++;'],
  ['result-unused', 'let a = [];\nlet s = {slice: function() { a.push(1); }};\ns.slice();\nconsole.log(a);'],
  ['shadowed-name', 'let total = 0;\nfor (let i = 0; i < 2; i++) { total += i; }\nfor (let i = 0; i < 2; i++) { total += i; }\nconsole.log(total);'],
  ['shadowed-name', 'let x = 1;\nfunction f(x) { return x; }\nfunction g() { let x = 2; return x; }\nconsole.log(f(1), g(), x);'],
  ['shadowed-name', '{ let y = 1; console.log(y); }\n{ let y = 2; console.log(y); }\nlet y = 3;\nconsole.log(y);'],
  ['reset-in-loop', 'let total = 0;\nfor (let i = 0; i < 2; i++) { total += i; }\nconsole.log(total);'],
  ['reset-in-loop', 'let g = [[1, 2], [3]];\nfor (const r of g) {\n  let sum = 0;\n  for (const x of r) { sum += x; }\n  console.log(sum);\n}'],
  ['reset-in-loop', 'let sum;\nfor (let i = 0; i < 2; i++) {\n  sum = 0;\n  sum += 1;\n  sum += 2;\n  console.log(sum);\n}'],
  ['reset-in-loop', 'for (let i = 0; i < 2; i++) {\n  let n = 0;\n  n += i;\n  console.log(n);\n}'],
  ['reset-in-loop', 'for (let i = 0; i < 2; i++) {\n  let n = 0;\n  n++;\n}'],
  ['prompt-plus', 'let a = Number(prompt("a"));\nconsole.log(a + 1);'],
  ['prompt-compare', 'let a = Number(prompt("a"));\nif (a === 5) { console.log(a); }'],
  ['prompt-compare', 'let a = prompt("a");\nif (a === "5") { console.log(a); }'],
  ['prompt-compare', 'let a = prompt("a");\nif (a == 5) { console.log(a); }'],
  ['prompt-compare', 'let a = prompt("a");\nif (a.length === 1) { console.log(a); }'],
  ['prompt-plus', 'let a = prompt("a");\nconsole.log("You said " + a);\nconsole.log(a + " is your number");'],
  ['prompt-plus', 'let a = prompt("a");\nconsole.log(a - 1, a * 2);'],
  ['alert-extra-args', 'alert("a" + 1);\nalert();\nalert("x");'],
  ['alert-extra-args', 'function alert(a, b) { console.log(a, b); }\nalert(1, 2);'],
  ['misspelled-property', 'let o = {color: "red"};\nconsole.log(o.colour === undefined ? 1 : 2, o.nope);\nconsole.log([].length, "a".length);'.replace('o.colour === undefined ? 1 : 2, ', '')],
  ['misspelled-property', 'let o = {ab: 1};\nconsole.log(o.ac);'],
];

describe('code that is correct gets no notes', () => {
  for (const [rule, code] of CORRECT) {
    test(`${rule}: ${code.slice(0, 70).replace(/\n/g, ' ')}`, () => {
      expect(notes(code).map((n) => n.text)).toEqual([]);
    });
  }
});

describe('each rule fires', () => {
  test('assign-in-condition', () => {
    expect(rules('let x = 1;\nif (x = 5) { console.log(x); }')).toEqual(['assign-in-condition:2']);
    expect(rules('let x = 1;\nlet y = (x = 5) ? 1 : 2;')).toEqual([]);
    expect(rules('let x = 1;\nlet y = x = 5 ? 1 : 2;')).toEqual([]);
    expect(rules('let x = 3;\nwhile (x = 0) { }')).toEqual(['assign-in-condition:2']);
    expect(rules('let x = 3;\nfor (let i = 0; i = 0; i++) { }')).toEqual(['assign-in-condition:2']);
    expect(rules('let x = 3;\ndo { x++; } while (x = 0);')).toEqual(['assign-in-condition:2']);
    expect(notes('let x = 1;\nif (x = 5) { }')[0].text).toBe("This condition uses a single =, which gives x a new value and doesn't compare anything. To compare, use three equals signs: x === 5.");
  });
  test('semicolon-after-header', () => {
    expect(rules('let x = 1;\nif (x > 0); {\n  console.log(x);\n}')).toEqual(['semicolon-after-header:2']);
    expect(rules('for (let i = 0; i < 3; i++); {\n  console.log("hi");\n}')).toEqual(['semicolon-after-header:1']);
    expect(rules('for (let i = 0; i < 3; i++);\nconsole.log("done");')).toEqual(['semicolon-after-header:1']);
    expect(rules('var i;\nfor (i = 0; i < 3; i++);\n  console.log(i);')).toEqual(['semicolon-after-header:2']);
  });
  test('while-unchanged', () => {
    expect(rules('let i = 0;\nwhile (i < 3) {\n  console.log("hi");\n}')).toEqual(['while-unchanged:2']);
    expect(rules('let i = 0;\nlet n = 3;\nwhile (i < n) { n + 1 > 0; }')).toContain('while-unchanged:3');
    expect(rules('let i = 0;\ndo { console.log(i); } while (i < 3);')).toEqual(['while-unchanged:2']);
    expect(rules('let i = 0;\nfor (; i < 3; ) { console.log(i); }')).toEqual(['while-unchanged:2']);
    expect(notes('let i = 0;\nwhile (i < 5) {\n  console.log("hi");\n}')[0].text).toBe("Nothing inside this loop changes i, so the condition i < 5 stays the same every time and the loop can't end. Change i inside the loop.");
  });
  test('index-at-length', () => {
    expect(rules('let a = [1, 2];\nconsole.log(a[a.length]);')).toEqual(['index-at-length:2']);
    expect(rules('let s = "ab";\nlet c = s[s.length];\nconsole.log(c);')).toEqual(['index-at-length:2']);
    expect(rules('let a = [1, 2];\nfor (let i = 0; i <= a.length; i++) {\n  console.log(a[i]);\n}')).toEqual(['index-at-length:2']);
    expect(notes('let a = [1, 2];\nfor (let i = 0; i <= a.length; i++) {\n  console.log(a[i]);\n}')[0].text).toBe("This loop's condition is i <= a.length, so its last pass reads a[2], and a has no item there. An array of 2 items has indexes 0 to 1. Use i < a.length.");
  });
  test('assign-push', () => {
    expect(rules('let a = [];\na = a.push(1);')).toEqual(['assign-push:2']);
    expect(rules('let a = [];\na = a.unshift(1);')).toEqual(['assign-push:2']);
    expect(rules('let a = [];\na = a.forEach((x) => console.log(x));')).toEqual(['assign-push:2']);
  });
  test('method-no-parens', () => {
    expect(rules('let a = [1];\na.pop;')).toEqual(['method-no-parens:2']);
    expect(rules('console.log;')).toEqual(['method-no-parens:1']);
    expect(rules('function f() { }\nf;')).toEqual(['method-no-parens:2']);
    expect(rules('alert;')).toEqual(['method-no-parens:1']);
    expect(notes('let a = [1];\na.push[2];').map((n) => n.text)).toEqual(['a.push is a method, so it takes parentheses, not square brackets: a.push(2).']);
    expect(rules('let o = {list: [1]};\no.list[0];')).toEqual(['result-unused:2']);
  });
  test('result-unused', () => {
    expect(rules('let s = "a";\ns.toUpperCase();')).toEqual(['result-unused:2']);
    expect(rules('let a = [1];\na.slice(1);')).toEqual(['result-unused:2']);
    expect(rules('let x = 1;\nx + 1;')).toEqual(['result-unused:2']);
    expect(rules('let x = 1;\nx == 5;')).toEqual(['result-unused:2']);
    expect(rules('let x = 1;\nx;')).toEqual(['result-unused:2']);
    expect(rules('let a = [1];\na.map((x) => x * 2);')).toEqual(['result-unused:2']);
    expect(rules('let a = [1];\na.filter((x) => { return x > 0; });')).toEqual(['result-unused:2']);
    expect(rules('Math.round(2.5);')).toEqual(['result-unused:1']);
    expect(rules('parseInt("5");')).toEqual(['result-unused:1']);
    expect(rules('let a = [1];\na[0];\na.length;')).toEqual(['result-unused:2', 'result-unused:3']);
    expect(notes('let s = "a";\ns.toUpperCase();')[0].text).toBe("toUpperCase gives back a new string and leaves s as it was, because strings can't be changed in place. Save the result: s = s.toUpperCase();");
    expect(notes('let x = 1;\nx + 1;')[0].text).toBe('This line works out x + 1, then does nothing with the answer. To change x, write x = x + 1;');
    expect(notes('let a = [1];\na + 2;')[0].text).toBe("+ can't add an item to an array. It turns a into text, and this line then throws that text away. To add to the end, write a.push(2);");
  });
  test('shadowed-name', () => {
    expect(rules('let total = 0;\nif (true) {\n  let total = 5;\n}\nconsole.log(total);')).toEqual(['shadowed-name:3']);
    expect(rules('let x = 1;\nfor (let x = 0; x < 1; x++) { }\nconsole.log(x);')).toEqual(['shadowed-name:2']);
    expect(rules('let x = 1;\nfor (const x of [1]) { console.log(x); }')).toEqual(['shadowed-name:2']);
    expect(rules('function f() {\n  let t = 0;\n  if (t === 0) {\n    let t = 5;\n    return t;\n  }\n}\nf();')).toEqual(['shadowed-name:4']);
    expect(rules('for (let i = 0; i < 1; i++) {\n  for (let i = 0; i < 1; i++) { }\n}')).toEqual(['shadowed-name:2']);
  });
  test('reset-in-loop', () => {
    expect(rules('let total = 0;\nfor (const x of [1, 2]) {\n  total = 0;\n  total += x;\n}\nconsole.log(total);')).toEqual(['reset-in-loop:3']);
    expect(rules('let n = 0;\nlet i = 0;\nwhile (i < 2) {\n  i++;\n  n = 0;\n  n = n + 1;\n}\nconsole.log(n);')).toEqual(['reset-in-loop:5']);
    expect(rules('let c = 0;\nfor (const x of [1]) {\n  c = 0;\n  c++;\n}')).toEqual(['reset-in-loop:3']);
    expect(rules('let s = "";\nfor (const x of ["a"]) {\n  s = "";\n  s += x;\n}\nconsole.log(s);')).toEqual(['reset-in-loop:3']);
  });
  test('prompt-compare', () => {
    expect(rules('let a = prompt("a");\nif (a === 5) { console.log(a); }')).toEqual(['prompt-compare:1']);
    expect(rules('let a = prompt("a");\nif (5 !== a) { console.log(a); }')).toEqual(['prompt-compare:1']);
    expect(rules('let a = Number(prompt("a"));\nwhile (a !== 4) {\n  a = prompt("b");\n}')).toEqual(['prompt-compare:3']);
    const say = (code: string) => notes(code)[0].text;
    expect(say('let guess = prompt("a");\nif (guess === 5) { console.log(1); }')).toBe('This prompt() gave back a string, and a string is never === to a number, so guess === 5 is never true. Put Number() around the prompt(), like this: Number(prompt("Pick a number"))');
    expect(say('let guess = prompt("a");\nif (guess !== 5) { console.log(1); }')).toBe('This prompt() gave back a string, and a string is never === to a number, so guess !== 5 is always true. Put Number() around the prompt(), like this: Number(prompt("Pick a number"))');
  });

  test('prompt-plus', () => {
    expect(rules('let a = prompt("a");\nconsole.log(a + 1);')).toEqual(['prompt-plus:2']);
    expect(rules('let a = prompt("a");\nlet b = prompt("b");\nlet c = a + b;\nconsole.log(c);')).toEqual(['prompt-plus:3']);
    expect(rules('let a = prompt("a");\nconsole.log(2 + a);')).toEqual(['prompt-plus:2']);
    expect(rules('let a = prompt("a");\nconsole.log(a + 1);', { answers: ['Ann'] })).toEqual([]);
    expect(rules('let a = prompt("a");\nconsole.log(a + 1);', { answers: [null] })).toEqual([]);
  });
  test('alert-extra-args', () => {
    expect(rules('let b = 1;\nalert("a", b);')).toEqual(['alert-extra-args:2']);
    expect(notes('let b = 1;\nalert("Score:", b);')[0].text).toBe('alert shows only its first value, so the rest are ignored here. Join them with +, like alert("Score:" + b); or use console.log, which shows every value.');
  });
  test('misspelled-property', () => {
    expect(rules('let a = [1];\nconsole.log(a.lenght);')).toEqual(['misspelled-property:2']);
    expect(rules('let s = "x";\nconsole.log(s.Length);')).toEqual(['misspelled-property:2']);
    expect(rules('let o = {color: "red"};\nconsole.log(o.colour);')).toEqual(['misspelled-property:2']);
    expect(notes('let a = [1];\nconsole.log(a.lenght);')[0].text).toBe('a has no property called lenght, so this gives undefined. Did you mean a.length?');
  });
});

test('a step can switch a rule off, and notes come in line order', () => {
  const code = 'let x = 1;\nalert("a", 2);\nif (true) {\n  let x = 2;\n}\nx;';
  expect(notes(code).map((n) => n.rule)).toEqual(['alert-extra-args', 'shadowed-name', 'result-unused']);
  expect(notes(code, {}, ['shadowed-name']).map((n) => n.rule)).toEqual(['alert-extra-args', 'result-unused']);
});

test('a program that never ran past a line still gets notes from the code itself', () => {
  expect(notes('nope();\nlet x = 1;\nif (x = 2) { }').map((n) => n.rule)).toEqual(['assign-in-condition']);
});
