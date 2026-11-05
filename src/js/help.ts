import type { JsError, Pos } from './errors';
import type { Token } from './lexer';

/**
 * The plain-English side of errors. Each error keeps V8's wording in `msg`, and
 * this file adds a sentence or two for a student who has never seen it. It reads
 * the tokens around the error, so it can say which bracket never closed, or that
 * `Let` wants a lowercase l.
 */

/** Keywords as students capitalize them. */
const CAPITALIZED: Record<string, string> = {
  Let: 'let',
  LET: 'let',
  Const: 'const',
  Var: 'var',
  For: 'for',
  If: 'if',
  IF: 'if',
  Else: 'else',
  While: 'while',
  Do: 'do',
  Function: 'function',
  Return: 'return',
  Switch: 'switch',
  Case: 'case',
  Default: 'default',
  Break: 'break',
  Continue: 'continue',
  True: 'true',
  False: 'false',
  Null: 'null',
  Undefined: 'undefined',
};

/** The lowercase keyword a capitalized word was meant to be. */
export const lowercaseKeyword = (word: string): string | undefined => (Object.prototype.hasOwnProperty.call(CAPITALIZED, word) ? CAPITALIZED[word] : undefined);

const ELSE_IF = new Set(['elif', 'elseif', 'elsif', 'elseIf', 'ElseIf', 'Elif']);
const OPENS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '${': '}' };
const CLOSES = new Set([')', ']', '}']);

/** The brackets still open before the error, innermost last. */
function openBrackets(tokens: Token[]): Token[] {
  const open: Token[] = [];
  for (const t of tokens) {
    if (t.t !== 'op') continue;
    if (OPENS[t.v]) open.push(t);
    else if (CLOSES.has(t.v) && open.length && OPENS[open[open.length - 1].v] === t.v) open.pop();
  }
  return open;
}

const onLine = (tokens: Token[], line: number) => tokens.filter((t) => t.pos.line === line);

/** The word a bare value was probably meant to be, for "put it in quotes". */
const isBareWord = (t: Token | undefined) => t?.t === 'id';

/** Finds why the parser stopped. Returns a code for tests and the sentence a student reads. */
export function explainSyntax(e: Omit<JsError, 'help'>, seen: Token[], at: Token, extra?: { first?: Pos; name?: string }): { code: string; help: string } {
  const before = seen.slice(0, seen.lastIndexOf(at) < 0 ? seen.length : seen.lastIndexOf(at));
  const prev = before[before.length - 1];
  const open = openBrackets(before);
  const top = open[open.length - 1];
  const line = onLine([...before, at], at.pos.line);

  if (e.msg.startsWith('Invalid left-hand side')) {
    // `el.style.background-color = "red"` reads as `el.style.background` minus `color`.
    const eq = seen.map((t) => (t.t === 'op' ? t.v : '')).lastIndexOf('=');
    const [dot, left, minus, right] = seen.slice(Math.max(0, eq - 4), Math.max(0, eq));
    if (dot?.v === '.' && dot.t === 'op' && left?.t === 'id' && minus?.t === 'op' && minus.v === '-' && right?.t === 'id') {
      const camel = `${left.v}${right.v[0].toUpperCase()}${right.v.slice(1)}`;
      return { code: 'style-dash', help: `JavaScript reads the dash in ${left.v}-${right.v} as a minus sign, so this line tries to subtract. Property names in JavaScript use a capital letter where CSS uses a dash. Write ${camel}.` };
    }
  }

  // The lexer already knows these.
  switch (at.code) {
    case 'smart-quote':
      return { code: 'smart-quote', help: 'This line has a curly quote mark, the kind a word processor makes. JavaScript only reads straight quotes, like " and \'. Delete the curly quotes and type them again in this editor.' };
    case 'unterminated-string': {
      const q = at.v[0];
      const curly = /[“”‘’]/.test(at.v) ? ' This line also has a curly quote, which JavaScript does not count as a closing quote.' : '';
      return { code: 'unterminated-string', help: `The string that starts on line ${at.pos.line} never ends. Put a closing ${q} after the text, on the same line.${curly}` };
    }
    case 'unterminated-comment':
      return { code: 'unterminated-comment', help: `The comment that starts with /* on line ${at.pos.line} never ends. Close it with */.` };
    case 'number-then-letter':
      return { code: 'number-then-letter', help: 'A number can\'t have a letter right after it, and a variable name can\'t start with a digit. Check the name or number on this line.' };
    case 'bad-escape':
      return { code: 'bad-escape', help: 'A backslash inside a string starts a special character. This one is not complete. To show a backslash, type two of them.' };
    case 'bad-number':
      return { code: 'bad-number', help: 'This number is not written correctly. Check for a stray letter or symbol in it.' };
    case 'bad-character':
      return { code: 'bad-character', help: `JavaScript has no use for the character ${at.v} here. Delete it, or put it inside a string.` };
  }

  if (e.msg === 'Missing initializer in const declaration') {
    const name = at.v;
    return { code: 'const-no-value', help: `A const variable can never change, so it needs its value on the same line. Write const ${name} = 5; with your own value. If the value comes later, use let instead.` };
  }
  if (e.code === 'redeclared' && extra?.first && extra.name) {
    const { name, first } = extra;
    const loop = top?.pos.line === at.pos.line && before[before.indexOf(top) - 1]?.v === 'for' ? forCommaHeader(before) : undefined;
    if (loop) return loop;
    const place = first.line === at.pos.line ? 'earlier on this line' : `on line ${first.line}`;
    return { code: 'redeclared', help: `${name} was already declared ${place}. A name can be declared only once in the same block. To give it a new value, leave out the word let, const, or var: ${name} = 5;` };
  }

  const loop = forCommaHeader(before);
  if (loop) return loop;

  // A capitalized keyword reads as a plain name, so the error lands a word or two later.
  const capital = line.find((t) => t.t === 'id' && lowercaseKeyword(t.v) !== undefined && t.pos.off <= at.pos.off);
  if (capital) {
    const lower = lowercaseKeyword(capital.v);
    return { code: 'capital-keyword', help: `JavaScript keywords are all lowercase. Write ${lower}, not ${capital.v}.` };
  }

  const elif = line.find((t) => t.t === 'id' && ELSE_IF.has(t.v));
  if (elif) return { code: 'elif', help: `JavaScript has no ${elif.v}. Write else if, as two words, with its condition in parentheses: else if (x > 5) {` };

  if (at.v === '{' && line.some((t) => t.t === 'kw' && t.v === 'else') && !line.some((t) => t.t === 'kw' && t.v === 'if') && prev?.v === ')') {
    return { code: 'else-condition', help: 'A plain else has no condition. To test a condition here, write else if (x > 5) {. Otherwise, remove the parentheses.' };
  }

  // `let class = 1`: the word after let is taken. The parser reads `let` as a name, so check by hand.
  if (at.t === 'kw' && (prev?.t === 'id' ? prev.v === 'let' : prev?.t === 'kw' && (prev.v === 'var' || prev.v === 'const' || prev.v === 'function'))) {
    return { code: 'reserved-name', help: `${at.v} is a reserved word: JavaScript keeps it for its own use, so it can't name a variable. Pick a different name.` };
  }
  if (e.msg === 'let is disallowed as a lexically bound name') return { code: 'reserved-name', help: 'let is a reserved word here, so it can\'t name a variable. Pick a different name.' };

  if (e.msg === 'Unexpected end of input') {
    if (top) {
      const close = OPENS[top.v];
      const what = top.v === '${' ? 'The ${ ' : `The ${top.v} `;
      return { code: top.v === '{' ? 'missing-brace' : top.v === '[' ? 'missing-bracket' : 'missing-paren', help: `${what}on line ${top.pos.line} never closes. Add a ${close} for it. Each opening mark needs a matching closing mark.` };
    }
    if (prev) return { code: 'unexpected-end', help: `The code stops in the middle of something on line ${prev.pos.line}. Finish that line.` };
    return { code: 'unexpected-end', help: 'The code stops before it is finished.' };
  }

  const opener = before[before.indexOf(top) - 1];
  // `if x > 5 {`: the condition has no parentheses.
  if (prev?.t === 'kw' && (prev.v === 'if' || prev.v === 'while' || prev.v === 'switch' || prev.v === 'for') && !(at.t === 'op' && at.v === '(')) {
    return { code: 'needs-parens', help: `${prev.v} needs parentheses around what comes next, like this: ${prev.v} (x > 5) {` };
  }

  if (e.msg === 'missing ) after argument list') {
    const place = top?.pos.line === at.pos.line ? 'on this line' : `on line ${top?.pos.line}`;
    const after = seen[seen.length - 1];
    if (isBareWord(at) && isBareWord(after) && at.pos.line === after.pos.line) {
      return { code: 'missing-quotes', help: `Between the parentheses, JavaScript found ${at.v} ${after.v}, two names in a row. Text needs quote marks around it: "${at.v} ${after.v}". Two separate values need a comma between them.` };
    }
    return { code: 'missing-paren', help: `The ( ${place} needs a ) to close it. If there is more than one value inside, check for a missing comma or + between them.` };
  }

  if (at.t === 'op' && CLOSES.has(at.v)) {
    if (!top) return { code: 'extra-close', help: `There is an extra ${at.v} here, with nothing open for it to close. Delete it, or check for a missing ${at.v === '}' ? '{' : at.v === ')' ? '(' : '['} above.` };
    if (OPENS[top.v] !== at.v) return { code: 'mismatch', help: `The ${top.v} on line ${top.pos.line} has to close with ${OPENS[top.v]} before this ${at.v}.` };
  }

  // `if (x > 5 {`: an open parenthesis runs into the block.
  if (at.t === 'op' && at.v === '{' && top?.v === '(') {
    const word = opener?.t === 'kw' ? `after ${opener.v} ` : '';
    return { code: 'missing-paren', help: `The ( ${word}on line ${top.pos.line} needs a ) to close it, before this {.` };
  }
  if (top && top.v !== '{' && at.t === 'op' && at.v === ';') return { code: top.v === '[' ? 'missing-bracket' : 'missing-paren', help: `The ${top.v} on line ${top.pos.line} needs a ${OPENS[top.v]} to close it, before this semicolon.` };

  // Two values side by side.
  if (prev && (at.t === 'id' || at.t === 'num' || at.t === 'str' || at.t === 'tpl')) {
    if (at.t === 'id' && prev.t === 'id' && (before[before.length - 2]?.v === 'let' || before[before.length - 2]?.v === 'const' || before[before.length - 2]?.v === 'var')) {
      return { code: 'name-with-space', help: `A variable name can't have a space in it. Join the words, like ${prev.v}${at.v[0].toUpperCase()}${at.v.slice(1)}.` };
    }
    const inside = top?.v === '[' ? 'items in an array' : top?.v === '{' && before[before.indexOf(top) - 1]?.v !== ')' ? 'parts of an object' : '';
    if (inside) return { code: 'missing-comma', help: `The ${inside} need a comma between them.` };
    if (at.pos.line === prev.pos.line) return { code: 'side-by-side', help: `Two values sit side by side here with nothing between them. Check for a missing operator, comma, or semicolon before ${at.v || 'this value'}.` };
    return { code: 'side-by-side', help: 'The line above may be unfinished. Check for a missing operator or closing mark.' };
  }

  if (e.msg.startsWith('Invalid left-hand side')) return { code: 'bad-assignment', help: 'Only a variable or a spot in an array or object can go to the left of =. To compare two values, use ===.' };
  if (e.msg === 'Illegal return statement') return { code: 'return-outside', help: 'return only works inside a function, and this line is not in one.' };
  if (e.msg === 'Illegal break statement') return { code: 'break-outside', help: 'break only works inside a loop or a switch, and this line is not in one.' };
  if (e.msg.startsWith('Illegal continue')) return { code: 'continue-outside', help: 'continue only works inside a loop, and this line is not in one.' };
  if (e.msg === 'Function statements require a function name') return { code: 'function-name', help: 'A function written on its own line needs a name, like this: function greet() {' };
  if (at.t === 'kw' && at.v === 'else') return { code: 'stray-else', help: 'This else has no if to go with it. Check that the } before it closes the right block, and that no ; comes right after the if line.' };
  if (at.t === 'op' && at.v === '=' && prev?.t === 'op') return { code: 'bad-operator', help: `The ${prev.v} and = don't fit together here. To compare, write === with no spaces inside it. To assign, write one =.` };

  return { code: 'syntax', help: 'JavaScript stopped reading here because this does not fit the code around it. Check this line and the one above it for a typo.' };
}

/** `for (let i = 0, i < 5, i++)`: the header uses commas where semicolons go. */
function forCommaHeader(before: Token[]): { code: string; help: string } | undefined {
  // Walk back to the `(` that belongs to a `for`, staying inside that header.
  let depth = 0;
  let commas = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const t = before[i];
    if (t.t !== 'op') continue;
    if (t.v === ';' && depth === 0) return undefined;
    if (t.v === ',' && depth === 0) commas++;
    if (t.v === ')' || t.v === ']' || t.v === '}') depth++;
    else if (t.v === '(' || t.v === '[' || t.v === '{') {
      if (depth === 0) {
        if (t.v === '(' && before[i - 1]?.v === 'for' && commas > 0) {
          return { code: 'for-commas', help: 'A for loop header uses semicolons between its three parts, not commas. Write it like this: for (let i = 0; i < 5; i++)' };
        }
        return undefined;
      }
      depth--;
    }
  }
  return undefined;
}

/** How far apart two words are: letters added, removed, changed, or swapped side by side. */
export function editDistance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

/** The name in `names` closest to `word`, if one is close enough to be a typo. A difference only in capitals always counts. */
export function closestName(word: string, names: Iterable<string>): string | undefined {
  const lower = word.toLowerCase();
  const limit = word.length <= 3 ? 1 : word.length <= 7 ? 2 : 3;
  let best: string | undefined;
  let bestScore = Infinity;
  for (const n of names) {
    if (n === word) continue;
    if (n.toLowerCase() === lower) return n;
    const d = editDistance(lower, n.toLowerCase());
    if (d <= limit && d < bestScore) {
      best = n;
      bestScore = d;
    }
  }
  return best;
}

/** What kind of value an error is talking about, in a student's words. */
export type Receiver = 'array' | 'string' | 'number' | 'boolean' | 'object' | 'function' | 'undefined' | 'null';

const KIND_WORD: Record<Receiver, string> = { array: 'An array', string: 'A string', number: 'A number', boolean: 'A boolean', object: 'This object', function: 'A function', undefined: 'undefined', null: 'null' };

/** `totl is not defined`. */
export function notDefinedHelp(name: string, inScope: Iterable<string>): string {
  const lower = lowercaseKeyword(name);
  if (lower) return `JavaScript keywords are all lowercase. Write ${lower}, not ${name}.`;
  const near = closestName(name, inScope);
  if (near) {
    const caps = near.toLowerCase() === name.toLowerCase();
    return `There is no variable called ${name}. Did you mean ${near}?${caps ? ' JavaScript treats capital and lowercase letters as different.' : ''}`;
  }
  return `There is no variable called ${name}. Declare it first with let, and check the spelling. Text in quotes is a string, and a word with no quotes has to be a variable.`;
}

/** `x is not a function`, when there is a value on the left. */
export function notFunctionHelp(o: { callee: string; name?: string; kind?: Receiver; value?: string; members?: Iterable<string>; isProperty?: boolean }): string {
  const { callee, name, kind, members } = o;
  if (name === 'length' && (kind === 'array' || kind === 'string')) return `length is a property, not a method, so it has no parentheses. Write ${callee} with nothing after it.`;
  if (name && kind && o.isProperty) {
    const near = members && closestName(name, members);
    if (near) {
      const fixed = callee.slice(0, callee.length - name.length) + near;
      const caps = near.toLowerCase() === name.toLowerCase();
      return `${KIND_WORD[kind]} has no method called ${name}. Did you mean ${fixed}?${caps ? ' JavaScript treats capital and lowercase letters as different.' : ''}`;
    }
    if (o.value === 'undefined') return `${KIND_WORD[kind]} has no method called ${name}. Check the spelling, or look up what this kind of value can do.`;
  }
  if (o.value === undefined) return `${callee} is not a function, so it can't be called with ( ).`;
  return `${callee} holds ${o.value}, which is not a function, so it can't be called with ( ). Remove the parentheses, or check the name.`;
}
