import { textOf, walk, type Assign, type Block, type Call, type DoWhile, type Expr, type Fn, type For, type ForEach, type Index, type Loop, type Member, type Node, type Program, type Stmt, type Switch, type VarDecl, type While } from './ast';
import type { JsError, Pos } from './errors';
import { logLine, shownText } from './format';
import { closestName, notDefinedHelp, notFunctionHelp, type Receiver } from './help';
import { Query } from './query';
import { ARRAY_METHODS, BOOLEAN_METHODS, NOT_ARRAY, NOT_FUNCTION, NOT_GLOBAL, NOT_NUMBER, NOT_OBJECT, NOT_STRING, NUMBER_METHODS, OBJECT_METHODS, STATIC_DENY, STRING_METHODS, joinArray, makeGlobals, type LibIo } from './lib';
import { HostObject, JsArray, JsFunction, JsNamespace, JsNative, JsObject, Scope, arrayIndex, isCallable, ownKeys, type Binding, type Primitive, type Runtime, type Value } from './values';

/**
 * A tree-walking interpreter. Everything a program can observe goes through
 * this file and lib.ts, so the program has no way to reach a real host object,
 * and every run with the same seed and answers does the same thing.
 */

export interface RunOptions {
  /** Math.random starts from this, so the same seed gives the same numbers. */
  seed?: number;
  /** Answers for prompt() and confirm(), in order. A string is OK and null is Cancel. */
  answers?: readonly (string | null)[];
  /** Replaces the first value of these top-level variables. Values are plain JSON. */
  data?: Record<string, unknown>;
  maxSteps?: number;
  maxLines?: number;
  /** Record a step-by-step trace. */
  trace?: boolean;
  maxTrace?: number;
  /** Objects to add as globals, such as `document`. */
  hosts?: (rt: Runtime) => Record<string, HostObject>;
  /** Runs after the program's last line, as part of the program: an error or a prompt in here stops the run the usual way. */
  after?: (rt: Runtime) => void;
}

export interface OutputLine {
  kind: 'log' | 'alert' | 'prompt' | 'confirm';
  text: string;
  file: string;
  line: number;
  /** From console.error. */
  error?: true;
  /** What the student answered. For confirm, a string is OK and null is Cancel. */
  answer?: string | null;
}

export interface Waiting {
  kind: 'prompt' | 'confirm';
  message: string;
  default: string;
}

export interface Limit {
  why: 'loop' | 'steps' | 'output' | 'memory';
  text: string;
  file?: string;
  line?: number;
}

/** What happened during a run, for the mistake detector and lab checks. */
export interface RunFacts {
  /** Reads of `a[i]` where i was exactly a.length. `off` is where the read starts. */
  indexAtLength: { file: string; line: number; off: number; target: string; index: number; length: number }[];
  /** `+` that joined a number-like prompt() answer to a number or to another answer. */
  promptPlus: { file: string; line: number }[];
  /** `===` or `!==` that compared a prompt() answer with a number, which a string never matches. `off` is where the comparison starts, and `prompt` is where the answer came from. */
  promptCompare: { file: string; line: number; off: number; prompt: Pos }[];
  /** Property reads that came back undefined and were close to a real name. */
  misspelled: { file: string; line: number; object: string; name: string; suggestion: string }[];
  /** How many times each loop's body ran. */
  loops: { file: string; line: number; runs: number }[];
  /** Calls that reached a built-in, as `file:offset`. */
  builtinCalls: string[];
  /** How many prompt() and confirm() calls were answered. */
  prompts: number;
}

export interface TraceItem {
  text: string;
  changed?: boolean;
  hole?: boolean;
}
export interface TraceVar {
  name: string;
  text: string;
  changed?: boolean;
  /** An array's items, as boxes. */
  items?: TraceItem[];
  /** How many items didn't fit. */
  more?: number;
}
export interface TraceFrame {
  name: string;
  vars: TraceVar[];
}
export interface TraceStep {
  file: string;
  line: number;
  /** One sentence on what this step did. */
  say: string;
  frames: TraceFrame[];
  /** How many output lines exist at this step. */
  out: number;
  end?: 'done' | 'error' | 'limit' | 'waiting' | 'cut';
}

export interface RunResult {
  status: 'ok' | 'error' | 'limit' | 'waiting' | 'cut';
  lines: OutputLine[];
  error?: JsError;
  limit?: Limit;
  waiting?: Waiting;
  /** Top-level variables at the end, as plain values. A function is shown as "[function name]". */
  vars: Record<string, unknown>;
  facts: RunFacts;
  /** Names in `data` the program never gave a first value to. */
  dataMissing: string[];
  /** How much of the step budget the run used. */
  steps: number;
  trace?: TraceStep[];
}

const MAX_STEPS = 5_000_000;
const MAX_LINES = 2000;
const MAX_LINE_TEXT = 1000;
const MAX_OUTPUT_TEXT = 200_000;
const MAX_TRACE = 2000;
const MAX_TRACE_ITEMS = 50;
/** A loop that goes this long with nothing in its condition changing is stuck. */
const STUCK_RUNS = 100_000;
/** About 16 million characters. A real browser allows more, but this is well past what a lesson needs. */
export const MAX_STRING = 1 << 24;
/** How deep calls nest before "Maximum call stack size exceeded". Chrome reaches about 11,000, but each call here takes several frames of the browser's own stack. */
const MAX_DEPTH = 900;

/** A word for a step count: 100000 gives 100,000. */
const commas = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ',');

/** Why a run stopped early. Not an Error: nothing here needs a stack trace. */
class Stop {
  constructor(
    readonly how: { error: JsError } | { limit: Limit } | { waiting: Waiting } | { cut: true },
  ) {}
}

const enum Done {
  Normal,
  Break,
  Continue,
  Return,
}

/** One value a loop's condition depends on, watched while the loop runs. */
interface Probe {
  text: string;
  expr: Expr;
}
interface Sample {
  first: Value;
  last: Value;
  changed: boolean;
  up: boolean;
  down: boolean;
}
interface LoopInfo {
  test?: string;
  probes: Probe[];
  /** Only the condition can end this loop, and nothing in its body writes to what the condition reads. */
  plain: boolean;
}
interface Watch {
  node: Loop;
  info: LoopInfo;
  runs: number;
  samples: Sample[];
  /** How many of the student's functions had run when the loop started. */
  calls: number;
  /** Where the condition was last read. */
  scope?: Scope;
}

interface Frame {
  id: number;
  name: string;
  scope: Scope;
}

const CONSTANTS = new Set(['undefined', 'NaN', 'Infinity']);

/** Names that stop even as a student's own key: they're how JavaScript reaches outside an object. */
const BLOCKED = new Set(['constructor', '__proto__', 'prototype']);

function loopInfo(n: Loop, source: string): LoopInfo {
  const test = n.k === 'while' || n.k === 'do' || n.k === 'for' ? n.test : undefined;
  const probes: Probe[] = [];
  let plain = true;
  const add = (e: Expr) => {
    const text = source.slice(e.off, e.end);
    if (!probes.some((p) => p.text === text)) probes.push({ text, expr: e });
  };
  const visit = (e: Node) => {
    if (e.k === 'id') {
      if (!CONSTANTS.has(e.name)) add(e);
      return;
    }
    if (e.k === 'fn') return;
    if (e.k === 'member' && pureRead(e)) return add(e);
    if (e.k === 'index' && pureRead(e)) {
      add(e);
      return visit(e.key);
    }
    if (e.k === 'call' || e.k === 'assign' || e.k === 'update') plain = false;
    forEachChild(e, visit);
  };
  if (test) visit(test);
  if (n.k === 'forof' && pureRead(n.iter)) {
    const e = n.iter;
    if (e.k === 'id') probes.push({ text: `${e.name}.length`, expr: { k: 'member', obj: e, name: 'length', pos: e.pos, off: e.off, end: e.end } });
  }
  const roots = new Set(probes.map((p) => rootName(p.expr)));
  walk(n.body, (c) => {
    if (c.k === 'break' || c.k === 'return') plain = false;
    if (c.k === 'assign' && roots.has(rootName(c.target))) plain = false;
    if (c.k === 'update' && roots.has(rootName(c.target))) plain = false;
    if (c.k === 'call' && (c.callee.k === 'member' || c.callee.k === 'index') && roots.has(rootName(c.callee))) plain = false;
    return undefined;
  });
  return { test: test && source.slice(test.off, test.end), probes, plain };
}

function forEachChild(n: Node, visit: (c: Node) => void): void {
  let first = true;
  walk(n, (c) => {
    if (first) {
      first = false;
      return undefined;
    }
    visit(c);
    return false;
  });
}

/** The variable at the left of `a`, `a.b`, or `a[i].c`. */
function rootName(e: Expr): string | undefined {
  if (e.k === 'id') return e.name;
  return e.k === 'member' || e.k === 'index' ? rootName(e.obj) : undefined;
}

/** `i`, `a.length`, `a[i]`: reading it can't run any code. */
function pureRead(e: Expr): boolean {
  if (e.k === 'id' || e.k === 'num' || e.k === 'str') return true;
  if (e.k === 'member') return pureRead(e.obj);
  if (e.k === 'index') return pureRead(e.obj) && pureRead(e.key);
  return false;
}

/** The value of a pure read, without running anything and without failing. */
function peek(e: Expr, s: Scope): Value {
  if (e.k === 'num' || e.k === 'str') return e.v;
  if (e.k === 'id') {
    const b = s.find(e.name);
    return b && !b.tdz ? b.v : undefined;
  }
  if (e.k === 'member') {
    const o = peek(e.obj, s);
    if (e.name === 'length' && (typeof o === 'string' || o instanceof JsArray)) return typeof o === 'string' ? o.length : o.items.length;
    return o instanceof JsObject ? o.props.get(e.name) : undefined;
  }
  if (e.k === 'index') {
    const o = peek(e.obj, s);
    const k = peek(e.key, s);
    if (o instanceof JsArray && typeof k === 'number') return o.items[k];
    if (typeof o === 'string' && typeof k === 'number') return o[k];
    if (o instanceof JsObject && (typeof k === 'string' || typeof k === 'number')) return o.props.get(String(k));
  }
  return undefined;
}

/** A number or boolean V8 works out while parsing: `1 + 2`, `-1`, `!0`. */
function folded(e: Expr): number | boolean | undefined {
  if (e.k === 'num') return e.v;
  if (e.k === 'bool') return e.v;
  if (e.k === 'unary') {
    const v = folded(e.e);
    if (v === undefined) return undefined;
    if (e.op === '!') return !v;
    if (typeof v !== 'number') return undefined;
    return e.op === '-' ? -v : e.op === '+' ? v : e.op === '~' ? ~v : undefined;
  }
  if (e.k === 'binary') {
    const l = folded(e.l);
    const r = folded(e.r);
    if (typeof l !== 'number' || typeof r !== 'number') return undefined;
    switch (e.op) {
      case '+':
        return l + r;
      case '-':
        return l - r;
      case '*':
        return l * r;
      case '/':
        return l / r;
      case '%':
        return l % r;
      case '**':
        return l ** r;
      default:
        return undefined;
    }
  }
  return undefined;
}

/** How V8 writes an expression in "x is not a function". A port of its CallPrinter. */
export function printed(e: Expr): string {
  const hidden = '(intermediate value)';
  const fold = folded(e);
  if (fold !== undefined) return String(fold);
  switch (e.k) {
    case 'id':
      return e.name;
    case 'num':
      return String(e.v);
    case 'str':
      return `"${e.v}"`;
    case 'bool':
      return String(e.v);
    case 'null':
      return 'null';
    case 'member':
      return `${printed(e.obj)}.${e.name}`;
    case 'index':
      return e.key.k === 'str' ? `${printed(e.obj)}.${e.key.v}` : `${printed(e.obj)}[${printed(e.key)}]`;
    case 'call':
      return `${printed(e.callee)}(...)`;
    case 'unary':
      return `(${e.op}${e.op === 'typeof' || e.op === 'void' || e.op === 'delete' ? ' ' : ''}${printed(e.e)})`;
    case 'update':
      return e.prefix ? `(${e.op}${printed(e.target)})` : `(${printed(e.target)}${e.op})`;
    case 'binary':
    case 'logical':
      return `(${printed(e.l)} ${e.op} ${printed(e.r)})`;
    case 'array':
      return `[${e.items.map((i) => (i ? printed(i) : '')).join(',')}]`;
    case 'object':
      return `{${e.props.map(() => hidden).join('')}}`;
    case 'template':
      return e.exprs.length ? e.exprs.map(printed).join('') : `"${e.strs[0]}"`;
    case 'cond':
      return hidden + hidden + hidden;
    case 'assign':
      return printed(e.target);
    case 'seq':
      return `(${e.items.map(printed).join(' , ')})`;
    default:
      return hidden;
  }
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A plain JSON-like value as a program value. Arrays keep their holes. */
export function fromPlain(v: unknown): Value {
  if (v === undefined || v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const items: Value[] = [];
    items.length = v.length;
    for (let i = 0; i < v.length; i++) if (i in v) items[i] = fromPlain(v[i]);
    return new JsArray(items);
  }
  if (typeof v === 'object') {
    const o = new JsObject();
    for (const [k, x] of Object.entries(v)) o.props.set(k, fromPlain(x));
    return o;
  }
  return undefined;
}

/** A program value as plain data. A value that shares parts many times over could expand without end, so `budget` caps how much is copied. */
export function toPlain(v: Value, budget = { left: 300_000 }, seen: object[] = []): unknown {
  if (typeof v !== 'object' || v === null) return v;
  if (v instanceof HostObject) return `[${v.label()}]`;
  if (v instanceof JsFunction || v instanceof JsNative) return `[function ${v.name}]`;
  if (v instanceof JsNamespace) return `[${v.name}]`;
  if (seen.includes(v) || seen.length > 20) return '[circular]';
  if (--budget.left < 0) return '[too big]';
  const inner = [...seen, v];
  if (v instanceof JsArray) {
    const out: unknown[] = [];
    out.length = v.items.length;
    budget.left -= v.items.length;
    if (budget.left < 0) return '[too big]';
    for (const k of Object.keys(v.items)) out[Number(k)] = toPlain(v.items[Number(k)], budget, inner);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k of ownKeys(v)) out[k] = toPlain(v.props.get(k), budget, inner);
  return out;
}

const emptyFacts = (): RunFacts => ({ indexAtLength: [], promptPlus: [], promptCompare: [], misspelled: [], loops: [], builtinCalls: [], prompts: 0 });

class Interp implements Runtime {
  private readonly sources = new Map<string, string>();
  private readonly builtins = new Scope(null);
  private readonly top = new Scope(this.builtins, 'Global');
  private readonly maxSteps: number;
  private readonly maxLines: number;
  private readonly maxTrace: number;
  private readonly answers: readonly (string | null)[];
  private readonly random: () => number;
  private readonly lines: OutputLine[] = [];
  private readonly facts = emptyFacts();
  private readonly loopInfos = new Map<Loop, LoopInfo>();
  private readonly loopRuns = new Map<Loop, number>();
  private readonly seenCalls = new Set<string>();
  private readonly seenIndex = new Set<number>();
  private readonly seenPlus = new Set<string>();
  private readonly seenMisspelled = new Set<string>();
  private readonly promptAnswers = new Map<string, Pos>();
  /** Names still waiting for their `data` value. */
  private readonly pending = new Map<string, unknown>();
  /** Names that have had their `data` value. */
  private readonly taken = new Set<string>();
  /** A name set by `data` at `let x;`, so its first assignment keeps the data too. */
  private readonly pinned = new Set<string>();
  private readonly watches: Watch[] = [];
  private readonly frames: Frame[] = [];
  private readonly trace?: TraceStep[];
  private readonly lastSeen = new Map<string, { text: string; items?: string[] }>();
  private steps = 0;
  private userCalls = 0;
  private depth = 0;
  private asked = 0;
  private textOut = 0;
  private ret: Value = undefined;
  private here: Pos = { file: '', line: 1, col: 0, off: 0 };
  private readonly after?: (rt: Runtime) => void;
  private ended = false;
  private nextFrame = 1;

  constructor(
    private readonly programs: Program[],
    options: RunOptions,
  ) {
    for (const p of programs) this.sources.set(p.file, p.source);
    this.maxSteps = options.maxSteps ?? MAX_STEPS;
    this.maxLines = options.maxLines ?? MAX_LINES;
    this.maxTrace = options.maxTrace ?? MAX_TRACE;
    this.answers = options.answers ?? [];
    this.after = options.after;
    this.random = mulberry32(options.seed ?? 1);
    if (options.trace) this.trace = [];
    for (const [k, v] of Object.entries(options.data ?? {})) this.pending.set(k, v);

    const io: LibIo = {
      log: (args, error) => this.print({ kind: 'log', text: logLine(args, this), ...(error ? { error: true as const } : {}) }),
      alert: (text) => this.print({ kind: 'alert', text }),
      ask: (kind, message, fallback) => this.ask(kind, message, fallback),
      random: () => this.random(),
    };
    for (const [name, v] of makeGlobals(io)) this.builtins.vars.set(name, { v, kind: CONSTANTS.has(name) ? 'fixed' : 'var' });
    for (const [name, v] of Object.entries(options.hosts?.(this) ?? {})) this.builtins.vars.set(name, { v, kind: 'fixed' });
    this.frames.push({ id: 0, name: 'Global', scope: this.top });
  }

  // --- running ---

  run(): RunResult {
    const start = this.programs.find((p) => p.body.length);
    if (start) this.here = start.body[0].pos;
    let out: Pick<RunResult, 'status' | 'error' | 'limit' | 'waiting'> = { status: 'ok' };
    this.step(this.here, 'The program is about to start.', this.top);
    try {
      for (const p of this.programs) {
        this.declareProgram(p);
        for (const s of p.body) {
          if (this.exec(s, this.top) !== Done.Normal) break;
        }
      }
      this.after?.(this);
      this.step(this.here, 'The program finished.', this.top, 'done');
    } catch (e) {
      out = this.stopped(e);
    } finally {
      this.ended = true;
    }
    return { ...out, lines: this.lines, vars: this.finalVars(), facts: this.finishFacts(), dataMissing: [...this.pending.keys()].filter((k) => !this.taken.has(k)), steps: this.steps, ...(this.trace ? { trace: this.trace } : {}) };
  }

  private stopped(e: unknown): Pick<RunResult, 'status' | 'error' | 'limit' | 'waiting'> {
    let how: Stop['how'];
    if (e instanceof Stop) how = e.how;
    else if (isStackOverflow(e)) how = { error: this.errorAt('RangeError', 'Maximum call stack size exceeded', 'stack', this.here, this.userCalls ? 'Your function keeps calling itself and never stops. A function that calls itself needs an if statement that ends the calls.' : 'This line is too long for the editor to work out. Split it into shorter lines.') };
    else if (e instanceof RangeError) how = { error: this.errorAt('RangeError', e.message, 'range', this.here) };
    else how = { error: this.errorAt('InternalError', 'This editor ran into a problem it could not handle.', 'internal', this.here, String(e)) };
    if ('cut' in how) {
      this.closeTrace(`The step-through stops after ${commas(this.maxTrace)} steps. Run the program to see the rest.`, 'cut');
      return { status: 'cut' };
    }
    if ('waiting' in how) {
      this.closeTrace(`The program is waiting for your answer to: ${how.waiting.message}`, 'waiting');
      return { status: 'waiting', waiting: how.waiting };
    }
    if ('limit' in how) {
      this.closeTrace(how.limit.text, 'limit');
      return { status: 'limit', limit: how.limit };
    }
    this.closeTrace(how.error.help ?? `${how.error.type}: ${how.error.msg}`, 'error');
    return { status: 'error', error: how.error };
  }

  private closeTrace(say: string, end: TraceStep['end']): void {
    if (!this.trace) return;
    const f = this.frames[this.frames.length - 1];
    this.pushStep(this.here, say, f.scope, end);
  }

  private finishFacts(): RunFacts {
    for (const [n, runs] of this.loopRuns) this.facts.loops.push({ file: n.pos.file, line: n.pos.line, runs });
    this.facts.loops.sort((a, b) => a.line - b.line);
    this.facts.builtinCalls = [...this.seenCalls];
    return this.facts;
  }

  private finalVars(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, b] of this.top.vars) if (!b.tdz) out[name] = toPlain(b.v);
    return out;
  }

  private declareProgram(p: Program): void {
    this.here = p.body[0]?.pos ?? this.here;
    const clash = (name: string) => {
      const line = this.declLine(p, name);
      this.throwError('SyntaxError', `Identifier '${name}' has already been declared`, 'redeclared', line, `${name} was already declared in another file. A name can be declared only once across all of a page's scripts.`);
    };
    for (const l of p.lets) {
      const had = this.top.vars.get(l.name);
      if ((had && had.kind !== 'implicit') || CONSTANTS.has(l.name)) clash(l.name);
    }
    for (const name of [...p.vars, ...p.funcs.map((f) => f.name!)]) {
      const had = this.top.vars.get(name);
      if (had?.kind === 'let' || had?.kind === 'const') clash(name);
    }
    for (const name of p.vars) {
      if (!this.top.vars.has(name) && !CONSTANTS.has(name)) this.top.vars.set(name, { v: this.builtins.vars.get(name)?.v, kind: 'var' });
    }
    this.declareLexical(p, this.top);
  }

  private declLine(p: Program, name: string): Pos {
    for (const s of p.body) {
      if (s.k === 'var' && s.decls.some((d) => d.name === name)) return s.decls.find((d) => d.name === name)!.pos;
      if (s.k === 'fndecl' && s.fn.name === name) return s.pos;
    }
    return p.body[0]?.pos ?? this.here;
  }

  /** Makes a block's `let`, `const`, and function names, before its first line runs. */
  private declareLexical(b: { lets: { name: string; kind: string }[]; funcs: Fn[] }, s: Scope): void {
    for (const l of b.lets) {
      if (l.kind === 'fn') continue;
      s.vars.set(l.name, { v: undefined, kind: l.kind as 'let' | 'const', tdz: true });
    }
    for (const f of b.funcs) {
      const v = this.closure(f, s, f.name!);
      const had = s.vars.get(f.name!);
      if (had) had.v = v;
      else s.vars.set(f.name!, { v, kind: 'fn' });
    }
  }

  private closure(f: Fn, s: Scope, name: string): JsFunction {
    return new JsFunction(f, s, name, this.sources.get(f.pos.file)!.slice(f.off, f.end));
  }

  private src(n: { pos: Pos; off: number; end: number }): string {
    return textOf({ source: this.sources.get(n.pos.file)! }, n);
  }

  // --- errors and limits ---

  private errorAt(type: string, msg: string, code: string, pos: Pos, help?: string): JsError {
    return { type, msg, code, pos, ...(help ? { help } : {}) };
  }

  private throwError(type: string, msg: string, code: string, pos: Pos, help?: string): never {
    throw new Stop({ error: this.errorAt(type, msg, code, pos, help) });
  }

  fail(type: string, msg: string, code = 'error', help?: string): never {
    this.throwError(type, msg, code, this.here, help ?? helpFor(code));
  }

  at(): Pos {
    return this.here;
  }

  notAvailable(msg: string): never {
    this.throwError('NotAvailable', msg, 'not-available', this.here, 'The labs in this editor use a smaller part of JavaScript, so this line has to change before the code can run.');
  }

  private tick(): void {
    if (++this.steps > this.maxSteps) this.outOfSteps();
  }

  charge(n: number): void {
    if (this.ended) return; // reading a live list for the final variables is not the program running
    this.steps += n;
    if (this.steps > this.maxSteps) this.outOfSteps();
  }

  checkLength(n: number): void {
    if (n > MAX_STRING) this.tooLong();
    this.charge(n >> 5);
  }

  private tooLong(): never {
    throw new Stop({ limit: { why: 'memory', text: `This program built a string more than ${commas(MAX_STRING)} characters long, so it was stopped. A loop may be adding to the string more times than you meant.`, file: this.here.file, line: this.here.line } });
  }

  private outOfSteps(): never {
    const stuck = this.watches.find((x) => x.runs > 1 && x.info.probes.length > 0 && !x.samples.some((s) => s.changed));
    const w = stuck ?? this.watches[this.watches.length - 1];
    if (w) {
      if (w.scope) this.sample(w, w.scope, true);
      throw new Stop({ limit: { why: 'loop', text: this.loopText(w), file: w.node.pos.file, line: w.node.pos.line } });
    }
    throw new Stop({ limit: { why: 'steps', text: `This program took more than ${commas(this.maxSteps)} steps, so it was stopped. Look for a function that runs more times than you meant.`, file: this.here.file, line: this.here.line } });
  }

  private loopText(w: Watch): string {
    const { info } = w;
    const head = `The loop on line ${w.node.pos.line} ran ${commas(w.runs)} times without stopping.`;
    if (w.node.k === 'forof') {
      const grown = w.samples.findIndex((s) => s.up);
      return grown >= 0 ? `${head} ${info.probes[grown].text} kept growing, so the loop never reached the end of the list.` : head;
    }
    if (w.node.k === 'forin') return head;
    if (!info.test) return `${head} It has no condition, so only a break statement can end it, and no break ran.`;
    const cond = `Its condition is ${info.test}`;
    if (!info.probes.length) return `${head} ${cond}, which never changes, so only a break statement can end the loop.`;
    const changed = info.probes.map((p, i) => ({ p, s: w.samples[i] })).filter((x) => x.s?.changed);
    if (!changed.length) {
      const stayed = info.probes.map((p, i) => `${p.text} stayed ${valueWord(w.samples[i]?.last)}`).join(' and ');
      return `${head} ${cond}, and ${stayed} the whole time.`;
    }
    const parts = changed.slice(0, 2).map(({ p, s }) => {
      if (s.up && !s.down) return `${p.text} kept growing, from ${valueWord(s.first)} to ${valueWord(s.last)}`;
      if (s.down && !s.up) return `${p.text} kept shrinking, from ${valueWord(s.first)} to ${valueWord(s.last)}`;
      return `${p.text} kept changing`;
    });
    return `${head} ${cond}, and ${parts.join(', and ')}, but the condition never became false.`;
  }

  private watch(n: Loop): Watch {
    let info = this.loopInfos.get(n);
    if (!info) {
      info = loopInfo(n, this.sources.get(n.pos.file)!);
      this.loopInfos.set(n, info);
    }
    const w: Watch = { node: n, info, runs: 0, samples: [], calls: this.userCalls };
    this.watches.push(w);
    return w;
  }

  private unwatch(w: Watch): void {
    this.watches.pop();
    this.loopRuns.set(w.node, (this.loopRuns.get(w.node) ?? 0) + w.runs);
  }

  /** Called each time a loop is about to run its body again. */
  private sample(w: Watch, s: Scope, force = false): void {
    w.scope = s;
    const r = w.runs;
    if (!force && r >= 64 && (r & 63) !== 0) return;
    const { probes } = w.info;
    for (let i = 0; i < probes.length; i++) {
      const v = peek(probes[i].expr, s);
      const was = w.samples[i];
      if (!was) {
        w.samples[i] = { first: v, last: v, changed: false, up: false, down: false };
        continue;
      }
      if (Object.is(was.last, v)) continue;
      was.changed = true;
      if (typeof v === 'number' && typeof was.last === 'number') {
        if (v > was.last) was.up = true;
        else if (v < was.last) was.down = true;
      } else was.up = was.down = true;
      was.last = v;
    }
  }

  private checkStuck(w: Watch): void {
    if (w.runs !== STUCK_RUNS || !w.info.plain || !w.info.probes.length) return;
    if (w.samples.some((x) => x.changed) || this.userCalls !== w.calls) return;
    throw new Stop({ limit: { why: 'loop', text: this.loopText(w), file: w.node.pos.file, line: w.node.pos.line } });
  }

  // --- output ---

  private print(l: { kind: OutputLine['kind']; text: string; error?: true; answer?: string | null }): void {
    if (this.lines.length >= this.maxLines) {
      throw new Stop({ limit: { why: 'output', text: `This program printed ${commas(this.maxLines)} lines, so it was stopped. A loop may be running more times than you meant.`, file: this.here.file, line: this.here.line } });
    }
    const text = l.text.length > MAX_LINE_TEXT ? `${l.text.slice(0, MAX_LINE_TEXT)}…` : l.text;
    this.textOut += text.length;
    if (this.textOut > MAX_OUTPUT_TEXT) {
      throw new Stop({ limit: { why: 'output', text: `This program printed more than ${commas(MAX_OUTPUT_TEXT)} characters, so it was stopped. A loop may be running more times than you meant.`, file: this.here.file, line: this.here.line } });
    }
    this.lines.push({ ...l, text, file: this.here.file, line: this.here.line });
  }

  private ask(kind: 'prompt' | 'confirm', message: string, fallback: string): string | null {
    if (this.asked >= this.answers.length) throw new Stop({ waiting: { kind, message, default: fallback } });
    const answer = this.answers[this.asked++];
    this.facts.prompts++;
    this.print({ kind, text: message, answer });
    if (kind === 'prompt' && answer !== null) this.promptAnswers.set(answer, this.here);
    return answer;
  }

  // --- conversions ---

  prim(v: Value, hint: 'string' | 'number' | 'default' = 'default'): Primitive {
    if (typeof v !== 'object' || v === null) return v;
    if (v instanceof HostObject) return v.asString?.() ?? v.label();
    for (const m of hint === 'string' ? (['toString', 'valueOf'] as const) : (['valueOf', 'toString'] as const)) {
      const own = v.props.get(m);
      if (!v.props.has(m)) {
        if (m === 'toString') return this.plainString(v);
        continue;
      }
      if (!isCallable(own)) continue;
      const r = this.call(own, v, []);
      if (typeof r !== 'object' || r === null) return r;
    }
    this.fail('TypeError', 'Cannot convert object to primitive value', 'to-primitive');
  }

  private plainString(v: JsObject): string {
    if (v instanceof JsArray) return joinArray(v, ',', this);
    if (v instanceof JsNamespace) return `[object ${v.name}]`;
    return OBJECT_METHODS.get('toString')!.run(v, [], this) as string;
  }

  str(v: Value): string {
    return typeof v === 'string' ? v : String(this.prim(v, 'string'));
  }

  num(v: Value): number {
    return typeof v === 'number' ? v : Number(this.prim(v, 'number'));
  }

  array(items: Value[]): JsArray {
    return new JsArray(items);
  }

  private key(v: Value): string {
    return typeof v === 'string' ? v : this.str(v);
  }

  // --- variables ---

  private read(name: string, s: Scope, pos: Pos): Value {
    const b = s.find(name);
    if (!b) this.notDefined(name, s, pos);
    if (b.tdz) this.throwError('ReferenceError', `Cannot access '${name}' before initialization`, 'tdz', pos, `${name} is used before the line that declares it. Move the let or const line above this line.`);
    return b.v;
  }

  private notDefined(name: string, s: Scope, pos: Pos): never {
    if (NOT_GLOBAL.has(name)) {
      this.here = pos;
      this.notAvailable(`${name} is not available in this editor.`);
    }
    const names = new Set<string>();
    for (let c: Scope | null = s; c; c = c.parent) for (const k of c.vars.keys()) names.add(k);
    const made = new Query(this.programs).declarations().find((d) => d.name === name && d.scope !== 'top' && d.file === pos.file);
    this.throwError('ReferenceError', `${name} is not defined`, 'not-defined', pos, notDefinedHelp(name, names, made?.line));
  }

  private write(name: string, v: Value, s: Scope, pos: Pos): void {
    const b = s.find(name);
    if (!b) {
      if (this.pending.has(name) && this.frames.length === 1) v = this.takeData(name);
      this.top.vars.set(name, { v, kind: 'implicit' });
      return;
    }
    this.store(b, name, v, pos);
  }

  private store(b: Binding, name: string, v: Value, pos: Pos): void {
    if (b.tdz) this.throwError('ReferenceError', `Cannot access '${name}' before initialization`, 'tdz', pos, `${name} is used before the line that declares it. Move the let or const line above this line.`);
    if (b.kind === 'const') this.throwError('TypeError', 'Assignment to constant variable.', 'const-assign', pos, b.v instanceof JsArray ? `${name} was declared with const, so it can't be given a whole new array. You can still change it one item at a time, with an index or a method like push. If you do want a new array, change const to let where ${name} is declared.` : `${name} was declared with const, so it can't be given a new value. Change const to let where ${name} is declared.`);
    if (b.kind === 'self' || b.kind === 'fixed') return;
    if (this.pinned.size && this.pinned.has(name) && this.frames.length === 1) {
      this.pinned.delete(name);
      return;
    }
    b.v = v;
  }

  private takeData(name: string): Value {
    this.taken.add(name);
    return fromPlain(this.pending.get(name));
  }

  /** A declaration at the top of the program. Whether `data` replaces its first value. */
  private dataFor(name: string, s: Scope): boolean {
    return this.pending.size > 0 && this.pending.has(name) && !this.taken.has(name) && this.frames.length === 1 && (s === this.top || s.vars.get(name) === undefined);
  }

  // --- statements ---

  private exec(n: Stmt, s: Scope): Done {
    if (n.k === 'block') return this.execBlock(n, s);
    this.tick();
    switch (n.k) {
      case 'expr': {
        this.here = n.pos;
        const v = this.ev(n.e, s);
        if (this.trace) this.step(n.pos, this.sayExpr(n.e, v), s);
        return Done.Normal;
      }
      case 'var':
        this.execVar(n, s);
        return Done.Normal;
      case 'fndecl':
        if (n.hoists) {
          const b = s.find(n.fn.name!);
          let outer = s.parent;
          while (outer && !outer.vars.has(n.fn.name!)) outer = outer.parent;
          if (b && outer) {
            const target = outer.vars.get(n.fn.name!)!;
            target.v = b.v;
          }
        }
        return Done.Normal;
      case 'if': {
        const v = this.ev(n.test, s);
        if (this.trace) this.step(n.test.pos, this.sayTest(n.test, v, !!v ? ', so the if block runs.' : n.no ? ', so the else block runs.' : ', so the if block is skipped.'), s);
        if (v) return this.exec(n.yes, s);
        return n.no ? this.exec(n.no, s) : Done.Normal;
      }
      case 'while':
        return this.execWhile(n, s);
      case 'do':
        return this.execDo(n, s);
      case 'for':
        return this.execFor(n, s);
      case 'forof':
        return this.execForOf(n, s);
      case 'forin':
        return this.execForIn(n, s);
      case 'break':
        if (this.trace) this.step(n.pos, 'break ends the loop or switch here.', s);
        return Done.Break;
      case 'continue':
        if (this.trace) this.step(n.pos, 'continue skips the rest of this pass through the loop.', s);
        return Done.Continue;
      case 'return': {
        this.ret = n.e ? this.ev(n.e, s) : undefined;
        if (this.trace) this.step(n.pos, `${this.frames[this.frames.length - 1].name} returns ${shownText(this.ret)}.`, s);
        return Done.Return;
      }
      case 'switch':
        return this.execSwitch(n, s);
      case 'empty':
        return Done.Normal;
    }
  }

  private execBlock(b: Block, s: Scope): Done {
    const inner = b.lets.length || b.funcs.length ? new Scope(s) : s;
    if (inner !== s) this.declareLexical(b, inner);
    return this.execList(b.body, inner);
  }

  private execList(list: Stmt[], s: Scope): Done {
    for (let i = 0; i < list.length; i++) {
      const d = this.exec(list[i], s);
      if (d !== Done.Normal) return d;
    }
    return Done.Normal;
  }

  private execVar(n: VarDecl, s: Scope): void {
    for (const d of n.decls) {
      this.here = d.pos;
      if (n.kind === 'var') {
        if (!d.init) {
          if (this.dataFor(d.name, s)) this.setData(d.name, s);
          else if (this.trace) this.step(d.pos, `${d.name} is declared.`, s);
          continue;
        }
        const useData = this.dataFor(d.name, s);
        const v = useData ? this.takeData(d.name) : this.named(d.init, d.name, s);
        const b = s.find(d.name)!;
        if (b.kind !== 'fixed') b.v = v;
        if (this.trace) this.step(d.pos, `${d.name} is now ${shownText(v)}.`, s);
        continue;
      }
      const b = s.vars.get(d.name)!;
      const useData = this.dataFor(d.name, s);
      if (useData) {
        b.v = this.takeData(d.name);
        if (!d.init) this.pinned.add(d.name);
      } else b.v = d.init ? this.named(d.init, d.name, s) : undefined;
      b.tdz = false;
      if (this.trace) this.step(d.pos, d.init ? `${d.name} is now ${shownText(b.v)}.` : `${d.name} is declared. It holds undefined until it gets a value.`, s);
    }
  }

  private setData(name: string, s: Scope): void {
    const b = s.find(name)!;
    b.v = this.takeData(name);
    this.pinned.add(name);
  }

  /** Evaluates `e`, giving an anonymous function the name it's being assigned to. */
  private named(e: Expr, name: string, s: Scope): Value {
    if (e.k === 'fn' && !e.name && !e.parens) return this.closure(e, s, name);
    return this.ev(e, s);
  }

  private test(n: Expr, s: Scope, w: Watch): boolean {
    this.tick();
    this.here = n.pos;
    const v = this.ev(n, s);
    if (this.trace) this.step(n.pos, this.sayTest(n, v, !!v ? ', so the loop runs.' : ', so the loop ends.'), s);
    this.sample(w, s);
    this.checkStuck(w);
    return !!v;
  }

  private execWhile(n: While, s: Scope): Done {
    const w = this.watch(n);
    try {
      while (this.test(n.test, s, w)) {
        w.runs++;
        const d = this.exec(n.body, s);
        if (d === Done.Break) break;
        if (d === Done.Return) return d;
      }
      return Done.Normal;
    } finally {
      this.unwatch(w);
    }
  }

  private execDo(n: DoWhile, s: Scope): Done {
    const w = this.watch(n);
    try {
      do {
        w.runs++;
        const d = this.exec(n.body, s);
        if (d === Done.Break) break;
        if (d === Done.Return) return d;
      } while (this.test(n.test, s, w));
      return Done.Normal;
    } finally {
      this.unwatch(w);
    }
  }

  /** A fresh set of the loop's variables, so a function made in one pass keeps that pass's values. */
  private copyScope(s: Scope): Scope {
    const c = new Scope(s.parent);
    for (const [k, b] of s.vars) c.vars.set(k, { ...b });
    return c;
  }

  private execFor(n: For, s: Scope): Done {
    let scope = s;
    if (n.lets.length) {
      scope = new Scope(s);
      for (const l of n.lets) scope.vars.set(l.name, { v: undefined, kind: l.kind as 'let' | 'const', tdz: true });
    }
    if (n.init) {
      if (n.init.k === 'var') this.execVar(n.init, scope);
      else {
        this.here = n.init.pos;
        const v = this.ev(n.init.e, scope);
        if (this.trace) this.step(n.init.pos, this.sayExpr(n.init.e, v), scope);
      }
    }
    const fresh = n.closures && n.lets.length > 0;
    if (fresh) scope = this.copyScope(scope);
    const w = this.watch(n);
    try {
      for (;;) {
        if (n.test) {
          if (!this.test(n.test, scope, w)) break;
        } else this.tick();
        w.runs++;
        const d = this.exec(n.body, scope);
        if (d === Done.Break) break;
        if (d === Done.Return) return d;
        if (fresh) scope = this.copyScope(scope);
        if (n.update) {
          this.here = n.update.pos;
          const v = this.ev(n.update, scope);
          if (this.trace) this.step(n.update.pos, this.sayExpr(n.update, v), scope);
        }
      }
      return Done.Normal;
    } finally {
      this.unwatch(w);
    }
  }

  /** Puts a loop's next value in place, and says which scope the body runs in. */
  private bindEach(n: ForEach, v: Value, s: Scope): Scope {
    if (n.decl === 'let' || n.decl === 'const') {
      const c = new Scope(s);
      c.vars.set(n.target as string, { v, kind: n.decl });
      return c;
    }
    if (n.decl === 'var') this.write(n.target as string, v, s, n.pos);
    else this.assignTo(n.target as Expr, v, s);
    return s;
  }

  private assignTo(t: Expr, v: Value, s: Scope): void {
    if (t.k === 'id') this.write(t.name, v, s, t.pos);
    else if (t.k === 'member') this.setProp(this.ev(t.obj, s), t.name, v, t);
    else if (t.k === 'index') {
      const o = this.ev(t.obj, s);
      this.setProp(o, this.key(this.ev(t.key, s)), v, t);
    }
  }

  /** The iterable's scope: the loop variable exists, but reading it is an error. */
  private eachHead(n: ForEach, s: Scope): Value {
    if (n.decl !== 'let' && n.decl !== 'const') return this.ev(n.iter, s);
    const head = new Scope(s);
    head.vars.set(n.target as string, { v: undefined, kind: n.decl, tdz: true });
    return this.ev(n.iter, head);
  }

  private execForOf(n: ForEach, s: Scope): Done {
    this.here = n.pos;
    const it = this.eachHead(n, s);
    const w = this.watch(n);
    try {
      let list: Value[] | undefined;
      if (it instanceof JsArray) list = it.items;
      else if (typeof it === 'string') list = Array.from(it);
      else if (it instanceof HostObject && it.items) list = it.items();
      else this.notIterable(n, it);
      for (let i = 0; i < list.length; i++) {
        this.tick();
        w.runs++;
        this.sample(w, s);
        const v = list[i];
        const inner = this.bindEach(n, v, s);
        if (this.trace) this.step(n.pos, `The loop takes the next value: ${shownText(v)}.`, inner);
        const d = this.exec(n.body, inner);
        if (d === Done.Break) return Done.Normal;
        if (d === Done.Return) return d;
      }
      if (this.trace) this.step(n.pos, 'There are no more values, so the loop ends.', s);
      return Done.Normal;
    } finally {
      this.unwatch(w);
    }
  }

  private notIterable(n: ForEach, v: Value): never {
    const msg = n.iter.k === 'call' ? `${printed(n.iter.callee)} is not a function or its return value is not iterable` : `${printed(n.iter)} is not iterable`;
    this.throwError('TypeError', msg, 'not-iterable', n.iter.pos, `for...of needs an array or a string to loop over, and ${this.src(n.iter)} holds ${shownText(v)}. To loop over an object's keys, use for...in.`);
  }

  private execForIn(n: ForEach, s: Scope): Done {
    this.here = n.pos;
    const it = this.eachHead(n, s);
    const present = (k: string) => {
      if (it instanceof JsArray) {
        const i = arrayIndex(k);
        return i >= 0 ? i in it.items : it.props.has(k);
      }
      if (it instanceof JsObject) return it.props.has(k);
      return true;
    };
    let keys: string[] = [];
    if (it instanceof JsArray) keys = [...Object.keys(it.items), ...ownKeys(it)];
    else if (it instanceof JsObject) keys = ownKeys(it);
    else if (typeof it === 'string') keys = Object.keys(it);
    this.charge(keys.length);
    const w = this.watch(n);
    try {
      for (const k of keys) {
        this.tick();
        if (!present(k)) continue;
        w.runs++;
        const inner = this.bindEach(n, k, s);
        if (this.trace) this.step(n.pos, `The loop takes the next key: ${shownText(k)}.`, inner);
        const d = this.exec(n.body, inner);
        if (d === Done.Break) return Done.Normal;
        if (d === Done.Return) return d;
      }
      if (this.trace) this.step(n.pos, 'There are no more keys, so the loop ends.', s);
      return Done.Normal;
    } finally {
      this.unwatch(w);
    }
  }

  private execSwitch(n: Switch, s: Scope): Done {
    const v = this.ev(n.test, s);
    const inner = new Scope(s);
    this.declareLexical(n, inner);
    let start = -1;
    for (let i = 0; i < n.cases.length && start < 0; i++) {
      const c = n.cases[i];
      if (c.test) {
        this.tick();
        if (this.ev(c.test, inner) === v) start = i;
      }
    }
    if (start < 0) start = n.cases.findIndex((c) => !c.test);
    if (start < 0) {
      if (this.trace) this.step(n.pos, `No case matches ${shownText(v)}, so the switch is skipped.`, s);
      return Done.Normal;
    }
    if (this.trace) this.step(n.cases[start].pos, n.cases[start].test ? `The value ${shownText(v)} matches this case.` : `No case matches ${shownText(v)}, so default runs.`, s);
    for (let i = start; i < n.cases.length; i++) {
      const d = this.execList(n.cases[i].body, inner);
      if (d === Done.Break) return Done.Normal;
      if (d !== Done.Normal) return d;
    }
    return Done.Normal;
  }

  // --- expressions ---

  private ev(e: Expr, s: Scope): Value {
    switch (e.k) {
      case 'num':
      case 'str':
      case 'bool':
        return e.v;
      case 'null':
        return null;
      case 'id':
        return this.read(e.name, s, e.pos);
      case 'template': {
        let out = e.strs[0];
        for (let i = 0; i < e.exprs.length; i++) {
          out += this.str(this.ev(e.exprs[i], s)) + e.strs[i + 1];
          if (out.length > MAX_STRING) this.tooLong();
        }
        return out;
      }
      case 'array': {
        const items: Value[] = [];
        items.length = e.items.length;
        for (let i = 0; i < e.items.length; i++) {
          const x = e.items[i];
          if (x) items[i] = this.ev(x, s);
        }
        return new JsArray(items);
      }
      case 'object': {
        const o = new JsObject();
        for (const p of e.props) {
          const k = typeof p.key === 'string' ? p.key : this.key(this.ev(p.key, s));
          if (BLOCKED.has(k)) {
            this.here = p.pos;
            this.notAvailable(`${k} is not available in this editor.`);
          }
          o.props.set(k, this.named(p.value, k, s));
        }
        return o;
      }
      case 'fn':
        return this.closure(e, s, e.name ?? '');
      case 'unary':
        return this.evUnary(e, s);
      case 'update': {
        const old = this.num(this.ev(e.target, s));
        const now = e.op === '++' ? old + 1 : old - 1;
        this.assignTo(e.target, now, s);
        return e.prefix ? now : old;
      }
      case 'binary':
        if (e.op === 'in') return this.evIn(e.l, e.r, s);
        return this.binary(e.op, this.ev(e.l, s), this.ev(e.r, s), e);
      case 'logical': {
        const l = this.ev(e.l, s);
        if (e.op === '&&') return l ? this.ev(e.r, s) : l;
        if (e.op === '||') return l ? l : this.ev(e.r, s);
        return l === undefined || l === null ? this.ev(e.r, s) : l;
      }
      case 'cond':
        return this.ev(e.test, s) ? this.ev(e.yes, s) : this.ev(e.no, s);
      case 'assign':
        return this.evAssign(e, s);
      case 'seq': {
        let v: Value;
        for (const x of e.items) v = this.ev(x, s);
        return v;
      }
      case 'member':
        return this.evMember(e, s);
      case 'index':
        return this.evIndex(e, s);
      case 'call':
        return this.evCall(e, s);
    }
  }

  private evUnary(e: Extract<Expr, { k: 'unary' }>, s: Scope): Value {
    switch (e.op) {
      case 'typeof': {
        if (e.e.k === 'id') {
          const b = s.find(e.e.name);
          if (!b) {
            if (NOT_GLOBAL.has(e.e.name)) this.notDefined(e.e.name, s, e.e.pos);
            return 'undefined';
          }
        }
        return typeOf(this.ev(e.e, s));
      }
      case '!':
        return !this.ev(e.e, s);
      case '-':
        return -this.num(this.ev(e.e, s));
      case '+':
        return this.num(this.ev(e.e, s));
      case '~':
        return ~this.num(this.ev(e.e, s));
      case 'void':
        this.ev(e.e, s);
        return undefined;
      case 'delete':
        return this.evDelete(e.e, s);
    }
  }

  private evDelete(t: Expr, s: Scope): Value {
    if (t.k !== 'member' && t.k !== 'index') {
      this.ev(t, s);
      return true;
    }
    const o = this.ev(t.obj, s);
    const k = t.k === 'member' ? t.name : this.key(this.ev(t.key, s));
    if (o === undefined || o === null) this.throwError('TypeError', `Cannot convert undefined or null to object`, 'read-undefined', t.pos);
    if (BLOCKED.has(k)) this.notAvailable(`${k} is not available in this editor.`);
    if (o instanceof JsArray) {
      if (k === 'length') return false;
      const i = arrayIndex(k);
      if (i >= 0) delete o.items[i];
      else o.props.delete(k);
    } else if (o instanceof JsNamespace || o instanceof JsNative || o instanceof HostObject) this.notAvailable(`Deleting from ${o instanceof HostObject ? o.label() : o.name} is not available in this editor.`);
    else if (o instanceof JsObject) o.props.delete(k);
    return true;
  }

  private evIn(le: Expr, re: Expr, s: Scope): boolean {
    const l = this.ev(le, s);
    const r = this.ev(re, s);
    if (typeof r !== 'object' || r === null) {
      this.throwError('TypeError', `Cannot use 'in' operator to search for '${this.str(l)}' in ${this.str(r)}`, 'bad-in', re.pos, `The in operator looks for a key in an object or an array. ${this.src(re)} holds ${shownText(r)}.`);
    }
    if (r instanceof HostObject) this.notAvailable(`The in operator on ${r.label()} is not available in this editor.`);
    const k = this.key(l);
    if (r.props.has(k)) return true;
    if (r instanceof JsArray) {
      if (k === 'length' || ARRAY_METHODS.has(k) || NOT_ARRAY.has(k)) return true;
      const i = arrayIndex(k);
      return i >= 0 && i in r.items;
    }
    return OBJECT_METHODS.has(k) || NOT_OBJECT.has(k);
  }

  private binary(op: string, l: Value, r: Value, e: { pos: Pos }): Value {
    switch (op) {
      case '+': {
        if (typeof l === 'number' && typeof r === 'number') return l + r;
        const a = this.prim(l);
        const b = this.prim(r);
        const out = ((a as number) + (b as number)) as number | string;
        if (typeof out === 'string') {
          if (out.length > MAX_STRING) this.tooLong();
          if (this.promptAnswers.size) this.notePromptPlus(a, b, e.pos);
        }
        return out;
      }
      case '-':
        return this.num(l) - this.num(r);
      case '*':
        return this.num(l) * this.num(r);
      case '/':
        return this.num(l) / this.num(r);
      case '%':
        return this.num(l) % this.num(r);
      case '**':
        return this.num(l) ** this.num(r);
      case '&':
        return this.num(l) & this.num(r);
      case '|':
        return this.num(l) | this.num(r);
      case '^':
        return this.num(l) ^ this.num(r);
      case '<<':
        return this.num(l) << this.num(r);
      case '>>':
        return this.num(l) >> this.num(r);
      case '>>>':
        return this.num(l) >>> this.num(r);
      case '===':
        if (this.promptAnswers.size) this.notePromptCompare(l, r, e.pos);
        return l === r;
      case '!==':
        if (this.promptAnswers.size) this.notePromptCompare(l, r, e.pos);
        return l !== r;
      case '==':
        return this.looseEq(l, r);
      case '!=':
        return !this.looseEq(l, r);
      default: {
        const a = this.prim(l, 'number') as number;
        const b = this.prim(r, 'number') as number;
        if (op === '<') return a < b;
        if (op === '>') return a > b;
        if (op === '<=') return a <= b;
        return a >= b;
      }
    }
  }

  private notePromptPlus(a: Primitive, b: Primitive, pos: Pos): void {
    const numeric = (v: Primitive) => typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) && this.promptAnswers.has(v);
    const hit = (numeric(a) && (typeof b === 'number' || numeric(b))) || (numeric(b) && typeof a === 'number');
    if (!hit) return;
    const key = `${pos.file}:${pos.off}`;
    if (this.seenPlus.has(key)) return;
    this.seenPlus.add(key);
    this.facts.promptPlus.push({ file: pos.file, line: pos.line });
  }

  private notePromptCompare(a: Value, b: Value, pos: Pos): void {
    const from = (v: Value, other: Value) => (typeof v === 'string' && typeof other === 'number' ? this.promptAnswers.get(v) : undefined);
    const prompt = from(a, b) ?? from(b, a);
    if (!prompt || this.facts.promptCompare.some((f) => f.file === pos.file && f.off === pos.off)) return;
    this.facts.promptCompare.push({ file: pos.file, line: pos.line, off: pos.off, prompt });
  }

  private looseEq(l: Value, r: Value): boolean {
    const lo = typeof l === 'object' && l !== null;
    const ro = typeof r === 'object' && r !== null;
    if (lo && ro) return l === r;
    if (lo) return r === undefined || r === null ? false : (this.prim(l) as unknown) == r;
    if (ro) return l === undefined || l === null ? false : l == (this.prim(r) as unknown);
    return l == r;
  }

  private evAssign(e: Assign, s: Scope): Value {
    const t = e.target;
    if (t.k === 'id') {
      if (e.op === '=') {
        const v = this.named(e.value, t.name, s);
        this.write(t.name, v, s, t.pos);
        return v;
      }
      const old = this.read(t.name, s, t.pos);
      const shortcut = this.shortCircuit(e.op, old);
      if (shortcut) return old;
      const v = this.compound(e, old, s);
      this.write(t.name, v, s, t.pos);
      return v;
    }
    if (t.k !== 'member' && t.k !== 'index') return undefined;
    const o = this.ev(t.obj, s);
    const k = t.k === 'member' ? t.name : this.ev(t.key, s);
    if (e.op === '=') {
      const v = this.ev(e.value, s);
      this.setProp(o, this.key(k), v, t);
      return v;
    }
    const old = this.getProp(o, this.key(k), t);
    if (this.shortCircuit(e.op, old)) return old;
    const v = this.compound(e, old, s);
    this.setProp(o, this.key(k), v, t);
    return v;
  }

  private shortCircuit(op: string, old: Value): boolean {
    if (op === '&&=') return !old;
    if (op === '||=') return !!old;
    if (op === '??=') return old !== undefined && old !== null;
    return false;
  }

  private compound(e: Assign, old: Value, s: Scope): Value {
    if (e.op === '&&=' || e.op === '||=' || e.op === '??=') return this.ev(e.value, s);
    return this.binary(e.op.slice(0, -1), old, this.ev(e.value, s), e);
  }

  private evMember(e: Member, s: Scope): Value {
    const o = this.ev(e.obj, s);
    const v = this.getProp(o, e.name, e);
    if (v === undefined) this.noteMissing(o, e);
    return v;
  }

  private noteMissing(o: Value, e: Member): void {
    if (!(o instanceof JsObject) && typeof o !== 'string') return;
    if (o instanceof JsObject && o.props.has(e.name)) return;
    const names = o instanceof JsArray || typeof o === 'string' ? ['length', ...(typeof o === 'string' ? STRING_METHODS : ARRAY_METHODS).keys()] : o instanceof JsObject ? [...o.props.keys()] : [];
    if (e.name.length < 3) return;
    const suggestion = closestName(e.name, names);
    if (!suggestion) return;
    const key = `${e.pos.file}:${e.pos.off}`;
    if (this.seenMisspelled.has(key)) return;
    this.seenMisspelled.add(key);
    this.facts.misspelled.push({ file: e.pos.file, line: e.pos.line, object: this.src(e.obj), name: e.name, suggestion });
  }

  private evIndex(e: Index, s: Scope): Value {
    const o = this.ev(e.obj, s);
    const k = this.ev(e.key, s);
    if (typeof k === 'number' && (o instanceof JsArray || typeof o === 'string')) {
      const length = typeof o === 'string' ? o.length : o.items.length;
      if (k === length && !this.seenIndex.has(e.off)) {
        this.seenIndex.add(e.off);
        this.facts.indexAtLength.push({ file: e.pos.file, line: e.pos.line, off: e.off, target: this.src(e.obj), index: k, length });
      }
      if (typeof o === 'string') {
        if (k >>> 0 === k) return k < length ? o[k] : undefined;
      } else if (k >>> 0 === k) {
        const v = o.items[k];
        if (v !== undefined || k in o.items) return v;
      }
    }
    if (o === undefined || o === null) this.readOfNothing(o, this.str(k), e);
    return this.getProp(o, this.key(k), e);
  }

  private readOfNothing(o: undefined | null, key: string, e: Member | Index): never {
    const from = e.obj;
    let help = `${this.src(from)} is ${String(o)}, so it has no properties to read. Check where ${this.src(from)} gets its value.`;
    if (o === null && this.facts.prompts) help += ' prompt gives back null when you press Cancel.';
    if (from.k === 'index') {
      help = `${this.src(from)} is ${String(o)}. That usually means the index is past the end of the array, and an array of n items has indexes 0 to n - 1. Check the index, or the loop that sets it.`;
    }
    this.throwError('TypeError', `Cannot read properties of ${String(o)} (reading '${key}')`, 'read-undefined', e.pos, help);
  }

  // --- properties ---

  private getProp(o: Value, k: string, e: Member | Index): Value {
    if (o === undefined || o === null) this.readOfNothing(o, k, e);
    if (BLOCKED.has(k)) this.blocked(k, e);
    this.here = e.pos;
    if (typeof o === 'string') {
      if (k === 'length') return o.length;
      const i = arrayIndex(k);
      if (i >= 0) return i < o.length ? o[i] : undefined;
      return STRING_METHODS.get(k) ?? this.missing(k, NOT_STRING, 'Strings');
    }
    if (typeof o === 'number') return NUMBER_METHODS.get(k) ?? this.missing(k, NOT_NUMBER, 'Numbers');
    if (typeof o === 'boolean') return BOOLEAN_METHODS.get(k) ?? this.missing(k, undefined, 'Booleans');
    if (o instanceof HostObject) return this.hostGet(o, k);
    if (o instanceof JsArray) {
      if (k === 'length') return o.items.length;
      const i = arrayIndex(k);
      if (i >= 0) return o.items[i];
      return o.props.has(k) ? o.props.get(k) : (ARRAY_METHODS.get(k) ?? this.missing(k, NOT_ARRAY, 'Arrays'));
    }
    if (o.props.has(k)) return o.props.get(k);
    if (o instanceof JsNamespace) return this.missing(k, STATIC_DENY[o.name], o.name);
    if (o instanceof JsFunction || o instanceof JsNative) {
      if (k === 'name') return o.name;
      if (k === 'length') {
        if (o instanceof JsNative) return 0;
        const first = o.fn.params.findIndex((p) => p.init);
        return first < 0 ? o.fn.params.length : first;
      }
      if (o instanceof JsNative && STATIC_DENY[o.name]) return this.missing(k, STATIC_DENY[o.name], o.name);
      return OBJECT_METHODS.get(k) ?? this.missing(k, NOT_FUNCTION, 'Functions');
    }
    return OBJECT_METHODS.get(k) ?? this.missing(k, undefined, 'Objects');
  }

  private blocked(k: string, e: Member | Index): never {
    this.here = e.pos;
    this.notAvailable(`${k} is not available in this editor.`);
  }

  /** A name that isn't on the value: a stop if a browser would have it, and undefined if not. */
  private missing(k: string, deny: Set<string> | undefined, what: string): undefined {
    if (deny?.has(k) || NOT_OBJECT.has(k)) this.notAvailable(`${what === 'Math' || what === 'console' || what === 'Number' || what === 'String' || what === 'Array' ? `${what}.${k}` : k} is not available in this editor.`);
    return undefined;
  }

  private hostGet(o: HostObject, k: string): Value {
    if (o.allow.call?.includes(k)) return new JsNative(k, (_s, a, rt) => o.call(k, a, rt));
    if (o.allow.get?.includes(k)) return o.get(k, this);
    const known = o.read?.(k, this);
    if (known) return known.value;
    this.notAvailable(`${o.label()}.${k} is not available in this editor.`);
  }

  private setProp(o: Value, k: string, v: Value, e: Member | Index): void {
    this.here = e.pos;
    if (o === undefined || o === null) {
      const from = this.src(e.obj);
      this.throwError('TypeError', `Cannot set properties of ${String(o)} (setting '${k}')`, 'set-undefined', e.pos, `${from} is ${String(o)}, so it has no properties to set. Check where ${from} gets its value.`);
    }
    if (BLOCKED.has(k)) this.blocked(k, e);
    if (typeof o !== 'object') return;
    if (o instanceof HostObject) {
      if (o.allow.set?.includes(k)) o.set(k, v, this);
      else if (!o.write?.(k, v, this)) this.notAvailable(`Setting ${o.label()}.${k} is not available in this editor.`);
      return;
    }
    if (o instanceof JsArray) {
      if (k === 'length') {
        const n = this.num(v);
        if (n >>> 0 !== n) this.fail('RangeError', 'Invalid array length', 'bad-length');
        o.items.length = n;
        return;
      }
      const i = arrayIndex(k);
      if (i >= 0) o.items[i] = v;
      else o.props.set(k, v);
      return;
    }
    if (o instanceof JsNamespace || o instanceof JsNative) this.notAvailable(`Changing ${o.name} is not available in this editor.`);
    o.props.set(k, v);
  }

  // --- calls ---

  private evCall(e: Call, s: Scope): Value {
    this.tick();
    const c = e.callee;
    let self: Value;
    let f: Value;
    let key: string | undefined;
    if (c.k === 'member' || c.k === 'index') {
      self = this.ev(c.obj, s);
      key = c.k === 'member' ? c.name : this.key(this.ev(c.key, s));
      f = this.getProp(self, key, c);
    } else f = this.ev(c, s);
    const args: Value[] = new Array(e.args.length);
    for (let i = 0; i < e.args.length; i++) args[i] = this.ev(e.args[i], s);
    if (!isCallable(f)) this.notFunction(e, f, self, key);
    this.here = e.pos;
    if (f instanceof JsNative) {
      this.seenCalls.add(`${e.pos.file}:${e.off}`);
      return f.run(self, args, this);
    }
    return this.callFunction(f, args, e.pos);
  }

  private notFunction(e: Call, f: Value, self: Value, key: string | undefined): never {
    const callee = printed(e.callee);
    const members = typeof self === 'string' ? ['length', ...STRING_METHODS.keys()] : self instanceof JsArray ? ['length', ...ARRAY_METHODS.keys()] : self instanceof JsNamespace ? [...self.props.keys()] : self instanceof JsObject ? [...self.props.keys()] : typeof self === 'number' ? [...NUMBER_METHODS.keys()] : undefined;
    const help = notFunctionHelp({ callee: this.src(e.callee), name: key, kind: receiver(self), value: shownText(f), members, isProperty: key !== undefined });
    this.throwError('TypeError', `${callee} is not a function`, 'not-a-function', e.callee.pos, help);
  }

  call(f: Value, self: Value, args: Value[]): Value {
    void self;
    if (f instanceof JsNative) return f.run(undefined, args, this);
    if (f instanceof JsFunction) return this.callFunction(f, args, this.here);
    this.fail('TypeError', `${shownText(f)} is not a function`, 'not-a-function');
  }

  private callFunction(f: JsFunction, args: Value[], at: Pos): Value {
    this.tick();
    this.userCalls++;
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      this.throwError('RangeError', 'Maximum call stack size exceeded', 'stack', at, 'Your function keeps calling itself and never stops. A function that calls itself needs an if statement that ends the calls.');
    }
    const { fn } = f;
    let scope = new Scope(f.scope, f.name || 'anonymous function');
    if (fn.selfName) {
      scope.vars.set(fn.name!, { v: f, kind: 'self' });
      scope = new Scope(scope, f.name);
    }
    const params = fn.params;
    if (fn.defaults) {
      for (const p of params) scope.vars.set(p.name, { v: undefined, kind: 'param', tdz: true });
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        const v = args[i] === undefined && p.init ? this.named(p.init, p.name, scope) : args[i];
        const b = scope.vars.get(p.name)!;
        b.v = v;
        b.tdz = false;
      }
    } else for (let i = 0; i < params.length; i++) scope.vars.set(params[i].name, { v: args[i], kind: 'param' });

    let frame: Frame | undefined;
    if (this.trace) {
      frame = { id: this.nextFrame++, name: f.name || 'the function', scope };
      this.frames.push(frame);
      const list = params.map((p) => `${p.name} = ${shownText(scope.vars.get(p.name)!.v)}`).join(', ');
      this.step(fn.pos, `Calling ${frame.name}${list ? ` with ${list}` : ''}.`, scope);
    } else this.frames.push(NO_FRAME);
    try {
      if (fn.body.k !== 'block') {
        const v = this.ev(fn.body as Expr, scope);
        if (this.trace) this.step(fn.body.pos, `${frame!.name} returns ${shownText(v)}.`, scope);
        return v;
      }
      const body = fn.body;
      let inner = scope;
      if (fn.defaults) inner = new Scope(scope);
      for (const name of fn.vars) {
        if (inner.vars.has(name)) continue;
        const outer = scope.vars.get(name);
        inner.vars.set(name, { v: outer?.v, kind: 'var' });
      }
      this.declareLexical(body, inner);
      this.ret = undefined;
      const d = this.execList(body.body, inner);
      return d === Done.Return ? this.ret : undefined;
    } finally {
      this.depth--;
      this.frames.pop();
    }
  }

  // --- the step-through ---

  private step(pos: Pos, say: string, s: Scope, end?: TraceStep['end']): void {
    if (!this.trace) return;
    if (this.trace.length >= this.maxTrace - 1 && !end) throw new Stop({ cut: true });
    this.pushStep(pos, say, s, end);
  }

  private pushStep(pos: Pos, say: string, s: Scope, end?: TraceStep['end']): void {
    this.frames[this.frames.length - 1].scope = s;
    this.trace!.push({ file: pos.file, line: pos.line, say, frames: this.snapshot(), out: this.lines.length, ...(end ? { end } : {}) });
  }

  private snapshot(): TraceFrame[] {
    const out: TraceFrame[] = [];
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      out.push({ name: f.name, vars: this.frameVars(f) });
    }
    return out;
  }

  private frameVars(f: Frame): TraceVar[] {
    const scopes: Scope[] = [];
    for (let c: Scope | null = f.scope; c && c !== this.builtins; c = c.parent) {
      scopes.unshift(c);
      if (c.fnLabel) break;
    }
    const seen = new Map<string, TraceVar>();
    for (const c of scopes) {
      for (const [name, b] of c.vars) {
        seen.delete(name);
        if (b.tdz || b.kind === 'fn' || b.kind === 'self') continue;
        seen.set(name, this.traceVar(f.id, name, b.v));
      }
    }
    return [...seen.values()];
  }

  private traceVar(frame: number, name: string, v: Value): TraceVar {
    const key = `${frame}/${name}`;
    const text = shownText(v);
    const was = this.lastSeen.get(key);
    const out: TraceVar = { name, text };
    if (!was || was.text !== text) out.changed = true;
    let texts: string[] | undefined;
    if (v instanceof JsArray) {
      const shown = v.items.slice(0, MAX_TRACE_ITEMS);
      const items: TraceItem[] = [];
      texts = [];
      for (let i = 0; i < shown.length; i++) {
        const hole = !(i in shown);
        const t = hole ? 'empty' : shownText(shown[i]);
        texts.push(t);
        const item: TraceItem = { text: t };
        if (hole) item.hole = true;
        if (was && was.items?.[i] !== t) item.changed = true;
        items.push(item);
      }
      out.items = items;
      if (v.items.length > shown.length) out.more = v.items.length - shown.length;
    }
    this.lastSeen.set(key, { text, ...(texts ? { items: texts } : {}) });
    return out;
  }

  private sayTest(n: Expr, v: Value, then: string): string {
    const text = this.src(n);
    if (typeof v === 'boolean') return `${text} is ${v}${then}`;
    return `${text} is ${shownText(v)}, which counts as ${!!v}${then}`;
  }

  private sayExpr(e: Expr, v: Value): string {
    if (e.k === 'assign' || e.k === 'update') {
      const shown = e.k === 'update' ? (this.peekTarget(e.target) ?? v) : v;
      return `${this.src(e.target)} is now ${shownText(shown)}.`;
    }
    if (e.k === 'call') return `${this.src(e.callee)} ran.`;
    return 'This line ran.';
  }

  private peekTarget(t: Expr): Value {
    return pureRead(t) ? peek(t, this.frames[this.frames.length - 1].scope) : undefined;
  }
}

const NO_FRAME: Frame = { id: -1, name: '', scope: new Scope(null) };

function typeOf(v: Value): string {
  if (v === null) return 'object';
  if (isCallable(v)) return 'function';
  if (v instanceof JsObject || v instanceof HostObject) return 'object';
  return typeof v;
}

function receiver(v: Value): Receiver | undefined {
  if (v === undefined) return undefined;
  if (v === null) return 'null';
  if (v instanceof JsArray) return 'array';
  if (isCallable(v)) return 'function';
  if (v instanceof JsObject) return 'object';
  if (v instanceof HostObject) return 'object';
  return typeof v as Receiver;
}

function valueWord(v: Value): string {
  if (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) >= 1000) return (v < 0 ? '-' : '') + commas(Math.abs(v));
  return shownText(v);
}

/** The browser's own stack ran out. Very deep student code can do this, and it must never escape as a crash. */
export function isStackOverflow(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { name, message } = e as Error;
  return (name === 'RangeError' && /call stack/i.test(message)) || name === 'InternalError';
}

/** Plain help for errors the library raises. */
function helpFor(code: string): string | undefined {
  switch (code) {
    case 'bad-count':
      return 'repeat needs a count of 0 or more, and the count has to be a finite number.';
    case 'bad-digits':
      return 'toFixed needs a number of decimal places from 0 to 100.';
    case 'bad-radix':
      return 'toString on a number needs a base from 2 to 36. Use 2 for binary and 16 for hexadecimal.';
    case 'bad-length':
      return 'An array length has to be a whole number that is 0 or more.';
    case 'reduce-empty':
      return 'reduce on an empty array has no first value to start from. Give reduce a starting value as its second argument.';
    case 'bad-sort':
      return 'sort takes a function that compares two values, or nothing at all.';
    case 'not-a-function':
      return 'This method needs a function as its argument, such as (x) => x * 2.';
    case 'to-primitive':
      return 'This object could not be turned into a number or a string.';
    default:
      return undefined;
  }
}

/** Runs parsed files, in order, sharing one set of globals. */
export function runProgram(programs: Program[], options: RunOptions = {}): RunResult {
  return new Interp(programs, options).run();
}
