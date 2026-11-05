import type { BinMode, Block, Expr, Stmt } from './ast';
import type { Program } from './check';
import { doubleStr, longStr } from './format';
import { LIB, type Rt } from './lib';
import { isPrimitive, STRING, type JType, type MethodInfo, type UserClass } from './types';
import { excName, JArr, JBox, JExc, JList, JObj, JStr, Thrown, type StackLine } from './values';

export interface RunOptions {
  /** Statements to run before giving up on a loop that never ends. */
  maxSteps?: number;
  maxOutput?: number;
  /** Record a step-by-step trace for the step-through view. */
  trace?: boolean;
  maxTrace?: number;
  /** Seed for Math.random(), so a run can be replayed exactly. */
  seed?: number;
  /** The class whose main to run. Default: the first class that has one. */
  mainClass?: string;
}

/** A value as the step-through draws it. */
export type Shown = { t: 'value'; text: string } | { t: 'ref'; id: number } | { t: 'null' };

export interface TraceVar {
  name: string;
  value: Shown;
}

/** Where a value lives in the step-through's picture. */
export type Slot = { frame: number; name: string } | { obj: number; name: string };

/** One thing the marked line does, in order. The step-through plays them on a loop. */
export type Beat =
  /** An expression worked out: its source, then values in place of names, then the result. */
  | { k: 'eval'; steps: string[]; reads: Slot[] }
  /** `hides`: the name here is a local, and the current object has an instance variable called the same thing. */
  | { k: 'write'; name: string; to?: Slot; value: Shown; declares?: boolean; hides?: { kind: 'parameter' | 'local variable'; obj: number } }
  | { k: 'new'; id: number; cls: string }
  | { k: 'call'; name: string; text: string; frame: number; args: TraceVar[]; ctor: boolean }
  | { k: 'return'; name: string; frame: number; value?: Shown; ctor: boolean }
  | { k: 'branch'; kind: 'if' | 'loop' | 'each'; taken: boolean; hasElse?: boolean }
  | { k: 'jump'; word: 'break' | 'continue' }
  | { k: 'print'; text: string };

export interface TraceFrame {
  /** Tells apart two calls of one method. */
  id: number;
  /** "main" or "Player.takeDamage". */
  label: string;
  vars: TraceVar[];
}

export interface TraceObject {
  id: number;
  label: string;
  fields: TraceVar[];
}

/** The program just before one line runs. */
export interface TraceStep {
  file: string;
  line: number;
  frames: TraceFrame[];
  objects: TraceObject[];
  /** How much of the output existed at this point. */
  outLen: number;
  /** What running this line does, up to the next step. */
  beats: Beat[];
}

export interface RunResult {
  output: string;
  status: 'ok' | 'exception' | 'limit' | 'no-main';
  exception?: { type: string; short: string; message: string | null; at: StackLine[] };
  limit?: 'steps' | 'output';
  trace?: TraceStep[];
  /** The trace stopped early. */
  traceCut?: boolean;
}

class Halt {
  constructor(readonly why: 'steps' | 'output' | 'exit') {}
}

interface Frame {
  id: number;
  m: MethodInfo | null;
  label: string;
  cls: string;
  self: JObj | null;
  slots: unknown[];
  names: string[];
  types?: string[];
  file: string;
  line: number;
}

const NORMAL = 0;
const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;

const MAX_DEPTH = 800;

const toInt = (d: number) => (Number.isNaN(d) ? 0 : d >= 2147483647 ? 2147483647 : d <= -2147483648 ? -2147483648 : Math.trunc(d));
const toLong = (d: number) => (Number.isNaN(d) ? 0 : Math.trunc(d));
/** How tightly each operator binds, so an expression prints with the parentheses it needs. */
const PREC: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '>>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };

function precOf(e: Expr): number {
  if (e.k === 'binary') return PREC[e.op] ?? 11;
  if (e.k === 'instanceof') return 7;
  if (e.k === 'cond') return 0;
  if (e.k === 'unary' || e.k === 'cast') return 12;
  return e.k === 'conv' ? precOf(e.e) : 14;
}

/** An expression about to run, as text. */
interface Peek {
  src: string;
  sub: string;
  reads: Slot[];
}

/** Reads and writes one variable. */
interface Place {
  get: () => unknown;
  set: (v: unknown) => void;
  slot?: Slot;
}

const hashHex = (id: number) => (Math.imul(id + 1, 0x9e3779b1) >>> 0).toString(16);

function defaultOf(t: JType): unknown {
  switch (t.k) {
    case 'int':
    case 'long':
    case 'double':
    case 'char':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

class Interp implements Rt {
  out: string[] = [];
  outLen = 0;
  steps = 0;
  nextId = 1;
  stack: Frame[] = [];
  statics = new Map<string, unknown>();
  literals = new Map<string, JStr>();
  boxes = new Map<number, JBox>();
  ret: unknown = undefined;
  seed: number;
  maxSteps: number;
  maxOutput: number;
  tracing: boolean;
  maxTrace: number;
  trace: TraceStep[] = [];
  traceCut = false;
  beats: Beat[] = [];
  frames = 0;

  constructor(
    private p: Program,
    opts: RunOptions,
  ) {
    this.seed = (opts.seed ?? 1) >>> 0;
    this.maxSteps = opts.maxSteps ?? 1_000_000;
    this.maxOutput = opts.maxOutput ?? 20_000;
    this.tracing = !!opts.trace;
    this.maxTrace = opts.maxTrace ?? 500;
  }

  // --- what library code uses ---

  str(s: string): JStr {
    return new JStr(s);
  }

  random(): number {
    // mulberry32
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  print(s: string): void {
    this.beat({ k: 'print', text: s });
    this.out.push(s);
    this.outLen += s.length;
    if (this.outLen > this.maxOutput) throw new Halt('output');
  }

  exit(): never {
    throw new Halt('exit');
  }

  newArray(elem: JType, items: unknown[]): JArr {
    return new JArr(elem, items, this.nextId++);
  }

  newList(): JList {
    return new JList(this.nextId++);
  }

  private stackLines(): StackLine[] {
    const out: StackLine[] = [];
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const f = this.stack[i];
      out.push({ cls: f.cls, method: f.m ? (f.m.decl.ret ? f.m.name : '<init>') : '<init>', file: f.file, line: f.line });
    }
    return out;
  }

  fail(cls: string, msg: string | null): never {
    throw new Thrown(new JExc(cls, msg, this.stackLines(), this.nextId++));
  }

  npe(what: string): never {
    this.fail('NullPointerException', what);
  }

  /** Any value as text: what String.valueOf gives. */
  text(v: unknown): string {
    if (v === null || v === undefined) return 'null';
    if (v instanceof JStr) return v.v;
    if (v instanceof JObj) {
      const m = this.p.classes.get(v.cls)?.methods.get('toString')?.find((x) => !x.params.length);
      if (m) {
        const r = this.call(m, v, []);
        return r === null ? 'null' : (r as JStr).v;
      }
      return `${v.cls}@${hashHex(v.id)}`;
    }
    if (v instanceof JBox) {
      if (v.box === 'Integer' || v.box === 'Long') return longStr(v.v as number);
      if (v.box === 'Double') return doubleStr(v.v as number);
      if (v.box === 'Character') return String.fromCharCode(v.v as number);
      return String(v.v);
    }
    if (v instanceof JList) return `[${v.items.map((x) => (x === v ? '(this Collection)' : this.text(x))).join(', ')}]`;
    if (v instanceof JArr) return `${this.arrCode(v.elem)}@${hashHex(v.id)}`;
    if (v instanceof JExc) return v.msg === null ? excName(v.cls) : `${excName(v.cls)}: ${v.msg}`;
    return String(v);
  }

  private arrCode(t: JType): string {
    switch (t.k) {
      case 'int':
        return '[I';
      case 'double':
        return '[D';
      case 'boolean':
        return '[Z';
      case 'char':
        return '[C';
      case 'long':
        return '[J';
      case 'array':
        return `[${this.arrCode(t.of)}`;
      case 'class':
        return `[L${t.name === 'String' ? 'java.lang.String' : t.name};`;
      default:
        return '[';
    }
  }

  show(v: unknown, t: JType): string {
    switch (t.k) {
      case 'int':
      case 'long':
        return longStr(v as number);
      case 'double':
        return doubleStr(v as number);
      case 'char':
        return String.fromCharCode(v as number);
      case 'boolean':
        return String(v);
      default:
        return this.text(v);
    }
  }

  equals(a: unknown, b: unknown): boolean {
    if (a === null) return b === null;
    if (a instanceof JStr) return b instanceof JStr && a.v === b.v;
    if (a instanceof JBox) return b instanceof JBox && a.box === b.box && a.v === b.v;
    if (a instanceof JList) return b instanceof JList && a.items.length === b.items.length && a.items.every((x, i) => this.equals(x, b.items[i]));
    if (a instanceof JObj) {
      const m = this.p.classes.get(a.cls)?.methods.get('equals')?.find((x) => x.params.length === 1 && x.params[0].k === 'class' && x.params[0].name === 'Object');
      if (m) return this.call(m, a, [b]) as boolean;
    }
    return a === b;
  }

  hash(v: unknown): number {
    if (v instanceof JStr) {
      let h = 0;
      for (let i = 0; i < v.v.length; i++) h = (Math.imul(h, 31) + v.v.charCodeAt(i)) | 0;
      return h;
    }
    if (v instanceof JBox) return typeof v.v === 'number' ? v.v | 0 : v.v ? 1231 : 1237;
    if (v instanceof JObj) {
      const m = this.p.classes.get(v.cls)?.methods.get('hashCode')?.find((x) => !x.params.length);
      if (m) return this.call(m, v, []) as number;
      return Math.imul(v.id + 1, 0x9e3779b1) >>> 1;
    }
    if (v instanceof JList) return v.items.reduce<number>((h, x) => (Math.imul(h, 31) + (x === null ? 0 : this.hash(x))) | 0, 1);
    return 0;
  }

  // --- running ---

  private boxed(box: string, v: number | boolean): JBox {
    // Java keeps one Integer object for each small value.
    if (box === 'Integer' && (v as number) >= -128 && (v as number) <= 127) {
      let b = this.boxes.get(v as number);
      if (!b) this.boxes.set(v as number, (b = new JBox(box, v)));
      return b;
    }
    return new JBox(box, v);
  }

  private tick(file: string, line: number): void {
    const f = this.stack[this.stack.length - 1];
    f.line = line;
    f.file = file;
    if (++this.steps > this.maxSteps) throw new Halt('steps');
    if (this.tracing) this.record(file, line);
  }

  private shown(v: unknown, t: JType | undefined): Shown {
    if (v === null) return { t: 'null' };
    if (v instanceof JObj || v instanceof JArr || v instanceof JList) return { t: 'ref', id: v.id };
    if (v instanceof JStr) return { t: 'value', text: JSON.stringify(v.v) };
    if (v instanceof JBox) return { t: 'value', text: this.text(v) };
    if (v instanceof JExc) return { t: 'value', text: v.cls };
    if (t?.k === 'char') return { t: 'value', text: `'${String.fromCharCode(v as number)}'` };
    if (t) return { t: 'value', text: this.show(v, t) };
    return { t: 'value', text: String(v) };
  }

  private typeOfSlot(f: Frame, i: number): JType | undefined {
    return f.m?.params[i] ?? this.slotTypes.get(f.m?.decl.slotNames ?? f.names)?.[i];
  }

  /** The type of each local, read from the method's body once. */
  private slotTypes = new Map<string[], JType[]>();

  private learnSlots(names: string[], body: Block): void {
    if (this.slotTypes.has(names)) return;
    const types: JType[] = [];
    const walk = (s: Stmt): void => {
      switch (s.k) {
        case 'block':
          s.body.forEach(walk);
          break;
        case 'local':
          for (const v of s.vars) if (v.slot !== undefined && v.ty) types[v.slot] = v.ty;
          break;
        case 'if':
          walk(s.a);
          if (s.b) walk(s.b);
          break;
        case 'while':
        case 'do':
          walk(s.body);
          break;
        case 'for':
          s.init.forEach(walk);
          walk(s.body);
          break;
        case 'foreach':
          if (s.slot !== undefined) types[s.slot] = { k: 'class', name: s.type.name, args: [] };
          if (s.slot !== undefined && ['int', 'double', 'boolean', 'char', 'long'].includes(s.type.name) && !s.type.dims) types[s.slot] = { k: s.type.name } as JType;
          walk(s.body);
          break;
      }
    };
    walk(body);
    this.slotTypes.set(names, types);
  }

  private record(file: string, line: number): void {
    if (this.trace.length >= this.maxTrace) {
      this.traceCut = true;
      this.tracing = false;
      return;
    }
    const seen = new Map<number, unknown>();
    const visit = (v: unknown) => {
      if ((v instanceof JObj || v instanceof JArr || v instanceof JList) && !seen.has(v.id)) {
        seen.set(v.id, v);
        if (v instanceof JObj) Object.values(v.fields).forEach(visit);
        else v.items.forEach(visit);
      }
    };
    // main's args is always an empty array here, and only clutters the picture.
    const shownSlot = (f: Frame, i: number) => f.slots[i] !== undefined && !(f.label === 'main' && f.names[i] === 'args');
    for (const f of this.stack) {
      visit(f.self);
      f.slots.forEach((v, i) => shownSlot(f, i) && visit(v));
    }
    const objects: TraceObject[] = [...seen.values()]
      .map((v): TraceObject => {
        if (v instanceof JObj) {
          const c = this.p.classes.get(v.cls)!;
          return {
            id: v.id,
            label: v.cls,
            fields: [...c.fields.values()].filter((f) => !f.isStatic).map((f) => ({ name: f.name, value: this.shown(v.fields[f.name], f.type) })),
          };
        }
        if (v instanceof JArr) return { id: v.id, label: `${this.typeLabel(v.elem)}[${v.items.length}]`, fields: v.items.map((x, i) => ({ name: String(i), value: this.shown(x, v.elem) })) };
        const l = v as JList;
        return { id: l.id, label: `ArrayList (size ${l.items.length})`, fields: l.items.map((x, i) => ({ name: String(i), value: this.shown(x, undefined) })) };
      })
      .sort((a, b) => a.id - b.id);
    const frames: TraceFrame[] = this.stack.map((f) => ({
      id: f.id,
      label: f.label,
      vars: [
        ...(f.self ? [{ name: 'this', value: { t: 'ref', id: f.self.id } as Shown }] : []),
        ...f.names.flatMap((name, i) => (shownSlot(f, i) ? [{ name, value: this.shown(f.slots[i], this.typeOfSlot(f, i)) }] : [])),
      ],
    }));
    this.closeStep();
    this.trace.push({ file, line, frames, objects, outLen: this.outLen, beats: [] });
  }

  /** Whatever happened since the last step is what that step's line did. */
  closeStep(): void {
    if (this.trace.length) this.trace[this.trace.length - 1].beats = this.beats;
    this.beats = [];
  }

  private typeLabel(t: JType): string {
    return t.k === 'class' ? t.name : t.k === 'array' ? `${this.typeLabel(t.of)}[]` : t.k;
  }

  private beat(b: Beat): void {
    if (this.tracing) this.beats.push(b);
  }

  /** A value as text, the way the step-through labels it. Never calls the student's toString. */
  private label(v: unknown, t: JType | undefined): string {
    if (v instanceof JObj) return `${v.cls} #${v.id}`;
    if (v instanceof JArr) return `${this.typeLabel(v.elem)}[${v.items.length}] #${v.id}`;
    if (v instanceof JList) return `ArrayList #${v.id}`;
    if (v === null) return 'null';
    const s = this.shown(v, t);
    return s.t === 'value' ? s.text : 'a value';
  }

  /** True when an expression can be shown before it runs: it enters no method and changes nothing. */
  private plain(e: Expr): boolean {
    switch (e.k) {
      case 'lit':
      case 'name':
      case 'this':
        return true;
      case 'field':
        return this.plain(e.target);
      case 'index':
        return this.plain(e.target) && this.plain(e.index);
      case 'unary':
      case 'conv':
      case 'cast':
      case 'instanceof':
        return this.plain(e.e);
      case 'binary':
        return this.plain(e.a) && this.plain(e.b);
      case 'cond':
        return this.plain(e.c) && this.plain(e.a) && this.plain(e.b);
      case 'call':
        return !!e.lib && (!e.target || this.plain(e.target)) && e.args.every((a) => this.plain(a));
      default:
        return false;
    }
  }

  /** What a name, `this`, or `a.b` holds right now, without running anything. */
  private held(e: Expr): unknown {
    const f = this.stack[this.stack.length - 1];
    if (e.k === 'this') return f.self;
    if (e.k === 'name' && e.ref?.to === 'local') return f.slots[e.ref.slot];
    if (e.k === 'name' && e.ref?.to === 'field') return f.self?.fields[e.name];
    if (e.k === 'name' && e.ref?.to === 'static') return this.statics.get(`${e.ref.f.owner}.${e.ref.f.name}`);
    if (e.k === 'field' && e.ref?.to === 'field') {
      const o = this.held(e.target);
      return o instanceof JObj ? o.fields[e.name] : undefined;
    }
    return undefined;
  }

  /** Where a name or `a.b` lives, so the picture can light it up. */
  private slotOf(e: Expr): Slot | undefined {
    const f = this.stack[this.stack.length - 1];
    if (e.k === 'name' && e.ref?.to === 'local') return { frame: f.id, name: e.name };
    if (e.k === 'name' && e.ref?.to === 'field' && f.self) return { obj: f.self.id, name: e.name };
    if (e.k === 'field' && e.ref?.to === 'field') {
      const o = this.held(e.target);
      if (o instanceof JObj) return { obj: o.id, name: e.name };
    }
    return undefined;
  }

  /** An expression as source text, or with `sub` as values in place of names. */
  private exprText(e: Expr, sub: boolean, reads: Slot[]): string {
    const go = (x: Expr) => this.exprText(x, sub, reads);
    const inner = (x: Expr, p: number, right = false) => {
      const q = precOf(x);
      return q < p || (right && q === p) ? `(${go(x)})` : go(x);
    };
    switch (e.k) {
      case 'lit':
        if (e.lit === 'string') return JSON.stringify(e.value);
        if (e.lit === 'char') return `'${typeof e.value === 'number' ? String.fromCharCode(e.value) : e.value}'`;
        return e.lit === 'double' ? this.show(e.value, { k: 'double' }) : String(e.value);
      case 'this':
        return 'this';
      case 'name':
      case 'field': {
        const v = sub ? this.held(e) : undefined;
        if (v !== undefined) {
          const at = this.slotOf(e);
          if (at) reads.push(at);
          return this.label(v, e.ty);
        }
        return e.k === 'name' ? e.name : `${go(e.target)}.${e.name}`;
      }
      case 'index':
        return `${inner(e.target, 14)}[${go(e.index)}]`;
      case 'unary':
        return `${e.op}${inner(e.e, 12)}`;
      case 'conv':
        return go(e.e);
      case 'cast':
        return `(${e.type.name}) ${inner(e.e, 12)}`;
      case 'instanceof':
        return `${inner(e.e, 7)} instanceof ${e.type.name}`;
      case 'binary': {
        const p = PREC[e.op] ?? 11;
        return `${inner(e.a, p)} ${e.op} ${inner(e.b, p, true)}`;
      }
      case 'cond':
        return `${inner(e.c, 1)} ? ${go(e.a)} : ${go(e.b)}`;
      case 'call':
        return `${e.target ? `${inner(e.target, 14)}.` : ''}${e.name}(${e.args.map(go).join(', ')})`;
      default:
        return '...';
    }
  }

  private peek(e: Expr): Peek | undefined {
    if (!this.tracing || !this.plain(e)) return undefined;
    const reads: Slot[] = [];
    return { src: this.exprText(e, false, reads), sub: this.exprText(e, true, reads), reads };
  }

  /** Adds the result to what `peek` saw, dropping steps that read the same. */
  private evaluated(p: Peek | undefined, v: unknown, t: JType | undefined): void {
    if (!p) return;
    this.beat({ k: 'eval', steps: [...new Set([p.src, p.sub, this.label(v, t)])], reads: p.reads });
  }

  private wrote(target: Expr, p: Peek | undefined, at: Place, v: unknown): void {
    if (!this.tracing) return;
    const t = target.ty;
    this.evaluated(p, v, t);
    const f = this.stack[this.stack.length - 1];
    const local = target.k === 'name' && target.ref?.to === 'local' ? target.ref.slot : undefined;
    const hides = local !== undefined && target.k === 'name' && f.self && target.name in f.self.fields ? { kind: local < (f.m?.params.length ?? 0) ? ('parameter' as const) : ('local variable' as const), obj: f.self.id } : undefined;
    this.beat({ k: 'write', name: this.exprText(target, false, []), to: at.slot, value: this.shown(v, t), ...(hides && { hides }) });
  }

  private enter(m: MethodInfo | null, cls: string, self: JObj | null, args: unknown[], label: string): Frame {
    if (this.stack.length >= MAX_DEPTH) this.fail('StackOverflowError', null);
    const names = m?.decl.slotNames ?? [];
    const slots = new Array<unknown>(names.length).fill(undefined);
    for (let i = 0; i < args.length; i++) slots[i] = args[i];
    const f: Frame = { id: ++this.frames, m, label, cls, self, slots, names, file: this.p.classes.get(cls)?.decl.file ?? '', line: m?.decl.pos.line ?? 0 };
    if (m && this.tracing) this.learnSlots(names, m.decl.body);
    this.stack.push(f);
    return f;
  }

  /** The values going in, with `this` first, for the step-through. */
  private entering(f: Frame, name: string, text: string, m: MethodInfo, args: unknown[], ctor: boolean): void {
    if (!this.tracing) return;
    const vars: TraceVar[] = args.map((v, i) => ({ name: f.names[i], value: this.shown(v, m.params[i]) }));
    if (f.self) vars.unshift({ name: 'this', value: { t: 'ref', id: f.self.id } });
    this.beat({ k: 'call', name, text, frame: f.id, args: vars, ctor });
  }

  /** `via`: how the code named the object, for the step-through: `ada`. */
  call(m: MethodInfo, self: JObj | null, args: unknown[], via?: string): unknown {
    const f = this.enter(m, m.owner, self, args, m.isStatic ? m.name : `${m.owner}.${m.name}`);
    if (this.tracing) this.entering(f, m.name, `${via ? `${via}.` : ''}${m.name}(${args.map((a, i) => this.label(a, m.params[i])).join(', ')})`, m, args, false);
    try {
      const sig = this.block(m.decl.body, 0, true);
      if (sig !== RETURN) {
        this.tick(m.decl.body.endPos.file, m.decl.body.endPos.line);
        this.beat({ k: 'return', name: m.name, frame: f.id, ctor: false });
        return undefined;
      }
      const v = this.ret;
      this.ret = undefined;
      if (this.tracing) this.beat({ k: 'return', name: m.name, frame: f.id, value: m.ret.k === 'void' ? undefined : this.shown(v, m.ret), ctor: false });
      return v;
    } finally {
      this.stack.pop();
    }
  }

  private construct(cls: string, m: MethodInfo | undefined, args: unknown[]): JObj {
    const c = this.p.classes.get(cls) as UserClass;
    const o = new JObj(cls, this.nextId++);
    for (const f of c.fields.values()) if (!f.isStatic) o.fields[f.name] = defaultOf(f.type);
    this.beat({ k: 'new', id: o.id, cls });
    this.runCtor(c, o, m, args);
    return o;
  }

  private runCtor(c: UserClass, o: JObj, m: MethodInfo | undefined, args: unknown[]): void {
    const f = this.enter(m ?? null, c.name, o, args, `${c.name} constructor`);
    if (this.tracing && m) this.entering(f, c.name, `new ${c.name}(${args.map((a, i) => this.label(a, m.params[i])).join(', ')})`, m, args, true);
    try {
      const first = m?.decl.body.body[0];
      // this(...) hands off to another constructor, which runs the field initializers.
      if (first?.k === 'ctorcall' && first.which === 'this') {
        this.tick(first.pos.file, first.pos.line);
        const a = first.args.map((x) => this.eval(x));
        this.runCtor(c, o, first.m, a);
      } else {
        for (const f of c.fields.values()) {
          if (f.isStatic || !f.decl.init) continue;
          this.tick(f.decl.pos.file, f.decl.pos.line);
          o.fields[f.name] = this.eval(f.decl.init);
        }
      }
      if (m) {
        const sig = this.block(m.decl.body, first?.k === 'ctorcall' ? 1 : 0, true);
        if (sig !== RETURN) this.tick(m.decl.body.endPos.file, m.decl.body.endPos.line);
        this.ret = undefined;
      }
      this.beat({ k: 'return', name: c.name, frame: f.id, value: { t: 'ref', id: o.id }, ctor: true });
    } finally {
      this.stack.pop();
    }
  }

  /** `method`: this is a whole method's body. Its variables last until its closing brace, which is a step of its own. */
  private block(b: Block, skip = 0, method = false): number {
    for (let i = skip; i < b.body.length; i++) {
      const sig = this.stmt(b.body[i]);
      if (sig !== NORMAL) return sig;
    }
    if (this.tracing && !method && b.from !== undefined) {
      // Variables declared in this block go away when it ends.
      const f = this.stack[this.stack.length - 1];
      for (let i = b.from; i < (b.to ?? b.from); i++) f.slots[i] = undefined;
    }
    return NORMAL;
  }

  private loopBody(s: Stmt): number {
    const sig = this.stmt(s);
    return sig;
  }

  /** `sameStep`: part of a line that is already a step, as a for loop's first clause is. */
  private stmt(s: Stmt, sameStep = false): number {
    if (s.k === 'block') return this.block(s);
    if (s.k === 'empty') return NORMAL;
    if (!sameStep) this.tick(s.pos.file, s.pos.line);
    const f = this.stack[this.stack.length - 1];
    switch (s.k) {
      case 'local':
        for (const v of s.vars) {
          if (!v.init) continue;
          const p = this.peek(v.init);
          const value = this.valueOf(v.init);
          f.slots[v.slot!] = value;
          if (this.tracing) {
            const t = v.ty ?? v.init.ty;
            this.evaluated(p, value, t);
            this.beat({ k: 'write', name: v.name, to: { frame: f.id, name: v.name }, value: this.shown(value, t), declares: true });
          }
        }
        return NORMAL;
      case 'expr': {
        // A call into the library, like list.add(x), has nothing else to show.
        const p = s.e.k === 'call' && s.e.lib && !['print', 'println', 'printf'].includes(s.e.name) ? this.peek(s.e) : undefined;
        this.eval(s.e);
        if (p) this.beat({ k: 'eval', steps: [...new Set([p.src, p.sub])], reads: p.reads });
        return NORMAL;
      }
      case 'if': {
        const taken = this.test(s.c, 'if', !!s.b);
        if (taken) return this.stmt(s.a);
        return s.b ? this.stmt(s.b) : NORMAL;
      }
      case 'while':
        while (this.test(s.c, 'loop')) {
          const sig = this.loopBody(s.body);
          if (sig === BREAK) break;
          if (sig === RETURN) return RETURN;
          if (this.tracing) this.record(s.pos.file, s.pos.line);
          this.bump();
        }
        return NORMAL;
      case 'do':
        for (;;) {
          const sig = this.loopBody(s.body);
          if (sig === BREAK) break;
          if (sig === RETURN) return RETURN;
          this.bump();
          if (!this.test(s.c, 'loop')) break;
        }
        return NORMAL;
      case 'for': {
        for (const i of s.init) this.stmt(i, true);
        while (!s.c || this.test(s.c, 'loop')) {
          const sig = this.loopBody(s.body);
          if (sig === BREAK) break;
          if (sig === RETURN) return RETURN;
          if (this.tracing) this.record(s.pos.file, s.pos.line);
          for (const u of s.update) this.eval(u);
          this.bump();
        }
        if (this.tracing && s.from !== undefined) for (let i = s.from; i < (s.to ?? s.from); i++) f.slots[i] = undefined;
        return NORMAL;
      }
      case 'foreach': {
        const it = this.eval(s.iter);
        if (it === null) this.npe(`Cannot ${s.iter.ty?.k === 'array' ? 'read the array length' : `invoke "${this.jvmType(s.iter.ty!)}.iterator()"`}${this.because(s.iter)}`);
        const list = it as JArr | JList;
        const mods = list instanceof JList ? list.mods : 0;
        for (let i = 0; i !== list.items.length; i++) {
          if (list instanceof JList && list.mods !== mods) {
            f.line = s.pos.line;
            this.fail('ConcurrentModificationException', null);
          }
          let v = list.items[i];
          if (s.unbox) {
            if (v === null) this.npe('Cannot read a value from the list because it is null');
            v = (v as JBox).v;
          } else if (s.box) v = this.boxed(s.box, v as number | boolean);
          f.slots[s.slot!] = v;
          if (this.tracing) {
            this.beat({ k: 'branch', kind: 'each', taken: true });
            this.beat({ k: 'write', name: s.name, to: { frame: f.id, name: s.name }, value: this.shown(v, this.typeOfSlot(f, s.slot!)) });
          }
          const sig = this.loopBody(s.body);
          if (sig === BREAK) break;
          if (sig === RETURN) return RETURN;
          if (this.tracing) this.record(s.pos.file, s.pos.line);
          this.bump();
        }
        if (this.tracing) {
          this.beat({ k: 'branch', kind: 'each', taken: false });
          f.slots[s.slot!] = undefined;
        }
        return NORMAL;
      }
      case 'return': {
        const p = s.e && this.peek(s.e);
        this.ret = s.e ? this.valueOf(s.e) : undefined;
        this.evaluated(p, this.ret, s.e?.ty);
        return RETURN;
      }
      case 'break':
        this.beat({ k: 'jump', word: 'break' });
        return BREAK;
      case 'continue':
        this.beat({ k: 'jump', word: 'continue' });
        return CONTINUE;
      case 'throw': {
        const e = this.eval(s.e);
        if (e === null) this.npe('the exception to throw');
        throw new Thrown(e as JExc);
      }
      case 'ctorcall':
        return NORMAL;
    }
    return NORMAL;
  }

  /** A condition, for the step-through as well as the program. */
  private test(c: Expr, kind: 'if' | 'loop', hasElse?: boolean): boolean {
    const p = this.peek(c);
    const taken = this.eval(c) as boolean;
    if (this.tracing) {
      this.evaluated(p, taken, c.ty);
      this.beat({ k: 'branch', kind, taken, hasElse });
    }
    return taken;
  }

  private bump(): void {
    if (++this.steps > this.maxSteps) throw new Halt('steps');
  }

  /** An initializer, argument, or return value, which may be an array in braces. */
  private valueOf(e: Expr): unknown {
    return this.eval(e);
  }

  private makeArray(e: Expr & { k: 'arrayinit' }): JArr {
    const t = e.ty as JType & { k: 'array' };
    return this.newArray(t.of, e.items.map((x) => this.eval(x)));
  }

  private filled(t: JType & { k: 'array' }, sizes: number[], at: number): JArr {
    const n = sizes[at];
    if (n < 0) this.fail('NegativeArraySizeException', String(n));
    const items = new Array<unknown>(n);
    for (let i = 0; i < n; i++) items[i] = at + 1 < sizes.length ? this.filled(t.of as JType & { k: 'array' }, sizes, at + 1) : defaultOf(t.of);
    return this.newArray(t.of, items);
  }

  /** The Java source for where a value came from, as NullPointerException messages print it. */
  private path(e: Expr): string | null {
    switch (e.k) {
      case 'name': {
        const r = e.ref;
        if (r?.to === 'local') return e.name;
        if (r?.to === 'field') return `this.${e.name}`;
        return r?.to === 'static' ? `${r.f.owner}.${e.name}` : null;
      }
      case 'field': {
        if (e.ref?.to === 'static') return `${e.ref.f.owner}.${e.name}`;
        const t = this.path(e.target);
        return t && `${t}.${e.name}`;
      }
      case 'this':
        return 'this';
      case 'index': {
        const t = this.path(e.target);
        const i = e.index.k === 'lit' ? String(e.index.value) : (this.path(e.index) ?? '...');
        return t && `${t}[${i}]`;
      }
      case 'conv':
      case 'cast':
        return this.path(e.e);
      default:
        return null;
    }
  }

  private because(e: Expr): string {
    if (e.k === 'call') return ` because the return value of "${this.callSig(e)}" is null`;
    const p = this.path(e);
    return p ? ` because "${p}" is null` : '';
  }

  private jvmName(name: string): string {
    const l = LIB[name];
    if (!l || name === 'String' || name === 'Object') return name;
    return `${l.pkg ?? 'java.lang'}.${name}`;
  }

  private jvmType(t: JType): string {
    if (t.k === 'class') return t.name === 'E' ? 'Object' : this.jvmName(t.name);
    return t.k === 'array' ? `${this.jvmType(t.of)}[]` : t.k;
  }

  private callSig(e: Expr & { k: 'call' }): string {
    const m = e.user ?? e.lib!;
    const staticType = e.target?.ty?.k === 'class' ? e.target.ty.name : m.owner;
    const params = (e.lib?.erased ?? m.params).map((p) => this.jvmType(p)).join(', ');
    return `${this.jvmName(staticType)}.${m.name}(${params})`;
  }

  private arrayKind(a: Expr): string {
    const of = a.ty?.k === 'array' ? a.ty.of : undefined;
    if (of?.k === 'boolean') return 'byte/boolean';
    return of && isPrimitive(of) ? of.k : 'object';
  }

  private arith(op: string, mode: BinMode, a: number, b: number): number | boolean {
    switch (op) {
      case '<':
        return a < b;
      case '>':
        return a > b;
      case '<=':
        return a <= b;
      case '>=':
        return a >= b;
      case '==':
        return a === b;
      case '!=':
        return a !== b;
    }
    if (mode === 'int') {
      switch (op) {
        case '+':
          return (a + b) | 0;
        case '-':
          return (a - b) | 0;
        case '*':
          return Math.imul(a, b);
        case '/':
          if (b === 0) this.fail('ArithmeticException', '/ by zero');
          return (a / b) | 0;
        case '%':
          if (b === 0) this.fail('ArithmeticException', '/ by zero');
          return (a % b) | 0;
        case '&':
          return a & b;
        case '|':
          return a | b;
        case '^':
          return a ^ b;
        case '<<':
          return a << b;
        case '>>':
          return a >> b;
        case '>>>':
          return (a >>> b) | 0;
      }
    }
    if (mode === 'long') {
      switch (op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          if (b === 0) this.fail('ArithmeticException', '/ by zero');
          return Math.trunc(a / b);
        case '%':
          if (b === 0) this.fail('ArithmeticException', '/ by zero');
          return a % b + 0;
      }
    }
    switch (op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return a / b;
      case '%':
        return a % b;
    }
    throw new Error(`Unknown operator ${op}`);
  }

  private castNum(v: number, to: JType): number {
    switch (to.k) {
      case 'int':
        return toInt(v);
      case 'long':
        return toLong(v);
      case 'char':
        return toInt(v) & 0xffff;
      default:
        return v;
    }
  }

  /** Reads and writes one variable, so `x += 1` works out where x is only once. */
  private place(t: Expr): Place {
    const frame = this.stack[this.stack.length - 1];
    if (t.k === 'name') {
      const r = t.ref!;
      if (r.to === 'local') return { get: () => frame.slots[r.slot], set: (v) => (frame.slots[r.slot] = v), slot: { frame: frame.id, name: t.name } };
      if (r.to === 'static') {
        const key = `${r.f.owner}.${r.f.name}`;
        return { get: () => this.statics.get(key), set: (v) => this.statics.set(key, v) };
      }
      if (r.to === 'field') return this.fieldPlace(frame.self!, r.f.name);
    }
    if (t.k === 'field') {
      const r = t.ref!;
      if (r.to === 'static') {
        const key = `${r.f.owner}.${r.f.name}`;
        if (t.target.k !== 'name' || t.target.ref?.to !== 'class') this.eval(t.target);
        return { get: () => this.statics.get(key), set: (v) => this.statics.set(key, v) };
      }
      if (r.to === 'field') {
        // Java evaluates the right side before it notices a null here.
        const o = this.eval(t.target) as JObj | null;
        if (o !== null) return this.fieldPlace(o, r.f.name);
        const fail = (read: boolean) => this.npe(`Cannot ${read ? 'read' : 'assign'} field "${t.name}"${this.because(t.target)}`);
        return { get: () => fail(true), set: () => fail(false) };
      }
    }
    if (t.k === 'index') {
      const a = this.eval(t.target) as JArr | null;
      const i = this.eval(t.index) as number;
      const check = (verb: string): JArr => {
        if (a === null) return this.npe(`Cannot ${verb} ${this.arrayKind(t.target)} array${this.because(t.target)}`);
        if (i < 0 || i >= a.items.length) this.fail('ArrayIndexOutOfBoundsException', `Index ${i} out of bounds for length ${a.items.length}`);
        return a;
      };
      return { get: () => check('load from').items[i], set: (v) => (check('store to').items[i] = v), slot: a ? { obj: a.id, name: String(i) } : undefined };
    }
    throw new Error('Not a variable');
  }

  private fieldPlace(o: JObj, name: string): Place {
    return { get: () => o.fields[name], set: (v) => (o.fields[name] = v), slot: { obj: o.id, name } };
  }

  private concat(a: unknown, ta: JType, b: unknown, tb: JType): JStr {
    return new JStr(this.show(a, ta) + this.show(b, tb));
  }

  eval(e: Expr): unknown {
    switch (e.k) {
      case 'lit':
        if (e.lit === 'string') {
          let s = this.literals.get(e.value as string);
          if (!s) this.literals.set(e.value as string, (s = new JStr(e.value as string)));
          return s;
        }
        return e.value;
      case 'name': {
        const r = e.ref!;
        const f = this.stack[this.stack.length - 1];
        if (r.to === 'local') return f.slots[r.slot];
        if (r.to === 'field') return f.self!.fields[r.f.name];
        if (r.to === 'static') return this.statics.get(`${r.f.owner}.${r.f.name}`);
        return null;
      }
      case 'this':
        return this.stack[this.stack.length - 1].self;
      case 'field': {
        const r = e.ref!;
        if (r.to === 'lib') return r.value();
        if (r.to === 'static') {
          if (e.target.k !== 'name' || e.target.ref?.to !== 'class') this.eval(e.target);
          return this.statics.get(`${r.f.owner}.${r.f.name}`);
        }
        const o = this.eval(e.target);
        if (r.to === 'length') {
          if (o === null) this.npe(`Cannot read the array length${this.because(e.target)}`);
          return (o as JArr).items.length;
        }
        if (r.to === 'field') {
          if (o === null) this.npe(`Cannot read field "${e.name}"${this.because(e.target)}`);
          return (o as JObj).fields[r.f.name];
        }
        return null;
      }
      case 'call':
        return this.callExpr(e);
      case 'new': {
        const args = e.args.map((a) => this.eval(a));
        if (e.cls && this.p.classes.has(e.cls)) return this.construct(e.cls, e.user, args);
        const name = e.cls!;
        if (name === 'Object') {
          const o = new JObj('Object', this.nextId++);
          return o;
        }
        if (LIB[name].members.some((m) => m.name === 'getMessage')) return new JExc(name, args.length ? (args[0] === null ? null : (args[0] as JStr).v) : null, this.stackLines(), this.nextId++);
        return e.lib!.run(null, args, this);
      }
      case 'newarray': {
        if (e.init?.k === 'arrayinit') return this.makeArray(e.init);
        const sizes = e.sizes.map((s) => this.eval(s) as number);
        return this.filled(e.ty as JType & { k: 'array' }, sizes, 0);
      }
      case 'arrayinit':
        return this.makeArray(e);
      case 'index': {
        const a = this.eval(e.target) as JArr | null;
        const i = this.eval(e.index) as number;
        if (a === null) this.npe(`Cannot load from ${this.arrayKind(e.target)} array${this.because(e.target)}`);
        if (i < 0 || i >= a.items.length) this.fail('ArrayIndexOutOfBoundsException', `Index ${i} out of bounds for length ${a.items.length}`);
        return a.items[i];
      }
      case 'unary': {
        const v = this.eval(e.e);
        if (e.op === '!') return !(v as boolean);
        if (e.op === '+') return v;
        if (e.op === '~') return ~(v as number);
        const t = e.ty!;
        return t.k === 'int' ? -(v as number) | 0 : -(v as number);
      }
      case 'incdec': {
        const p = this.place(e.e);
        const old = p.get();
        const t = e.e.ty!;
        const boxedT = old instanceof JBox ? old : null;
        const was = (boxedT ? boxedT.v : old) as number;
        const d = e.op === '++' ? 1 : -1;
        const next = t.k === 'double' || (boxedT && boxedT.box === 'Double') ? was + d : t.k === 'long' ? was + d : t.k === 'char' ? (was + d) & 0xffff : (was + d) | 0;
        p.set(boxedT ? this.boxed(boxedT.box, next) : next);
        if (this.tracing) {
          const name = this.exprText(e.e, false, []);
          this.beat({ k: 'eval', steps: [`${name} ${e.op[0]} 1`, `${this.label(old, t)} ${e.op[0]} 1`, this.label(next, t)], reads: p.slot ? [p.slot] : [] });
          this.beat({ k: 'write', name, to: p.slot, value: this.shown(next, t) });
        }
        return e.prefix ? (boxedT ? this.boxed(boxedT.box, next) : next) : old;
      }
      case 'binary':
        return this.binary(e);
      case 'assign': {
        if (e.op === '=') {
          const p = this.place(e.target);
          const seen = this.peek(e.value);
          const v = this.eval(e.value);
          p.set(v);
          this.wrote(e.target, seen, p, v);
          return v;
        }
        const p = this.place(e.target);
        const seen = this.peek({ k: 'binary', op: e.op.slice(0, -1), a: e.target, b: e.value, pos: e.pos });
        const old = p.get();
        const b = this.eval(e.value);
        const op = e.op.slice(0, -1);
        const t = e.target.ty!;
        let v: unknown;
        if (e.mode === 'str') v = this.concat(old, t, b, e.value.ty!);
        else if (e.mode === 'bool') v = op === '&' ? (old as boolean) && (b as boolean) : op === '|' ? (old as boolean) || (b as boolean) : old !== b;
        else {
          const box = old instanceof JBox ? old.box : null;
          const r = this.arith(op, e.mode!, (box ? (old as JBox).v : old) as number, b as number) as number;
          v = box ? this.boxed(box, r) : this.castNum(r, t);
        }
        p.set(v);
        this.wrote(e.target, seen, p, v);
        return v;
      }
      case 'cond':
        return (this.eval(e.c) as boolean) ? this.eval(e.a) : this.eval(e.b);
      case 'cast':
        return this.cast(e);
      case 'instanceof': {
        const v = this.eval(e.e);
        if (v === null) return false;
        return this.isA(v, e.type.name);
      }
      case 'conv': {
        const v = this.eval(e.e);
        if (e.box) return this.boxed(e.box, v as number | boolean);
        if (v === null) this.npe(`Cannot invoke "${this.jvmType(e.e.ty!)}.${e.ty!.k}Value()"${this.because(e.e)}`);
        return (v as JBox).v;
      }
    }
  }

  private isA(v: unknown, name: string): boolean {
    if (name === 'Object') return true;
    if (v instanceof JObj) return v.cls === name;
    if (v instanceof JStr) return name === 'String';
    if (v instanceof JBox) return v.box === name;
    if (v instanceof JList) return name === 'ArrayList' || name === 'List';
    return false;
  }

  private cast(e: Expr & { k: 'cast' }): unknown {
    const v = this.eval(e.e);
    const to = e.ty!;
    if (isPrimitive(to)) {
      if (v instanceof JBox) return v.v;
      if (v === null) this.npe(`Cannot unbox a null value${this.because(e.e)}`);
      if (to.k === 'boolean') return v;
      return this.castNum(v as number, to);
    }
    if (e.e.ty && isPrimitive(e.e.ty)) return this.boxed(to.k === 'class' && to.name !== 'Object' ? to.name : ({ int: 'Integer', double: 'Double', boolean: 'Boolean', char: 'Character', long: 'Long' } as Record<string, string>)[e.e.ty.k], v as number);
    if (v === null || to.k !== 'class' || this.isA(v, to.name)) return v;
    if (v instanceof JArr) return v;
    const a = this.runtimeName(v);
    const b = LIB[to.name] ? `${LIB[to.name].pkg ?? 'java.lang'}.${to.name}` : to.name;
    const home = (n: string) => (n.startsWith('java.') ? "module java.base of loader 'bootstrap'" : "unnamed module of loader 'app'");
    const where = home(a) === home(b) ? `${a} and ${b} are in ${home(a)}` : `${a} is in ${home(a)}; ${b} is in ${home(b)}`;
    return this.fail('ClassCastException', `class ${a} cannot be cast to class ${b} (${where})`);
  }

  private runtimeName(v: unknown): string {
    if (v instanceof JObj) return v.cls;
    if (v instanceof JStr) return 'java.lang.String';
    if (v instanceof JBox) return `java.lang.${v.box}`;
    if (v instanceof JList) return 'java.util.ArrayList';
    return 'java.lang.Object';
  }

  private binary(e: Expr & { k: 'binary' }): unknown {
    switch (e.mode) {
      case 'and':
        return (this.eval(e.a) as boolean) && (this.eval(e.b) as boolean);
      case 'or':
        return (this.eval(e.a) as boolean) || (this.eval(e.b) as boolean);
      case 'str': {
        const a = this.eval(e.a);
        const b = this.eval(e.b);
        return this.concat(a, e.a.ty!, b, e.b.ty!);
      }
      case 'ref': {
        const a = this.eval(e.a);
        const b = this.eval(e.b);
        return e.op === '==' ? a === b : a !== b;
      }
      case 'bool': {
        const a = this.eval(e.a) as boolean;
        const b = this.eval(e.b) as boolean;
        switch (e.op) {
          case '==':
            return a === b;
          case '!=':
          case '^':
            return a !== b;
          case '&':
            return a && b;
          default:
            return a || b;
        }
      }
      default: {
        const a = this.eval(e.a) as number;
        const b = this.eval(e.b) as number;
        return this.arith(e.op, e.mode!, a, b);
      }
    }
  }

  private callExpr(e: Expr & { k: 'call' }): unknown {
    const frame = this.stack[this.stack.length - 1];
    frame.line = e.pos.line;
    if (e.user) {
      const m = e.user;
      let self: JObj | null = null;
      if (!m.isStatic) {
        if (e.target) {
          const t = this.eval(e.target);
          self = t as JObj | null;
          if (self === null) this.npe(`Cannot invoke "${this.callSig(e)}"${this.because(e.target)}`);
        } else self = frame.self;
      } else if (e.target && !(e.target.k === 'name' && e.target.ref?.to === 'class')) this.eval(e.target);
      const args = e.args.map((a) => this.eval(a));
      frame.line = e.pos.line;
      return this.call(m, self, args, this.tracing && e.target ? this.exprText(e.target, false, []) : undefined);
    }
    const m = e.lib!;
    let self: unknown = null;
    if (!m.isStatic) {
      if (e.target) self = this.eval(e.target);
      else self = frame.self;
      if (self === null) this.npe(`Cannot invoke "${this.callSig(e)}"${e.target ? this.because(e.target) : ''}`);
    }
    const seen = e.args.length === 1 && (e.name === 'print' || e.name === 'println') ? this.peek(e.args[0]) : undefined;
    const args = e.args.map((a) => this.eval(a));
    this.evaluated(seen, args[0], e.args[0]?.ty);
    frame.line = e.pos.line;
    if (self instanceof JExc && m.owner === 'Object') return m.run(self, args, this);
    return m.run(self, args, this);
  }

  // --- start ---

  init(): void {
    for (const c of this.p.classes.values()) {
      for (const f of c.fields.values()) if (f.isStatic) this.statics.set(`${c.name}.${f.name}`, defaultOf(f.type));
    }
    for (const c of this.p.classes.values()) {
      this.enter(null, c.name, null, [], c.name);
      try {
        for (const f of c.fields.values()) if (f.isStatic && f.decl.init) this.statics.set(`${c.name}.${f.name}`, this.eval(f.decl.init));
      } finally {
        this.stack.pop();
      }
    }
  }
}

const isMain = (m: MethodInfo) => m.isStatic && m.access === 'public' && m.ret.k === 'void' && m.params.length === 1 && m.params[0].k === 'array' && m.params[0].of.k === 'class' && m.params[0].of.name === 'String';

/** The class that has `public static void main(String[] args)`. */
export function findMain(p: Program, prefer?: string): MethodInfo | undefined {
  const of = (c: UserClass | undefined) => c?.methods.get('main')?.find(isMain);
  if (prefer) return of(p.classes.get(prefer));
  for (const c of p.classes.values()) {
    const m = of(c);
    if (m) return m;
  }
  return undefined;
}

/** Runs a checked program from its main method. Deterministic: the same program and seed give the same result. */
export function runProgram(p: Program, opts: RunOptions = {}): RunResult {
  const main = findMain(p, opts.mainClass);
  if (!main) return { output: '', status: 'no-main' };
  const it = new Interp(p, opts);
  const done = (r: Omit<RunResult, 'output' | 'trace'>): RunResult => {
    if (opts.trace) it.closeStep();
    return { ...r, output: it.out.join(''), trace: opts.trace ? it.trace : undefined, traceCut: it.traceCut || undefined };
  };
  try {
    it.init();
    it.call(main, null, [new JArr(STRING, [], 0)]);
    return done({ status: 'ok' });
  } catch (e) {
    if (e instanceof Thrown) {
      const x = e.exc;
      return done({ status: 'exception', exception: { type: excName(x.cls), short: x.cls, message: x.msg, at: x.at } });
    }
    if (e instanceof Halt) return e.why === 'exit' ? done({ status: 'ok' }) : done({ status: 'limit', limit: e.why });
    if (e instanceof RangeError) return done({ status: 'exception', exception: { type: 'java.lang.StackOverflowError', short: 'StackOverflowError', message: null, at: [] } });
    throw e;
  }
}
