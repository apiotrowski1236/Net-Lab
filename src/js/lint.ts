import { isLoop, textOf, walk, walkProgram, type Block, type Expr, type Fn, type Loop, type Node, type Program, type Stmt } from './ast';
import { ARRAY_METHODS, NUMBER_METHODS, STRING_METHODS } from './lib';
import { isStackOverflow, type RunResult } from './run';

/**
 * The shared mistake detector. It reads the syntax tree and what happened during
 * the run, and reports code that works but probably doesn't do what the student
 * meant. A wrong note costs a student more than a missed one, so every rule
 * stops short of anything that could be correct code.
 */
export interface LintNote {
  /** The rule's id, which a step can switch off with `lintOff`. */
  rule: string;
  file: string;
  line: number;
  text: string;
}

export const LINT_RULES = ['assign-in-condition', 'semicolon-after-header', 'while-unchanged', 'index-at-length', 'assign-push', 'method-no-parens', 'result-unused', 'shadowed-name', 'reset-in-loop', 'prompt-plus', 'prompt-compare', 'alert-extra-args', 'misspelled-property'] as const;

/** Rules that can say why a loop around a prompt will never end, so they show while the prompt waits. */
export const WAITING_RULES: readonly string[] = ['assign-in-condition', 'while-unchanged', 'shadowed-name', 'prompt-compare'];

const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill']);
/** Built-ins that hand back a new value and leave everything else alone. */
const NEW_VALUE = new Set(['slice', 'concat', 'join', 'indexOf', 'lastIndexOf', 'includes', 'toUpperCase', 'toLowerCase', 'trim', 'charAt', 'substring', 'startsWith', 'endsWith', 'split', 'repeat', 'replace', 'padStart', 'padEnd', 'toFixed', 'toString']);
const NEW_VALUE_CALLBACK = new Set(['map', 'filter', 'find', 'findIndex', 'some', 'every', 'reduce']);
const NEW_VALUE_GLOBAL = new Set(['Number', 'String', 'Boolean', 'parseInt', 'parseFloat', 'isNaN']);
const STRING_RESULT = new Set(['toUpperCase', 'toLowerCase', 'trim', 'replace', 'padStart', 'padEnd', 'repeat', 'substring', 'charAt']);

interface Ctx {
  p: Program;
  parents: Map<Node, Node>;
  text(n: { off: number; end: number }): string;
  add(rule: string, line: number, text: string): void;
  run?: RunResult;
}

/** No calls, no assignments, nothing that can change anything. */
function isPure(e: Node): boolean {
  let pure = true;
  walk(e, (n) => {
    if (n.k === 'call' || n.k === 'assign' || n.k === 'update' || (n.k === 'unary' && n.op === 'delete')) pure = false;
    if (n.k === 'fn') return false;
    return pure ? undefined : false;
  });
  return pure;
}

/** The variables an expression reads. */
function namesIn(e: Node): Set<string> {
  const out = new Set<string>();
  walk(e, (n) => {
    if (n.k === 'id' && n.name !== 'undefined' && n.name !== 'NaN' && n.name !== 'Infinity') out.add(n.name);
    if (n.k === 'fn') return false;
    return undefined;
  });
  return out;
}

function rootName(e: Expr): string | undefined {
  if (e.k === 'id') return e.name;
  return e.k === 'member' || e.k === 'index' ? rootName(e.obj) : undefined;
}

/** The variables a stretch of code writes to, by assignment or a method that changes the value. */
function writtenIn(n: Node): Set<string> {
  const out = new Set<string>();
  const add = (e: Expr) => {
    const r = rootName(e);
    if (r) out.add(r);
  };
  walk(n, (c) => {
    if (c.k === 'assign' || c.k === 'update') add(c.target);
    if (c.k === 'forof' || c.k === 'forin') {
      if (typeof c.target === 'string') out.add(c.target);
      else add(c.target);
    }
    if (c.k === 'call' && c.callee.k === 'member' && MUTATORS.has(c.callee.name)) add(c.callee.obj);
    if (c.k === 'unary' && c.op === 'delete') add(c.e);
    return undefined;
  });
  return out;
}

const isLiteral = (e: Expr) => e.k === 'num' || e.k === 'str' || e.k === 'null' || (e.k === 'array' && e.items.length === 0) || (e.k === 'object' && e.props.length === 0);

function inCondition(n: Node, c: Ctx): boolean {
  for (let at: Node | undefined = n, up = c.parents.get(n); up; at = up, up = c.parents.get(up)) {
    if (up.k === 'fn') return false;
    if ((up.k === 'if' || up.k === 'while' || up.k === 'do' || up.k === 'for') && up.test === at) return true;
    if (up.k === 'cond' && up.test === at) return true;
  }
  return false;
}

function enclosingLoop(n: Node, c: Ctx): Loop | undefined {
  for (let up = c.parents.get(n); up; up = c.parents.get(up)) {
    if (up.k === 'fn') return undefined;
    if (isLoop(up)) return up;
  }
  return undefined;
}

// --- rules ---

function assignInCondition(n: Node, c: Ctx): void {
  const test = n.k === 'if' || n.k === 'while' || n.k === 'do' || n.k === 'for' || n.k === 'cond' ? n.test : undefined;
  if (test?.k !== 'assign' || test.op !== '=' || test.parens) return;
  const left = c.text(test.target);
  const right = c.text(test.value);
  c.add('assign-in-condition', test.pos.line, `This condition uses a single =, which gives ${left} a new value and doesn't compare anything. To compare, use three equals signs: ${left} === ${right}.`);
}

function semicolonAfterHeader(n: Node, list: readonly Stmt[] | undefined, c: Ctx): void {
  const body = n.k === 'if' ? n.yes : n.k === 'while' || n.k === 'for' || n.k === 'forof' || n.k === 'forin' ? n.body : undefined;
  if (body?.k !== 'empty' || (n.k === 'if' && n.no)) return;
  const word = n.k === 'if' ? 'if' : n.k === 'while' ? 'while' : 'for';
  const text = `There is a semicolon right after this ${word} header, so the ${word === 'if' ? 'if statement' : 'loop'} has nothing to run, and the next line isn't part of it. Delete the semicolon.`;
  if (n.k === 'if') return c.add('semicolon-after-header', body.pos.line, text);
  const next = list?.[list.indexOf(n as Stmt) + 1];
  const nextIsBody = next && (next.k === 'block' || (next.pos.line > n.pos.line && next.pos.col > n.pos.col));
  if (nextIsBody || headerDoesNothing(n as Loop)) c.add('semicolon-after-header', body.pos.line, text);
}

/** A loop whose header changes nothing outside itself, so running it with no body has no effect. */
function headerDoesNothing(n: Loop): boolean {
  if (n.k === 'while' || n.k === 'do') return isPure(n.test);
  if (n.k !== 'for') return true;
  const own = new Set(n.lets.map((l) => l.name));
  if (n.test && !isPure(n.test)) return false;
  if (!n.update) return true;
  let local = true;
  walk(n.update, (c) => {
    if (c.k === 'call') local = false;
    if ((c.k === 'assign' || c.k === 'update') && !own.has(rootName(c.target) ?? '')) local = false;
    return undefined;
  });
  return local;
}

function whileUnchanged(n: Node, c: Ctx): void {
  if (n.k !== 'while' && n.k !== 'do' && !(n.k === 'for' && !n.update)) return;
  const { test, body } = n;
  if (!test || c.run?.status === 'ok' || !c.run) return;
  if (!isPure(test)) return;
  const names = namesIn(test);
  if (!names.size) return;
  if (!c.run.facts.loops.some((l) => l.file === n.pos.file && l.line === n.pos.line && l.runs > 0)) return;
  let leaves = false;
  walk(body, (x) => {
    if (x.k === 'break' || x.k === 'return') leaves = true;
    if (x.k === 'call' && !isBuiltinCall(x.callee, c)) leaves = true;
    return x.k === 'fn' ? false : undefined;
  });
  if (leaves) return;
  const written = writtenIn(body);
  if ([...names].some((v) => written.has(v))) return;
  const list = [...names];
  const said = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
  c.add('while-unchanged', test.pos.line, `Nothing inside this loop changes ${said}, so the condition ${c.text(test)} stays the same every time and the loop can't end. Change ${list[0]} inside the loop.`);
}

function isBuiltinCall(callee: Expr, c: Ctx): boolean {
  const key = `${callee.pos.file}:${callee.off}`;
  return !!c.run?.facts.builtinCalls.includes(key);
}

function indexAtLength(c: Ctx): void {
  const nodes = new Map<number, Extract<Node, { k: 'index' }>>();
  walkProgram(c.p, (n) => {
    if (n.k === 'index') nodes.set(n.off, n);
  });
  for (const f of c.run?.facts.indexAtLength ?? []) {
    if (f.file !== c.p.file) continue;
    const n = nodes.get(f.off);
    if (!n || inCondition(n, c) || comparedToUndefined(n, c)) continue;
    const obj = c.text(n.obj);
    const key = n.key;
    if (key.k === 'member' && key.name === 'length' && c.text(key.obj) === obj) {
      c.add('index-at-length', f.line, `${obj}[${obj}.length] is one past the end, so it gives undefined. Indexes start at 0, so the last item is ${obj}[${obj}.length - 1].`);
      continue;
    }
    const loop = enclosingLoop(n, c);
    if (key.k !== 'id' || loop?.k !== 'for' || !loop.test) continue;
    const t = loop.test;
    const hit = t.k === 'binary' && ((t.op === '<=' && c.text(t.l) === key.name && c.text(t.r) === `${obj}.length`) || (t.op === '>=' && c.text(t.r) === key.name && c.text(t.l) === `${obj}.length`));
    if (hit) c.add('index-at-length', loop.pos.line, `This loop's condition is ${c.text(t)}, so its last pass reads ${obj}[${f.index}], and ${obj} has no item there. An array of ${f.length} items has indexes 0 to ${Math.max(f.length - 1, 0)}. Use ${key.name} < ${obj}.length.`);
  }
}

function comparedToUndefined(n: Node, c: Ctx): boolean {
  const up = c.parents.get(n);
  if (up?.k !== 'binary' || !['==', '===', '!=', '!=='].includes(up.op)) return false;
  const other = up.l === n ? up.r : up.l;
  return other.k === 'id' && other.name === 'undefined';
}

function assignPush(n: Node, c: Ctx): void {
  if (n.k !== 'assign' || n.op !== '=' || n.value.k !== 'call' || n.value.callee.k !== 'member') return;
  const { callee } = n.value;
  if (c.text(callee.obj) !== c.text(n.target)) return;
  const name = c.text(n.target);
  if (callee.name === 'forEach') return c.add('assign-push', n.pos.line, `forEach gives back undefined, so this line replaces ${name} with undefined. Write the forEach call on its own, with no ${name} = in front.`);
  if (callee.name !== 'push' && callee.name !== 'unshift') return;
  c.add('assign-push', n.pos.line, `${callee.name} changes the array and gives back its new length, so this line replaces ${name} with a number. Write ${c.text(n.value)}; with no ${name} = in front.`);
}

const KNOWN_METHODS = new Set([...ARRAY_METHODS.keys(), ...STRING_METHODS.keys(), ...NUMBER_METHODS.keys(), 'log', 'error', 'floor', 'ceil', 'round', 'trunc', 'abs', 'min', 'max', 'pow', 'sqrt', 'random', 'isArray', 'isInteger']);

/** `arr.push[x]`: square brackets where a method call's parentheses go. */
const isMethodIndex = (e: Expr): boolean => e.k === 'index' && e.obj.k === 'member' && KNOWN_METHODS.has(e.obj.name);

function methodNoParens(n: Node, c: Ctx): void {
  if (n.k !== 'expr') return;
  const e = n.e;
  if (e.k === 'index' && isMethodIndex(e)) {
    const method = c.text(e.obj);
    c.add('method-no-parens', n.pos.line, `${method} is a method, so it takes parentheses, not square brackets: ${method}(${c.text(e.key)}).`);
  } else if (e.k === 'member' && KNOWN_METHODS.has(e.name)) {
    c.add('method-no-parens', n.pos.line, `${c.text(e)} names the method without running it. Add parentheses to call it: ${c.text(e)}().`);
  } else if (e.k === 'id' && (e.name === 'alert' || e.name === 'prompt' || e.name === 'confirm' || c.p.funcs.some((f) => f.name === e.name))) {
    c.add('method-no-parens', n.pos.line, `${e.name} names the function without running it. Add parentheses to call it: ${e.name}().`);
  }
}

function pureCallback(f: Expr | undefined): boolean {
  if (f?.k !== 'fn') return false;
  const body: Fn['body'] = f.body;
  if (body.k !== 'block') return isPure(body);
  const b = body as Block;
  return b.body.length === 1 && b.body[0].k === 'return' && (!b.body[0].e || isPure(b.body[0].e));
}

function resultUnused(n: Node, c: Ctx): void {
  if (n.k !== 'expr') return;
  const e = n.e;
  const line = n.pos.line;
  if (isMethodIndex(e)) return;
  if (e.k === 'binary' && isPure(e)) {
    const text = c.text(e);
    if (e.op === '+' && e.l.k === 'id' && Array.isArray(c.run?.vars[e.l.name])) {
      c.add('result-unused', line, `+ can't add an item to an array. It turns ${e.l.name} into text, and this line then throws that text away. To add to the end, write ${e.l.name}.push(${c.text(e.r)});`);
      return;
    }
    if (['==', '===', '!=', '!==', '<', '>', '<=', '>='].includes(e.op)) {
      const set = e.op === '==' || e.op === '===' ? ` To give ${c.text(e.l)} a new value, use a single =.` : '';
      c.add('result-unused', line, `This line compares ${c.text(e.l)} and ${c.text(e.r)}, then does nothing with the answer.${set} To act on the answer, put ${text} in an if statement.`);
    } else {
      const left = e.l.k === 'id' ? ` To change ${e.l.name}, write ${e.l.name} = ${text};` : '';
      c.add('result-unused', line, `This line works out ${text}, then does nothing with the answer.${left}`);
    }
    return;
  }
  if ((e.k === 'id' || e.k === 'index' || e.k === 'num' || e.k === 'bool' || e.k === 'null' || e.k === 'template' || (e.k === 'member' && !KNOWN_METHODS.has(e.name))) && isPure(e)) {
    if (e.k === 'id' && (e.name === 'alert' || e.name === 'prompt' || e.name === 'confirm' || c.p.funcs.some((f) => f.name === e.name))) return;
    c.add('result-unused', line, `This line only reads ${c.text(e)}, then does nothing with it. To see it, write console.log(${c.text(e)});`);
    return;
  }
  if (e.k !== 'call' || !isBuiltinCall(e, c) || !e.args.every((a) => isPure(a) || a.k === 'fn')) return;
  const callee = e.callee;
  if (callee.k === 'id') {
    if (!NEW_VALUE_GLOBAL.has(callee.name)) return;
    c.add('result-unused', line, `${callee.name}() gives back an answer, and this line doesn't keep it. Save it in a variable: let result = ${c.text(e)};`);
    return;
  }
  if (callee.k !== 'member' || !isPure(callee.obj)) return;
  const { name } = callee;
  const obj = c.text(callee.obj);
  if (callee.obj.k === 'id' && callee.obj.name === 'Math') {
    if (name !== 'random') c.add('result-unused', line, `${c.text(callee)}() gives back an answer, and this line doesn't keep it. Save it in a variable: let result = ${c.text(e)};`);
    return;
  }
  if (NEW_VALUE_CALLBACK.has(name)) {
    if (!pureCallback(e.args[0])) return;
    c.add('result-unused', line, `${name} gives back a new value and leaves ${obj} as it was, so this line's result is thrown away. Save it in a variable: let result = ${c.text(e)};`);
    return;
  }
  if (!NEW_VALUE.has(name)) return;
  if (STRING_RESULT.has(name)) {
    c.add('result-unused', line, `${name} gives back a new string and leaves ${obj} as it was, because strings can't be changed in place. Save the result: ${callee.obj.k === 'id' ? `${obj} = ${c.text(e)};` : `let result = ${c.text(e)};`}`);
    return;
  }
  c.add('result-unused', line, `${name} gives back a new value and leaves ${obj} as it was, so this line's result is thrown away. Save it in a variable: let result = ${c.text(e)};`);
}

/** `let total` in a block, inside a block of the same function that has its own `total`. */
function shadowedName(c: Ctx): void {
  const scan = (list: readonly Stmt[], outer: Map<string, number>, inner: boolean): void => {
    const here = new Map(outer);
    if (inner) {
      for (const s of list) {
        if (s.k !== 'var' || s.kind === 'var') continue;
        for (const d of s.decls) {
          const first = outer.get(d.name);
          if (first !== undefined) c.add('shadowed-name', d.pos.line, `This ${s.kind} makes a new variable called ${d.name}, separate from the ${d.name} on line ${first}. Changes to it are lost when the block ends. To change the first ${d.name}, leave out the word ${s.kind}.`);
        }
      }
    }
    for (const s of list) {
      if (s.k === 'var' && s.kind !== 'var') for (const d of s.decls) here.set(d.name, d.pos.line);
      else descend(s, here);
    }
  };
  const descend = (s: Stmt, outer: Map<string, number>): void => {
    if (s.k === 'block') scan(s.body, outer, true);
    else if (s.k === 'if') {
      descend(s.yes, outer);
      if (s.no) descend(s.no, outer);
    } else if (s.k === 'while' || s.k === 'do' || s.k === 'forof' || s.k === 'forin') {
      const inner = new Map(outer);
      if (typeof (s as { target?: unknown }).target === 'string' && (s.k === 'forof' || s.k === 'forin') && s.decl && s.decl !== 'var') {
        const name = s.target as string;
        const first = outer.get(name);
        if (first !== undefined) c.add('shadowed-name', s.pos.line, `This loop makes a new variable called ${name}, separate from the one on line ${first}. Inside this loop, ${name} means the new one. Pick a different name for one of them.`);
        inner.set(name, s.pos.line);
      }
      descend(s.body, inner);
    } else if (s.k === 'for') {
      const inner = new Map(outer);
      if (s.init?.k === 'var' && s.init.kind !== 'var') {
        for (const d of s.init.decls) {
          const first = outer.get(d.name);
          if (first !== undefined) c.add('shadowed-name', d.pos.line, `This ${s.init.kind} makes a new variable called ${d.name}, separate from the one on line ${first}. Inside this loop, ${d.name} means the new one. Pick a different name for one of them.`);
          inner.set(d.name, d.pos.line);
        }
      }
      descend(s.body, inner);
    } else if (s.k === 'switch') {
      for (const k of s.cases) scan(k.body, outer, true);
    }
  };
  scan(c.p.body, new Map(), false);
  walkProgram(c.p, (n) => {
    if (n.k !== 'fn' || n.body.k !== 'block') return;
    const params = new Map<string, number>();
    scan(n.body.body, params, false);
  });
}

/** `total = total + x`, `total += x`, or `total++`: the name it adds to, if this statement does that. */
function accumulates(s: Stmt): string | undefined {
  if (s.k !== 'expr') return undefined;
  const e = s.e;
  if (e.k === 'update' && e.target.k === 'id') return e.target.name;
  if (e.k !== 'assign' || e.target.k !== 'id') return undefined;
  const name = e.target.name;
  if (e.op !== '=') return e.op === '+=' || e.op === '-=' || e.op === '*=' ? name : undefined;
  return e.value.k === 'binary' && e.value.l.k === 'id' && e.value.l.name === name ? name : undefined;
}

function resetInLoop(n: Node, c: Ctx): void {
  if (!isLoop(n) || n.body.k !== 'block') return;
  const list = n.body.body;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let name: string | undefined;
    if (s.k === 'expr' && s.e.k === 'assign' && s.e.op === '=' && s.e.target.k === 'id' && isLiteral(s.e.value)) {
      name = s.e.target.name;
    } else if (s.k === 'var' && s.decls.length === 1 && s.decls[0].init && isLiteral(s.decls[0].init) && s.kind !== 'const') {
      if (!declaredOutside(s.decls[0].name, n, c)) continue;
      name = s.decls[0].name;
    }
    if (!name) continue;
    const add = list.findIndex((x, j) => j > i && accumulates(x) === name);
    if (add < 0) continue;
    const readLater = list.slice(add + 1).some((x) => accumulates(x) !== name && namesIn(x).has(name!));
    const between = list.slice(i + 1, add).some((x) => namesIn(x).has(name!) && accumulates(x) !== name);
    if (readLater || between) continue;
    c.add('reset-in-loop', s.pos.line, `This line sets ${name} back every time the loop runs, so ${name} never builds up. Set ${name} once, above the loop, and delete this line.`);
  }
}

function declaredOutside(name: string, loop: Loop, c: Ctx): boolean {
  let found = false;
  const seen = (list: readonly Stmt[]) => {
    for (const s of list) if (s.k === 'var' && s.decls.some((d) => d.name === name)) found = true;
  };
  for (let up = c.parents.get(loop); up; up = c.parents.get(up)) {
    if (up.k === 'block') seen(up.body);
    if (up.k === 'fn') return found;
  }
  seen(c.p.body);
  return found;
}

function promptCompare(n: Node, c: Ctx): void {
  if (n.k !== 'binary' || !c.run?.facts.promptCompare.some((f) => f.file === n.pos.file && f.off === n.pos.off)) return;
  c.add('prompt-compare', n.pos.line, `prompt() always gives back a string, and a string is never === to a number, so ${c.text(n)} is ${n.op === '===' ? 'never' : 'always'} true. Turn the answer into a number first: let age = Number(prompt("How old are you?"));`);
}

function alertExtraArgs(n: Node, c: Ctx, alertIsMine: boolean): void {
  if (alertIsMine || n.k !== 'call' || n.callee.k !== 'id' || n.callee.name !== 'alert' || n.args.length < 2) return;
  const parts = n.args.map((a) => c.text(a)).join(' + ');
  c.add('alert-extra-args', n.pos.line, `alert shows only its first value, so the rest are ignored here. Join them with +, like alert(${parts}); or use console.log, which shows every value.`);
}

function declaresAlert(programs: Program[]): boolean {
  let mine = false;
  for (const p of programs) {
    if (p.vars.includes('alert') || p.lets.some((l) => l.name === 'alert') || p.funcs.some((f) => f.name === 'alert')) mine = true;
    walkProgram(p, (n) => {
      if (n.k === 'assign' && n.target.k === 'id' && n.target.name === 'alert') mine = true;
      if (n.k === 'fn' && n.params.some((x) => x.name === 'alert')) mine = true;
    });
  }
  return mine;
}

/** Everything worth a note, in line order. `off` lists rules to skip. */
export function lint(programs: Program[], run: RunResult | undefined, off: readonly string[] = []): LintNote[] {
  try {
    return lintAll(programs, run, off);
  } catch (e) {
    // Notes are extras. A tree too deep to walk still has its run result to show.
    if (isStackOverflow(e)) return [];
    throw e;
  }
}

function lintAll(programs: Program[], run: RunResult | undefined, off: readonly string[]): LintNote[] {
  const notes: LintNote[] = [];
  const skip = new Set(off);
  const alertIsMine = declaresAlert(programs);
  programs.forEach((p) => {
    const parents = new Map<Node, Node>();
    walkProgram(p, (n, parent) => {
      if (parent) parents.set(n, parent);
    });
    const c: Ctx = {
      p,
      parents,
      run,
      text: (n) => textOf(p, n),
      add: (rule, line, text) => {
        if (skip.has(rule) || notes.some((x) => x.rule === rule && x.file === p.file && x.line === line)) return;
        notes.push({ rule, file: p.file, line, text });
      },
    };
    const lists = new Map<Node, readonly Stmt[]>();
    for (const s of p.body) lists.set(s, p.body);
    walkProgram(p, (n) => {
      if (n.k === 'block') for (const s of n.body) lists.set(s, n.body);
    });
    walkProgram(p, (n) => {
      assignInCondition(n, c);
      semicolonAfterHeader(n, lists.get(n), c);
      whileUnchanged(n, c);
      assignPush(n, c);
      methodNoParens(n, c);
      resultUnused(n, c);
      resetInLoop(n, c);
      promptCompare(n, c);
      alertExtraArgs(n, c, alertIsMine);
    });
    indexAtLength(c);
    shadowedName(c);
    for (const f of run?.facts.promptPlus ?? []) {
      if (f.file === p.file) c.add('prompt-plus', f.line, 'prompt() always gives back a string, so + joined these values as text. Turn the answer into a number first: let age = Number(prompt("How old are you?"));');
    }
    for (const f of run?.facts.misspelled ?? []) {
      if (f.file === p.file) c.add('misspelled-property', f.line, `${f.object} has no property called ${f.name}, so this gives undefined. Did you mean ${f.object}.${f.suggestion}?`);
    }
  });
  const order = new Map(programs.map((p, i) => [p.file, i]));
  return notes.sort((a, b) => order.get(a.file)! - order.get(b.file)! || a.line - b.line);
}

