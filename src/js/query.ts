import { isLoop, textOf, walk, type Fn, type Loop, type Node, type Program, type Stmt } from './ast';

/** Questions a lab check can ask about the student's code, with no running involved. */

export interface LoopFact {
  kind: 'for' | 'while' | 'do' | 'for-of' | 'for-in';
  file: string;
  line: number;
  /** The condition's text. For a for...of or for...in, the list it walks. */
  test?: string;
  /** The text between the header's parentheses. */
  head: string;
  /** The body's text. */
  body: string;
  /** How many loops it sits inside. */
  depth: number;
  /** The name of the function it's in, if any. */
  inFunction?: string;
  node: Loop;
}

export interface CallFact {
  /** The last part of the name: `push` for `list.push(1)`. */
  name: string;
  /** The whole callee: `list.push`, `console.log`, `alert`. */
  callee: string;
  /** What it's called on: `list`, `console`. */
  receiver?: string;
  args: string[];
  file: string;
  line: number;
  inLoop: boolean;
  inFunction?: string;
}

export interface DeclFact {
  name: string;
  kind: 'let' | 'const' | 'var' | 'function';
  file: string;
  line: number;
  /** The first value's text. */
  init?: string;
  /** `top` is outside every block and function. */
  scope: 'top' | 'block' | 'function';
  inLoop: boolean;
}

export interface FnFact {
  name?: string;
  params: string[];
  body: string;
  arrow: boolean;
  file: string;
  line: number;
  node: Fn;
}

interface Place {
  loops: number;
  fn?: Fn;
  fnName?: string;
  block: boolean;
}

const LOOP_KIND = { for: 'for', while: 'while', do: 'do', forof: 'for-of', forin: 'for-in' } as const;

export class Query {
  private readonly loopFacts: LoopFact[] = [];
  private readonly callFacts: CallFact[] = [];
  private readonly declFacts: DeclFact[] = [];
  private readonly fnFacts: FnFact[] = [];
  private readonly reads = new Map<string, number[]>();
  private readonly writes = new Map<string, number[]>();

  constructor(readonly programs: Program[]) {
    for (const p of programs) for (const s of p.body) this.visit(s, p, { loops: 0, block: false }, undefined);
  }

  /** The file's text. With no name, the first file. */
  source(file?: string): string {
    return this.program(file)?.source ?? '';
  }

  program(file?: string): Program | undefined {
    return file ? this.programs.find((p) => p.file === file) : this.programs[0];
  }

  /** The file's text with comments blanked out, so a check can't be passed or failed by a comment. */
  code(file?: string): string {
    const p = this.program(file);
    if (!p) return '';
    return blankComments(p.source);
  }

  /** Every loop, in source order. */
  loops(): LoopFact[] {
    return this.loopFacts;
  }

  /** Calls by last name (`push`) or whole name (`console.log`). With no name, every call. */
  calls(name?: string): CallFact[] {
    return name === undefined ? this.callFacts : this.callFacts.filter((c) => c.name === name || c.callee === name);
  }

  /** The first declaration of a name. */
  declared(name: string): DeclFact | undefined {
    return this.declFacts.find((d) => d.name === name);
  }

  /** Every declaration. */
  declarations(): DeclFact[] {
    return this.declFacts;
  }

  /** Every function, named or not. */
  functions(): FnFact[] {
    return this.fnFacts;
  }

  /** A function by name, whether written with `function` or assigned to a variable. */
  fn(name: string): FnFact | undefined {
    return this.fnFacts.find((f) => f.name === name);
  }

  /** Lines where a variable's value is read. */
  uses(name: string): number[] {
    return this.reads.get(name) ?? [];
  }

  /** Lines where a variable gets a new value, not counting its declaration. */
  assigned(name: string): number[] {
    return this.writes.get(name) ?? [];
  }

  private note(map: Map<string, number[]>, name: string, line: number): void {
    const had = map.get(name);
    if (had) had.push(line);
    else map.set(name, [line]);
  }

  private visit(n: Node, p: Program, at: Place, parent: Node | undefined): void {
    if (n.k === 'fn') {
      const name = n.name ?? nameFrom(n, parent);
      this.fnFacts.push({ name, params: n.params.map((x) => x.name), body: textOf(p, n.body), arrow: n.arrow, file: p.file, line: n.pos.line, node: n });
      const inner: Place = { loops: 0, fn: n, fnName: name ?? at.fnName, block: true };
      for (const x of n.params) if (x.init) this.visit(x.init, p, inner, n);
      this.visit(n.body, p, { ...inner, block: false }, n);
      return;
    }
    if (isLoop(n)) this.addLoop(n, p, at);
    if (n.k === 'var') {
      for (const d of n.decls) {
        this.declFacts.push({ name: d.name, kind: n.kind, file: p.file, line: d.pos.line, init: d.init && textOf(p, d.init), scope: scopeWord(at), inLoop: at.loops > 0 });
      }
    }
    if (n.k === 'fndecl') this.declFacts.push({ name: n.fn.name!, kind: 'function', file: p.file, line: n.pos.line, scope: scopeWord(at), inLoop: at.loops > 0 });
    if (n.k === 'call') this.addCall(n, p, at);
    if (n.k === 'id') {
      const write = parent?.k === 'assign' && parent.target === n && parent.op === '=';
      if (!write) this.note(this.reads, n.name, n.pos.line);
    }
    if ((n.k === 'assign' || n.k === 'update') && n.target.k === 'id') this.note(this.writes, n.target.name, n.pos.line);
    this.descend(n, p, at);
  }

  private descend(n: Node, p: Program, at: Place): void {
    const inner: Place = { ...at };
    if (isLoop(n)) inner.loops = at.loops + 1;
    if (n.k === 'block' || n.k === 'if' || isLoop(n) || n.k === 'switch') inner.block = true;
    let first = true;
    walk(n, (c) => {
      if (first) {
        first = false;
        return undefined;
      }
      this.visit(c, p, isLoop(n) && !isBodyOf(n, c) ? { ...inner, loops: at.loops } : inner, n);
      return false;
    });
  }

  private addLoop(n: Loop, p: Program, at: Place): void {
    const test = 'iter' in n ? n.iter : n.test;
    const open = p.source.indexOf('(', n.off);
    const close = p.source.lastIndexOf(')', n.k === 'do' ? n.end : n.body.off);
    this.loopFacts.push({ kind: LOOP_KIND[n.k], file: p.file, line: n.pos.line, test: test && textOf(p, test), head: p.source.slice(open + 1, Math.max(open + 1, close)), body: textOf(p, n.body), depth: at.loops, inFunction: at.fnName, node: n });
  }

  private addCall(n: Extract<Node, { k: 'call' }>, p: Program, at: Place): void {
    const c = n.callee;
    const callee = textOf(p, c);
    const name = c.k === 'member' ? c.name : callee;
    const receiver = c.k === 'member' ? textOf(p, c.obj) : undefined;
    this.callFacts.push({ name, callee, receiver, args: n.args.map((a) => textOf(p, a)), file: p.file, line: n.pos.line, inLoop: at.loops > 0, inFunction: at.fnName });
  }
}

const isBodyOf = (n: Loop, c: Node) => n.body === (c as Stmt);

function scopeWord(at: Place): DeclFact['scope'] {
  if (at.fn) return 'function';
  return at.block ? 'block' : 'top';
}

/** The name an anonymous function gets from the line it's on: `let f = () => 1` or `f = () => 1`. */
function nameFrom(fn: Fn, parent: Node | undefined): string | undefined {
  if (parent?.k === 'assign' && parent.target.k === 'id') return parent.target.name;
  if (parent?.k === 'var') return parent.decls.find((d) => d.init === fn)?.name;
  return undefined;
}

/** Blanks comments, keeping line numbers. Strings and templates stay whole, so a `//` in a URL survives. */
function blankComments(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      const start = i++;
      while (i < s.length && s[i] !== c && (c === '`' || s[i] !== '\n')) i += s[i] === '\\' ? 2 : 1;
      i++;
      out += s.slice(start, i);
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      const stop = end < 0 ? s.length : end + 2;
      out += s.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

