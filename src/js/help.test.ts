import { describe, expect, it } from 'vitest';
import { parseFiles } from '.';

const stop = (text: string) => parseFiles([{ name: 'script.js', text }]).error!;

/** The mistakes beginners make most. Each row: the code, where the error points, its code, and what the help has to say. */
const MISTAKES: [string, number, string, RegExp][] = [
  ['for (let i = 0, i < 3, i++) {\n}\n', 1, 'for-commas', /semicolons between its three parts, not commas/],
  ['console.log("a";\n', 1, 'missing-paren', /needs a \) to close it/],
  ['console.log("a"\nlet x = 1;\n', 1, 'missing-paren', /needs a \) to close it/],
  ['if (true) {\n  let a = 1;\n', 3, 'missing-brace', /The \{ on line 1 never closes/],
  ['function f() {\n  if (true) {\n    return 1;\n}\n', 5, 'missing-brace', /The \{ on line 1 never closes/],
  ['Let x = 1;\n', 1, 'capital-keyword', /Write let, not Let/],
  ['For (let i = 0; i < 3; i++) {\n}\n', 1, 'capital-keyword', /Write for, not For/],
  ['If (true) {\n}\n', 1, 'capital-keyword', /Write if, not If/],
  ['if (true) {\n} Else {\n}\n', 2, 'capital-keyword', /Write else, not Else/],
  ['Function f() {\n}\n', 1, 'capital-keyword', /Write function, not Function/],
  ['if (true) {\n} elif (false) {\n}\n', 2, 'elif', /no elif\. Write else if/],
  ['if (true) {\n} elseif (false) {\n}\n', 2, 'elif', /no elseif\. Write else if/],
  ['let s = “hello”;\n', 1, 'smart-quote', /curly quote/],
  ['let s = ‘hello’;\n', 1, 'smart-quote', /curly quote/],
  ['let s = "hello;\nconsole.log(s);\n', 1, 'unterminated-string', /never ends\. Put a closing "/],
  ["let s = 'hello;\n", 1, 'unterminated-string', /never ends\. Put a closing '/],
  ['const x;\n', 1, 'const-no-value', /needs its value on the same line/],
  ['let a = 1;\nlet a = 2;\n', 2, 'redeclared', /already declared on line 1/],
  ['let class = 1;\n', 1, 'reserved-name', /class is a reserved word/],
  ['let for = 1;\n', 1, 'reserved-name', /for is a reserved word/],
];

describe('help on syntax errors', () => {
  it.each(MISTAKES)('%j', (code, line, name, help) => {
    const e = stop(code);
    expect(e.pos.line).toBe(line);
    expect(e.code).toBe(name);
    expect(e.help).toMatch(help);
  });

  it('every syntax error here has help', () => {
    for (const [code] of MISTAKES) expect(stop(code).help).toBeTruthy();
  });
});
