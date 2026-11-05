import type { Block, ClassDecl, Expr, FileAst, MethodDecl, Stmt, TypeNode } from './ast';
import { SyntaxStop, type CompileError, type Pos } from './errors';
import { doubleStr } from './format';
import { EXCEPTIONS, LIB, MISSING_CLASSES } from './lib';
import { parseFile } from './parser';
import { arr, BOOLEAN, BOX, CHAR, cls, DOUBLE, ERROR, INT, isNumeric, isPrimitive, isRef, isStr, LONG, NULL, OBJECT, STRING, typeName, UNBOX, VOID, type FieldInfo, type JType, type LibMember, type MethodInfo, type UserClass } from './types';

export interface SourceFile {
  name: string;
  text: string;
}

/** A program that passed the checker: every expression knows its type and what its names mean. */
export interface Program {
  files: SourceFile[];
  classes: Map<string, UserClass>;
}

export interface CompileResult {
  program?: Program;
  errors: CompileError[];
}

interface Local {
  name: string;
  type: JType;
  slot: number;
  isFinal: boolean;
}

/** A loop being checked. `sets`: which locals hold a value at each break. */
interface Loop {
  broke: boolean;
  sets: Set<number>[];
}

/** What the checker knows about the method it's in. */
interface Ctx {
  cls: UserClass;
  isStatic: boolean;
  ret: JType;
  /** "method main(String[])", for "already defined" messages. */
  label: string;
  isCtor: boolean;
  scopes: Map<string, Local>[];
  slots: string[];
  /** Slots that hold a value at this point in the code. */
  set: Set<number>;
  loops: Loop[];
}

/** Common slips in a type name, and the fix. */
const TYPE_SLIPS: Record<string, string> = {
  string: 'String', Int: 'int', Integer_: 'int', integer: 'int', Double_: 'double', bool: 'boolean', Bool: 'boolean', Boolean_: 'boolean', str: 'String', Str: 'String', Char: 'char', Void: 'void',
};

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** The name in `names` closest to `name`, if a typo could explain the gap. */
function closest(name: string, names: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestD = Math.max(2, Math.floor(name.length / 3)) + 1;
  for (const n of names) {
    const dist = n.toLowerCase() === name.toLowerCase() ? 0 : distance(name, n);
    if (dist < bestD) {
      best = n;
      bestD = dist;
    }
  }
  return best;
}

const FLOW_ERRORS = new Set(['missing-return', 'uninitialized', 'unreachable', 'final-unset']);

const same = (a: JType, b: JType): boolean => typeName(a) === typeName(b);

function primWidens(from: JType, to: JType): boolean {
  if (from.k === to.k) return true;
  if (from.k === 'char') return to.k === 'int' || to.k === 'long' || to.k === 'double';
  if (from.k === 'int') return to.k === 'long' || to.k === 'double';
  if (from.k === 'long') return to.k === 'double';
  return false;
}

function excIsA(from: string, to: string): boolean {
  for (let c: string | undefined = from; c; c = EXCEPTIONS[c]) if (c === to) return true;
  return false;
}

/** Does a value of type `from` fit a variable of type `to`? `box`: allow an int to become an Integer and back. */
function fits(from: JType, to: JType, box: boolean): boolean {
  if (from.k === 'error' || to.k === 'error') return true;
  if (from.k === 'void' || to.k === 'void') return false;
  if (isPrimitive(to)) {
    if (from.k !== 'class') return primWidens(from, to);
    return box && !!UNBOX[from.name] && primWidens(UNBOX[from.name], to);
  }
  if (from.k === 'null') return true;
  if (isPrimitive(from)) return box && to.k === 'class' && (to.name === BOX[from.k] || to.name === 'Object');
  if (to.k === 'class' && to.name === 'Object') return true;
  if (from.k === 'array') return to.k === 'array' && (same(from.of, to.of) || (isRef(from.of) && isRef(to.of) && fits(from.of, to.of, false)));
  if (from.k === 'class' && to.k === 'class') {
    if (from.name !== to.name && !(from.name === 'ArrayList' && to.name === 'List') && !excIsA(from.name, to.name)) return false;
    if (!from.args.length || !to.args.length) return true;
    return from.args.length === to.args.length && from.args.every((a, i) => same(a, to.args[i]));
  }
  return false;
}

const unboxed = (t: JType): JType => (t.k === 'class' && UNBOX[t.name]) || t;

const promote = (a: JType, b: JType): JType => (a.k === 'double' || b.k === 'double' ? DOUBLE : a.k === 'long' || b.k === 'long' ? LONG : INT);

const mismatchText = (from: JType, to: JType): string =>
  isPrimitive(from) && isNumeric(from) && isNumeric(to) ? `possible lossy conversion from ${typeName(from)} to ${typeName(to)}` : `${typeName(from)} cannot be converted to ${typeName(to)}`;

/** A type with its article: "an int", "a String". */
const an = (t: JType) => `${/^[aeiou]/i.test(typeName(t)) ? 'an' : 'a'} ${typeName(t)}`;
const An = (t: JType) => an(t).replace('a', 'A');

const sigOf = (m: { params: JType[] }) => m.params.map(typeName).join(',');
const argsText = (ts: JType[]) => (ts.length ? ts.map(typeName).join(',') : 'no arguments');

export interface CompileOptions {
  /** Let any class read private members. For hidden checks that inspect a student's object. */
  ignorePrivate?: boolean;
}

class Checker {
  errors: CompileError[] = [];
  classes = new Map<string, UserClass>();
  private imports = new Map<string, string[]>();
  private cur!: Ctx;
  /** The left side of the assignment being checked. */
  private writing?: Expr;

  constructor(private opts: CompileOptions) {}

  err(code: string, msg: string, pos: Pos, help?: string, detail?: string[]): void {
    if (this.errors.some((e) => e.pos.file === pos.file && e.pos.line === pos.line && e.msg === msg)) return;
    this.errors.push({ code, msg, pos, help, detail });
  }

  // --- declarations ---

  run(asts: FileAst[]): void {
    for (const f of asts) {
      this.imports.set(f.file, f.imports.map((i) => i.name));
      for (const i of f.imports) {
        if (!/^java\.(util|lang|io|math|text|time)(\.|$)/.test(i.name)) {
          const pkg = i.name.replace(/\.[^.]+$/, '');
          this.err('bad-import', `package ${pkg} does not exist`, i.pos, 'Check the spelling of this import. ArrayList comes from java.util.');
        }
        const name = i.name.split('.').pop()!;
        if (name in MISSING_CLASSES) this.err('unsupported', `this editor does not run ${name}`, i.pos, MISSING_CLASSES[name]);
      }
      for (const c of f.classes) this.declareClass(c);
    }
    for (const c of this.classes.values()) this.declareMembers(c);
    for (const c of this.classes.values()) this.checkClass(c);
  }

  private declareClass(d: ClassDecl): void {
    if (this.classes.has(d.name) || LIB[d.name]) {
      if (this.classes.has(d.name)) {
        this.err('duplicate-class', `duplicate class: ${d.name}`, d.pos, `There are two classes named ${d.name}. Give one a different name.`);
        return;
      }
    }
    const want = `${d.name}.java`;
    if (d.isPublic && d.file !== want) {
      this.err(
        'wrong-file',
        `class ${d.name} is public, should be declared in a file named ${want}`,
        d.pos,
        `A public class has to live in a file with the same name. This file is ${d.file}, so the class should be called ${d.file.replace('.java', '')}.`,
      );
    }
    this.classes.set(d.name, { name: d.name, decl: d, fields: new Map(), methods: new Map(), ctors: [] });
  }

  private declareMembers(c: UserClass): void {
    const d = c.decl;
    for (const f of d.fields) {
      const type = this.resolve(f.type, d.file, c.name);
      if (c.fields.has(f.name)) {
        this.err('duplicate-var', `variable ${f.name} is already defined in class ${c.name}`, f.pos, `This class already has an instance variable called ${f.name}. Delete one of them.`);
        continue;
      }
      c.fields.set(f.name, { name: f.name, type, owner: c.name, isStatic: f.isStatic, isFinal: f.isFinal, access: f.access, decl: f });
    }
    const info = (m: MethodDecl): MethodInfo => ({
      name: m.name,
      params: m.params.map((p) => this.resolve(p.type, d.file, c.name)),
      ret: m.ret ? this.resolve(m.ret, d.file, c.name) : VOID,
      owner: c.name,
      isStatic: m.isStatic,
      access: m.access,
      decl: m,
    });
    for (const m of d.ctors) {
      const i = info(m);
      if (c.ctors.some((o) => sigOf(o) === sigOf(i))) this.err('duplicate-method', `constructor ${c.name}(${sigOf(i)}) is already defined in class ${c.name}`, m.pos, 'Two constructors can share a class only if their parameter types differ.');
      else c.ctors.push(i);
    }
    for (const m of d.methods) {
      const i = info(m);
      const list = c.methods.get(m.name) ?? [];
      if (list.some((o) => sigOf(o) === sigOf(i))) {
        this.err('duplicate-method', `method ${m.name}(${sigOf(i)}) is already defined in class ${c.name}`, m.pos, 'Two methods can share a name only if their parameter types differ.');
        continue;
      }
      list.push(i);
      c.methods.set(m.name, list);
      this.checkOverride(c, i, m);
    }
  }

  /** toString, equals, and hashCode replace Object's versions, which sets rules for how they're declared. */
  private checkOverride(c: UserClass, i: MethodInfo, m: MethodDecl): void {
    const base = LIB.Object.members.find((o) => o.name === m.name && sigOf(o) === sigOf(i));
    if (!base) {
      if (m.isOverride) {
        this.err('bad-override', 'method does not override or implement a method from a supertype', m.overridePos ?? m.pos, `@Override says this method replaces one from Object, but Object has no ${m.name}(${sigOf(i)}). Check the name and parameters, or delete @Override.`);
      }
      return;
    }
    const head = `${m.name}(${sigOf(i)}) in ${c.name} cannot override ${m.name}(${sigOf(i)}) in Object`;
    if (m.isStatic) this.err('bad-override', head, m.pos, `${m.name} can't be static here.`, ['  overriding method is static']);
    else if (m.access !== 'public') {
      this.err('bad-override', head, m.pos, `${m.name} has to be public, because it replaces a public method that every class gets. Write public before the return type.`, ['  attempting to assign weaker access privileges; was public']);
    } else if (!same(i.ret, base.ret) && i.ret.k !== 'error') {
      this.err('bad-override', head, m.pos, `${m.name} has to return ${typeName(base.ret)}.`, [`  return type ${typeName(i.ret)} is not compatible with ${typeName(base.ret)}`]);
    }
  }

  private libVisible(name: string, file: string): boolean {
    const l = LIB[name];
    if (!l) return false;
    if (!l.pkg) return true;
    return (this.imports.get(file) ?? []).some((i) => i === `${l.pkg}.${name}` || i === `${l.pkg}.*`);
  }

  /** A written type to a real one. Reports a type that doesn't exist. */
  private resolve(t: TypeNode, file: string, where: string): JType {
    let base: JType;
    const prims: Record<string, JType> = { int: INT, long: LONG, double: DOUBLE, boolean: BOOLEAN, char: CHAR, void: VOID };
    if (prims[t.name]) base = prims[t.name];
    else if (this.classes.has(t.name) || this.libVisible(t.name, file)) {
      const args = t.args.map((a) => {
        const r = this.resolve(a, file, where);
        if (isPrimitive(r)) {
          this.err('prim-type-arg', 'unexpected type', a.pos, `An ArrayList holds objects, not primitives. Write ${BOX[r.k]} instead of ${r.k}.`, ['  required: reference', `  found:    ${r.k}`]);
          return ERROR;
        }
        return r;
      });
      base = cls(t.name, args);
    } else {
      base = ERROR;
      this.unknownType(t, file, where);
    }
    for (let i = 0; i < t.dims; i++) base = arr(base);
    return base;
  }

  private unknownType(t: TypeNode, file: string, where: string): void {
    const detail = ['  symbol:   class ' + t.name, `  location: class ${where}`];
    let help: string;
    if (t.name in MISSING_CLASSES) help = MISSING_CLASSES[t.name];
    else if (LIB[t.name]?.pkg) help = `${t.name} has to be imported. Add this as the first line of ${file}: import ${LIB[t.name].pkg}.${t.name};`;
    else if (TYPE_SLIPS[t.name]) help = `Java is picky about capital letters. Write ${TYPE_SLIPS[t.name]}, not ${t.name}.`;
    else {
      const near = closest(t.name, [...this.classes.keys(), 'String', 'int', 'double', 'boolean']);
      help = near ? `Java doesn't know a type called ${t.name}. Did you mean ${near}?` : `Java doesn't know a type called ${t.name}. Check the spelling.`;
    }
    this.err('unknown-class', 'cannot find symbol', t.pos, help, detail);
  }

  // --- bodies ---

  private checkClass(c: UserClass): void {
    const blank = (isStatic: boolean, label: string): Ctx => ({ cls: c, isStatic, ret: VOID, label, isCtor: false, scopes: [new Map()], slots: [], set: new Set(), loops: [] });
    for (const f of c.fields.values()) {
      if (!f.decl.init) continue;
      this.cur = blank(f.isStatic, `class ${c.name}`);
      f.decl.init = this.initializer(f.decl.init, f.type);
    }
    for (const m of c.ctors) this.checkMethod(c, m, true);
    for (const list of c.methods.values()) for (const m of list) this.checkMethod(c, m, false);
    if (c.decl.fields.length || c.ctors.length) this.finalFieldsSet(c);
  }

  /** A final field with no value of its own has to get one in every constructor. */
  private finalFieldsSet(c: UserClass): void {
    for (const f of c.fields.values()) {
      if (!f.isFinal || f.decl.init) continue;
      const setsIt = (m: MethodDecl) => JSON.stringify(m.body, (k, v) => (k === 'ty' || k === 'ref' || k === 'user' || k === 'lib' ? undefined : v)).includes(`"k":"assign"`);
      if (!c.ctors.length) this.err('final-unset', `variable ${f.name} not initialized in the default constructor`, f.decl.pos, 'A final variable needs a value. Set it where you declare it, or in a constructor.');
      else if (f.isStatic) this.err('final-unset', `variable ${f.name} not initialized in the default constructor`, f.decl.pos, 'A static final variable needs a value where you declare it.');
      else for (const m of c.ctors) if (!setsIt(m.decl)) this.err('final-unset', `variable ${f.name} might not have been initialized`, m.decl.body.endPos, 'A final variable needs a value. Set it in this constructor.');
    }
  }

  private checkMethod(c: UserClass, m: MethodInfo, isCtor: boolean): void {
    const d = m.decl;
    this.cur = {
      cls: c,
      isStatic: m.isStatic,
      ret: m.ret,
      label: `${isCtor ? 'constructor' : 'method'} ${m.name}(${sigOf(m)})`,
      isCtor,
      scopes: [new Map()],
      slots: [],
      set: new Set(),
      loops: [],
    };
    d.params.forEach((p, i) => {
      const slot = this.declare(p.name, m.params[i], p.pos, false);
      this.cur.set.add(slot);
    });
    const ends = this.block(d.body);
    d.slotNames = this.cur.slots;
    if (ends && !isCtor && m.ret.k !== 'void') {
      this.err('missing-return', 'missing return statement', d.body.endPos, `This method says it returns ${typeName(m.ret)}, but Java can reach the closing } without a return. Add a return line. If you used an if, make sure every path returns a value.`);
    }
  }

  private find(name: string): Local | undefined {
    for (let i = this.cur.scopes.length - 1; i >= 0; i--) {
      const hit = this.cur.scopes[i].get(name);
      if (hit) return hit;
    }
    return undefined;
  }

  private declare(name: string, type: JType, pos: Pos, isFinal: boolean): number {
    if (this.find(name)) {
      this.err('duplicate-var', `variable ${name} is already defined in ${this.cur.label}`, pos, `You already declared ${name} in this method. To change its value, leave off the type: ${name} = ...`);
    }
    const slot = this.cur.slots.length;
    this.cur.slots.push(name);
    this.cur.scopes[this.cur.scopes.length - 1].set(name, { name, type, slot, isFinal });
    return slot;
  }

  private block(b: Block): boolean {
    this.cur.scopes.push(new Map());
    b.from = this.cur.slots.length;
    const ends = this.stmts(b.body);
    b.to = this.cur.slots.length;
    this.cur.scopes.pop();
    return ends;
  }

  /** Checks a run of statements. Returns whether Java can reach the end of them. */
  private stmts(list: Stmt[]): boolean {
    let ends = true;
    for (const s of list) {
      if (!ends) {
        this.err('unreachable', 'unreachable statement', s.pos, 'Java can never get to this line, because the line before it always leaves the method or the loop. Move it up, or delete it.');
        ends = true; // One message per run of dead code.
      }
      ends = this.stmt(s);
    }
    return ends;
  }

  private scoped(s: Stmt): boolean {
    if (s.k === 'block') return this.block(s);
    if (s.k === 'local') {
      this.err('decl-not-allowed', 'variable declaration not allowed here', s.pos, 'A declaration can\'t be the only line under an if or a loop. Put it inside { }.');
      return true;
    }
    this.cur.scopes.push(new Map());
    const ends = this.stmt(s);
    this.cur.scopes.pop();
    return ends;
  }

  /** Locals that hold a value after a loop: at the exit test (`base`, unless it has none) and at every break. */
  private afterLoop(base: Set<number> | null, loop: Loop): Set<number> {
    let out = base;
    for (const b of loop.sets) out = out ? new Set([...out].filter((x) => b.has(x))) : b;
    return out ?? new Set(this.cur.set);
  }

  private condition(e: Expr): Expr {
    const t = this.expr(e);
    if (t.k === 'error' || t.k === 'boolean' || (t.k === 'class' && t.name === 'Boolean')) return this.adapt(e, BOOLEAN);
    this.err(
      'not-boolean',
      `incompatible types: ${typeName(t)} cannot be converted to boolean`,
      e.pos,
      e.k === 'assign' ? 'One = stores a value. To compare two values, use ==.' : 'An if or a loop needs a true or false test here, such as count > 0.',
    );
    return e;
  }

  private stmt(s: Stmt): boolean {
    const c = this.cur;
    switch (s.k) {
      case 'block':
        return this.block(s);
      case 'empty':
        return true;
      case 'local': {
        const base = this.resolve(s.type, s.pos.file, c.cls.name);
        for (const v of s.vars) {
          let t = base;
          for (let i = 0; i < v.dims; i++) t = arr(t);
          if (t.k === 'void') {
            this.err('illegal-expr', "illegal start of expression", s.pos);
            t = ERROR;
          }
          v.ty = t;
          // Java declares the variable before it reads the value, but it holds nothing until then.
          if (v.init) {
            const slot = this.declare(v.name, t, v.pos, s.isFinal);
            v.slot = slot;
            v.init = this.initializer(v.init, t);
            c.set.add(slot);
          } else v.slot = this.declare(v.name, t, v.pos, s.isFinal);
        }
        return true;
      }
      case 'expr':
        this.expr(s.e);
        return true;
      case 'if': {
        s.c = this.condition(s.c);
        const before = new Set(c.set);
        const aEnds = this.scoped(s.a);
        const afterA = c.set;
        c.set = new Set(before);
        const bEnds = s.b ? this.scoped(s.b) : true;
        const afterB = c.set;
        if (!s.b) c.set = before;
        else if (!aEnds) c.set = afterB;
        else if (bEnds) c.set = new Set([...afterA].filter((x) => afterB.has(x)));
        else c.set = afterA;
        return s.b ? aEnds || bEnds : true;
      }
      case 'while':
      case 'do': {
        if (s.k === 'while') s.c = this.condition(s.c);
        const before = new Set(c.set);
        const loop: Loop = { broke: false, sets: [] };
        c.loops.push(loop);
        this.scoped(s.body);
        c.loops.pop();
        if (s.k === 'do') {
          s.c = this.condition(s.c);
          const forever = s.c.k === 'lit' && s.c.value === true;
          c.set = this.afterLoop(forever ? null : c.set, loop);
          return !forever || loop.broke;
        }
        const forever = s.c.k === 'lit' && s.c.value === true;
        c.set = this.afterLoop(forever ? null : before, loop);
        return !forever || loop.broke;
      }
      case 'for': {
        c.scopes.push(new Map());
        s.from = c.slots.length;
        for (const i of s.init) this.stmt(i);
        if (s.c) s.c = this.condition(s.c);
        const before = new Set(c.set);
        const loop: Loop = { broke: false, sets: [] };
        c.loops.push(loop);
        this.scoped(s.body);
        c.loops.pop();
        for (const u of s.update) {
          this.expr(u);
          if (u.k !== 'assign' && u.k !== 'incdec' && u.k !== 'call') this.err('not-a-statement', 'not a statement', u.pos);
        }
        const forever = !s.c || (s.c.k === 'lit' && s.c.value === true);
        c.set = this.afterLoop(forever ? null : before, loop);
        s.to = c.slots.length;
        c.scopes.pop();
        return !forever || loop.broke;
      }
      case 'foreach': {
        const t = this.expr(s.iter);
        let elem: JType = ERROR;
        if (t.k === 'array') elem = t.of;
        else if (t.k === 'class' && (t.name === 'ArrayList' || t.name === 'List')) elem = t.args[0] ?? OBJECT;
        else if (t.k !== 'error') this.err('bad-foreach', 'for-each not applicable to expression type', s.iter.pos, 'A for-each loop goes through an array or an ArrayList.', ['  required: array or java.lang.Iterable', `  found:    ${typeName(t)}`]);
        c.scopes.push(new Map());
        const vt = this.resolve(s.type, s.pos.file, c.cls.name);
        if (!fits(elem, vt, true)) this.mismatch(elem, vt, s.iter.pos);
        s.unbox = isPrimitive(vt) && elem.k === 'class';
        if (!isPrimitive(elem) || !isRef(vt)) s.box = undefined;
        else s.box = BOX[elem.k];
        s.slot = this.declare(s.name, vt, s.namePos, false);
        const before = new Set(c.set);
        c.set.add(s.slot);
        const loop: Loop = { broke: false, sets: [] };
        c.loops.push(loop);
        this.scoped(s.body);
        c.loops.pop();
        c.set = before;
        c.scopes.pop();
        return true;
      }
      case 'return': {
        if (!s.e) {
          if (c.ret.k !== 'void') this.err('missing-return-value', 'incompatible types: missing return value', s.pos, `This method has to give back ${an(c.ret)}. Write the value after return.`);
          return false;
        }
        if (c.ret.k === 'void') {
          this.expr(s.e);
          this.err(
            'return-from-void',
            'incompatible types: unexpected return value',
            s.e.pos,
            c.isCtor ? 'A constructor has no return value. It builds the object, and that is all.' : 'This method says void, which means it gives nothing back. Change void to the type you want to return, or delete the return.',
          );
          return false;
        }
        s.e = this.initializer(s.e, c.ret, true);
        return false;
      }
      case 'break':
      case 'continue':
        if (!c.loops.length) {
          this.err('outside-loop', `${s.k} outside ${s.k === 'break' ? 'switch or ' : 'of '}loop`, s.pos, `${s.k} only works inside a loop.`);
          return true;
        }
        if (s.k === 'break') {
          const loop = c.loops[c.loops.length - 1];
          loop.broke = true;
          loop.sets.push(new Set(c.set));
        }
        return false;
      case 'throw': {
        const t = this.expr(s.e);
        if (t.k === 'class' && !(t.name in EXCEPTIONS)) this.mismatch(t, cls('Throwable'), s.e.pos);
        return false;
      }
      case 'ctorcall': {
        if (!c.isCtor) {
          this.err('bad-ctor-call', `call to ${s.which} must be first statement in constructor`, s.pos, `${s.which}(...) only works as the first line of a constructor.`);
          return true;
        }
        const types = s.args.map((a) => this.expr(a));
        if (s.which === 'super') return true;
        const m = this.pick(c.cls.ctors, types);
        if (!m) this.noMatch('constructor', c.cls.name, c.cls.name, c.cls.ctors, s.args, s.pos);
        else {
          s.m = m;
          s.args = s.args.map((a, i) => this.adapt(a, m.params[i]));
        }
        return true;
      }
    }
  }

  private mismatch(from: JType, to: JType, pos: Pos, e?: Expr, returning = false): void {
    if (from.k === 'error' || to.k === 'error') return;
    if (isNumeric(unboxed(from)) && isNumeric(to) && isPrimitive(from)) {
      this.err(
        'lossy',
        `incompatible types: possible lossy conversion from ${typeName(from)} to ${typeName(to)}`,
        pos,
        `${An(from)} doesn't fit in ${an(to)} without losing part of the value. Change the variable's type, or cast it: (${typeName(to)}).`,
      );
      return;
    }
    const written = e?.k === 'lit';
    let help = `${returning ? `This method says it returns ${an(to)}` : `This spot needs ${an(to)}`}, but the value here is ${an(from)}.`;
    if (from.k === 'void') help = 'This method is void, so it gives nothing back to store or use.';
    else if (isStr(from) && isPrimitive(to) && written) help += ` Text in double quotes is a String, even if it looks like a number.`;
    else if (isStr(to) && isPrimitive(from) && written) help += ` Put text in double quotes.`;
    this.err('type-mismatch', `incompatible types: ${typeName(from)} cannot be converted to ${typeName(to)}`, pos, help);
  }

  /** The value of an int expression that's fixed when compiling, so `char c = 65;` is legal. */
  private constInt(e: Expr): number | undefined {
    if (e.k === 'lit' && (e.lit === 'int' || e.lit === 'char')) return e.value as number;
    if (e.k === 'unary' && e.op === '-') {
      const v = this.constInt(e.e);
      return v === undefined ? undefined : -v;
    }
    if (e.k === 'binary') {
      const a = this.constInt(e.a);
      const b = this.constInt(e.b);
      if (a === undefined || b === undefined) return undefined;
      if (e.op === '+') return a + b;
      if (e.op === '-') return a - b;
      if (e.op === '*') return a * b;
    }
    return undefined;
  }

  /** In `c ? 'a' : 98`, a char and an int constant that fits one make a char. */
  private charConst(t: JType, other: Expr): boolean {
    if (t.k !== 'char' || other.ty?.k !== 'int') return false;
    const v = this.constInt(other);
    return v !== undefined && v >= 0 && v <= 65535;
  }

  /** The text of an expression fixed when compiling. */
  private constText(e: Expr): string | undefined {
    if (e.k !== 'lit') return undefined;
    if (e.lit === 'string') return e.value as string;
    if (e.lit === 'int' || e.lit === 'bool') return String(e.value);
    if (e.lit === 'char') return String.fromCharCode(e.value as number);
    if (e.lit === 'double') return doubleStr(e.value as number);
    return undefined;
  }

  /** A value going into a variable of type `to`: an initializer, argument, or return. */
  private initializer(e: Expr, to: JType, returning = false): Expr {
    if (e.k === 'arrayinit') {
      this.arrayInit(e, to);
      return e;
    }
    const t = this.expr(e, to);
    return this.assignTo(e, t, to, returning);
  }

  private assignTo(e: Expr, t: JType, to: JType, returning = false): Expr {
    if (fits(t, to, true)) return this.adapt(e, to);
    if (to.k === 'char' && t.k === 'int') {
      const v = this.constInt(e);
      if (v !== undefined && v >= 0 && v <= 65535) return e;
    }
    this.mismatch(t, to, e.pos, e, returning);
    return e;
  }

  private arrayInit(e: Expr & { k: 'arrayinit' }, to: JType): void {
    e.ty = to;
    if (to.k === 'error') return;
    if (to.k !== 'array') {
      this.err('type-mismatch', `illegal initializer for ${typeName(to)}`, e.pos, 'Braces only set up an array. This variable is not an array.');
      return;
    }
    e.items = e.items.map((i) => this.initializer(i, to.of));
  }

  /** Wraps `e` if its value has to change form to become a `to`. */
  private adapt(e: Expr, to: JType): Expr {
    const from = e.ty;
    if (!from) return e;
    if (isPrimitive(from) && to.k === 'class') return { k: 'conv', e, box: to.name === 'Object' || !UNBOX[to.name] ? BOX[from.k] : to.name, pos: e.pos, ty: cls(BOX[from.k]) };
    if (from.k === 'class' && UNBOX[from.name] && isPrimitive(to)) return { k: 'conv', e, box: null, pos: e.pos, ty: UNBOX[from.name] };
    return e;
  }

  // --- expressions ---

  private expr(e: Expr, want?: JType): JType {
    const t = this.expr1(e, want);
    e.ty = t;
    return t;
  }

  private classRef(e: Expr): string | null {
    if (e.k !== 'name' || this.find(e.name) || this.cur.cls.fields.has(e.name)) return null;
    if (this.classes.has(e.name) || this.libVisible(e.name, e.pos.file)) {
      e.ref = { to: 'class', name: e.name };
      return e.name;
    }
    return null;
  }

  private noSymbol(kind: 'variable' | 'method', text: string, pos: Pos, help: string, location?: string): void {
    this.err('unknown-symbol', 'cannot find symbol', pos, help, [`  symbol:   ${kind} ${text}`, `  location: ${location ?? `class ${this.cur.cls.name}`}`]);
  }

  private nameExpr(e: Expr & { k: 'name' }): JType {
    const c = this.cur;
    const local = this.find(e.name);
    if (local) {
      e.ref = { to: 'local', slot: local.slot };
      if (!c.set.has(local.slot)) {
        this.err('uninitialized', `variable ${e.name} might not have been initialized`, e.pos, `${e.name} was declared, but it might not hold a value yet. Give it one before you use it.`);
        c.set.add(local.slot);
      }
      return local.type;
    }
    const f = c.cls.fields.get(e.name);
    if (f) {
      if (f.isStatic) {
        e.ref = { to: 'static', f };
        return f.type;
      }
      if (c.isStatic) {
        this.err('static-context', `non-static variable ${e.name} cannot be referenced from a static context`, e.pos, `${e.name} belongs to one object, and a static method like main has no object. Make an object with new, then ask it for the value.`);
        return f.type;
      }
      e.ref = { to: 'field', f };
      return f.type;
    }
    const names = [...c.scopes.flatMap((s) => [...s.keys()]), ...c.cls.fields.keys()];
    const near = closest(e.name, names);
    this.noSymbol(
      'variable',
      e.name,
      e.pos,
      near ? `There is no variable called ${e.name} here. Did you mean ${near}?` : `There is no variable called ${e.name} here. Check the spelling. A variable also only works inside the { } block that declares it.`,
    );
    return ERROR;
  }

  /** `a.b`. `qualifier`: another dot follows, so javac would read an unknown `a.b` as a package. */
  private fieldExpr(e: Expr & { k: 'field' }, qualifier = false): JType {
    const owner = this.classRef(e.target);
    if (owner) {
      const u = this.classes.get(owner);
      if (u) {
        const f = u.fields.get(e.name);
        if (!f) {
          this.noSymbol('variable', e.name, e.pos, `The class ${owner} has no variable called ${e.name}.`, `class ${owner}`);
          return ERROR;
        }
        if (!f.isStatic) {
          this.err('static-context', `non-static variable ${e.name} cannot be referenced from a static context`, e.pos, `${e.name} belongs to each object, not to the class. Use an object here, not ${owner}.`);
          return f.type;
        }
        this.privateCheck(f.access, owner, e.name, e.pos, f);
        e.ref = { to: 'static', f };
        return f.type;
      }
      const s = LIB[owner].statics[e.name];
      if (!s) {
        this.noSymbol('variable', e.name, e.pos, `${owner} has no constant called ${e.name}.`, `class ${owner}`);
        return ERROR;
      }
      e.ref = { to: 'lib', value: s.value };
      return s.type;
    }
    if (qualifier && e.target.k === 'name' && !this.find(e.target.name) && !this.cur.cls.fields.has(e.target.name)) {
      const slip = e.target.name.toLowerCase() === 'system' ? ' Java is picky about capital letters: write System, with a capital S.' : '';
      this.err('unknown-package', `package ${e.target.name} does not exist`, e.pos, `Java doesn't know the name ${e.target.name}.${slip}`);
      return ERROR;
    }
    const t = e.target.k === 'field' ? this.typed(e.target, () => this.fieldExpr(e.target as Expr & { k: 'field' }, true)) : this.expr(e.target);
    if (t.k === 'error') return ERROR;
    if (t.k === 'array' && e.name === 'length') {
      e.ref = { to: 'length' };
      return INT;
    }
    if (isPrimitive(t)) {
      this.err('dereference', `${typeName(t)} cannot be dereferenced`, e.pos, `${An(t)} is a plain value, so it has no variables or methods to reach with a dot.`);
      return ERROR;
    }
    if (t.k === 'class') {
      const u = this.classes.get(t.name);
      const f = u?.fields.get(e.name);
      if (f) {
        this.privateCheck(f.access, t.name, e.name, e.pos, f, this.writing === e);
        e.ref = { to: f.isStatic ? 'static' : 'field', f };
        return f.type;
      }
    }
    const help =
      isStr(t) && e.name === 'length'
        ? 'A String gets its length from a method, with parentheses: length(). Arrays are the ones that use length with no parentheses.'
        : t.k === 'class' && this.classes.get(t.name)?.methods.has(e.name)
          ? `${e.name} is a method, so it needs parentheses: ${e.name}().`
          : `${An(t)} has no variable called ${e.name}.`;
    this.noSymbol('variable', e.name, e.pos, help, this.location(e.target, t));
    return ERROR;
  }

  private typed(e: Expr, f: () => JType): JType {
    const t = f();
    e.ty = t;
    return t;
  }

  private location(target: Expr, t: JType): string {
    if (target.k === 'name' || target.k === 'field') return `variable ${target.name} of type ${typeName(t)}`;
    return `class ${typeName(t)}`;
  }

  private privateCheck(access: string, owner: string, text: string, pos: Pos, f?: FieldInfo, write = false): void {
    if (access !== 'private' || owner === this.cur.cls.name || this.opts.ignorePrivate) return;
    const getter = f ? `get${f.name[0].toUpperCase()}${f.name.slice(1)}` : '';
    const has = f && this.classes.get(owner)?.methods.has(getter);
    const help = !f
      ? `This is private, so only code inside ${owner} can call it.`
      : write
        ? `${f.name} is private, so only code inside ${owner} can change it. Call a public method of ${owner} that changes it.`
        : `${f.name} is private, so only code inside ${owner} can use it. ${has ? `Call a public method instead, such as ${getter}().` : `Add a public method to ${owner} that does what you need, and call that.`}`;
    this.err('private-access', `${text} has private access in ${owner}`, pos, help);
  }

  /** The best match among methods of one name, or null. Java tries exact and widening fits before boxing. */
  private pick<M extends { params: JType[]; varargs?: boolean }>(cands: M[], args: JType[]): M | null {
    for (const box of [false, true]) {
      const ok = cands.filter((m) => m.params.length === args.length && m.params.every((p, i) => fits(args[i], p, box)));
      if (ok.length) return ok.find((m) => ok.every((o) => o.params.every((p, i) => fits(m.params[i], p, false)))) ?? ok[0];
    }
    return cands.find((m) => m.varargs && args.length >= m.params.length && m.params.every((p, i) => fits(args[i], p, true))) ?? null;
  }

  private noMatch(kind: 'constructor' | 'method', name: string, owner: string, cands: { params: JType[] }[], args: Expr[], pos: Pos): void {
    if (args.some((a) => a.ty?.k === 'error')) return;
    const found = args.map((a) => a.ty ?? ERROR);
    if (args.some((a) => a.ty?.k === 'void')) {
      this.err('void-value', "'void' type not allowed here", pos, 'This method is void, so it gives nothing back to pass along.');
      return;
    }
    // Like javac, with one candidate of the right length, point at the argument that doesn't fit.
    const sameLength = cands.filter((c) => c.params.length === found.length);
    if (sameLength.length === 1) {
      const need = sameLength[0].params;
      const i = need.findIndex((p, j) => !fits(found[j], p, true));
      if (i >= 0) {
        this.mismatch(found[i], need[i], args[i].pos);
        return;
      }
    }
    const what = `${kind} ${name}`;
    const stray = this.classes.get(owner)?.methods.has(owner);
    if (cands.length <= 1) {
      const need = cands[0]?.params ?? [];
      const help = stray && kind === 'constructor'
        ? `${owner} has a method named ${owner}, not a constructor. A constructor has no return type: delete void.`
        : need.length
          ? `This ${kind} takes ${need.length} value${need.length === 1 ? '' : 's'} (${sigOf({ params: need })}), but you gave it ${found.length}.`
          : kind === 'constructor' && !cands.length
            ? `${owner} has no constructor yet, so Java gives it a default constructor, which takes no values. You gave it ${found.length}. To pass values in, write a constructor for ${owner} with parameters.`
            : `This ${kind} takes no values, but you gave it ${found.length}.`;
      this.err('wrong-args', `${what} in class ${owner} cannot be applied to given types;`, pos, help, [
        `  required: ${argsText(need)}`,
        `  found:    ${argsText(found)}`,
        '  reason: actual and formal argument lists differ in length',
      ]);
      return;
    }
    const why = (c: { params: JType[] }): string => {
      if (c.params.length !== found.length) return 'actual and formal argument lists differ in length';
      const i = c.params.findIndex((p, j) => !fits(found[j], p, true));
      return `argument mismatch; ${mismatchText(found[i], c.params[i])}`;
    };
    this.err(
      'wrong-args',
      `no suitable ${kind} found for ${name}(${found.map(typeName).join(',')})`,
      pos,
      `None of the ${kind}s named ${name} take these values. They take: ${cands.map((c) => `(${sigOf(c)})`).join(' or ')}.`,
      this.classes.has(owner) ? cands.flatMap((c) => [`    ${kind} ${owner}.${name}(${sigOf(c)}) is not applicable`, `      (${why(c)})`]) : undefined,
    );
  }

  private callExpr(e: Expr & { k: 'call' }): JType {
    const c = this.cur;
    const types = e.args.map((a) => this.expr(a));
    const sigText = `${e.name}(${types.map(typeName).join(',')})`;
    if (types.some((t) => t.k === 'void')) {
      this.err('void-value', "'void' type not allowed here", e.pos, 'This method is void, so it gives nothing back to pass along.');
      return ERROR;
    }

    // Unqualified: a method of this class.
    if (!e.target) {
      const own = c.cls.methods.get(e.name);
      if (own) return this.finishUser(e, own, types, c.cls, null);
      const inherited = LIB.Object.members.filter((m) => m.name === e.name);
      if (inherited.length) return this.finishLib(e, inherited, types, 'Object', []);
      const near = closest(e.name, c.cls.methods.keys());
      this.noSymbol('method', sigText, e.pos, near ? `There is no method called ${e.name} in ${c.cls.name}. Did you mean ${near}?` : `There is no method called ${e.name} in ${c.cls.name}. Check the spelling.`);
      return ERROR;
    }

    // Class.method()
    const owner = this.classRef(e.target);
    if (owner) {
      const u = this.classes.get(owner);
      if (u) {
        const list = u.methods.get(e.name);
        if (!list) {
          this.noSymbol('method', sigText, e.pos, `The class ${owner} has no method called ${e.name}.`, `class ${owner}`);
          return ERROR;
        }
        return this.finishUser(e, list, types, u, owner);
      }
      const l = LIB[owner];
      const list = l.members.filter((m) => m.name === e.name);
      if (!list.length) {
        const near = closest(e.name, l.members.map((m) => m.name));
        this.noSymbol('method', sigText, e.pos, near ? `${owner} has no method called ${e.name}. Did you mean ${near}?` : `${owner} has no method called ${e.name}.`, `class ${owner}`);
        return ERROR;
      }
      const t = this.finishLib(e, list, types, owner, []);
      if (e.lib && !e.lib.isStatic) {
        this.err('static-context', `non-static method ${e.name}(${sigOf(e.lib)}) cannot be referenced from a static context`, e.pos, `${e.name} has to be called on one value, not on the class.`);
      }
      return t;
    }

    // object.method()
    const t = e.target.k === 'field' ? this.typed(e.target, () => this.fieldExpr(e.target as Expr & { k: 'field' }, true)) : this.expr(e.target);
    if (t.k === 'error') return ERROR;
    if (isPrimitive(t) || t.k === 'void' || t.k === 'null') {
      if (t.k === 'void') this.err('void-value', 'void cannot be dereferenced', e.pos, 'This method is void, so it gives nothing back to call a method on.');
      else this.err('dereference', `${typeName(t)} cannot be dereferenced`, e.pos, `${An(t)} is a plain value, not an object, so it has no methods to call with a dot.`);
      return ERROR;
    }
    if (t.k === 'array') {
      if (e.name === 'length') {
        this.noSymbol('method', sigText, e.pos, 'An array gets its length with no parentheses: length, not length().', this.location(e.target, t));
        return ERROR;
      }
      return this.finishLib(e, LIB.Object.members.filter((m) => m.name === e.name), types, 'Object', [], e.target, t);
    }
    const u = this.classes.get(t.name);
    if (u) {
      const list = u.methods.get(e.name);
      if (list) return this.finishUser(e, list, types, u, null);
      const inherited = LIB.Object.members.filter((m) => m.name === e.name);
      if (inherited.length) return this.finishLib(e, inherited, types, 'Object', []);
      const near = closest(e.name, u.methods.keys());
      this.noSymbol('method', sigText, e.pos, near ? `${t.name} has no method called ${e.name}. Did you mean ${near}?` : `${t.name} has no method called ${e.name}. Add it to the class, or check the spelling.`, this.location(e.target, t));
      return ERROR;
    }
    const l = LIB[t.name];
    const list = [...(l?.members ?? []), ...LIB.Object.members].filter((m) => m.name === e.name);
    if (!list.length) {
      const near = closest(e.name, (l?.members ?? []).map((m) => m.name));
      this.noSymbol('method', sigText, e.pos, near ? `${typeName(t)} has no method called ${e.name}. Did you mean ${near}?` : `${typeName(t)} has no method called ${e.name}.`, this.location(e.target, t));
      return ERROR;
    }
    return this.finishLib(e, list, types, t.name, t.args);
  }

  private finishUser(e: Expr & { k: 'call' }, list: MethodInfo[], types: JType[], owner: UserClass, staticOwner: string | null): JType {
    const m = this.pick(list, types);
    if (!m) {
      this.noMatch('method', e.name, owner.name, list, e.args, e.pos);
      return list.length === 1 ? list[0].ret : ERROR;
    }
    this.privateCheck(m.access, m.owner, `${m.name}(${sigOf(m)})`, e.pos);
    if (!m.isStatic && (staticOwner || (!e.target && this.cur.isStatic))) {
      const help = staticOwner
        ? `${m.name} works on one object, so call it on an object, not on the class ${staticOwner}.`
        : `${m.name} belongs to one object, and a static method like main has no object. Make an object with new, then call the method on it.`;
      this.err('static-context', `non-static method ${m.name}(${sigOf(m)}) cannot be referenced from a static context`, e.pos, help);
    }
    e.user = m;
    e.args = e.args.map((a, i) => this.adapt(a, m.params[i]));
    return m.ret;
  }

  private finishLib(e: Expr & { k: 'call' }, list: LibMember[], types: JType[], owner: string, targs: JType[], _t?: Expr, _ty?: JType): JType {
    const subst = (t: JType): JType => {
      if (t.k === 'class' && t.name === 'E') return targs[0] ?? OBJECT;
      if (t.k === 'array') return arr(subst(t.of));
      return t;
    };
    const cands = list.map((m) => ({ ...m, erased: m.params, params: m.params.map(subst), ret: subst(m.ret) }));
    const m = this.pick(cands, types);
    if (!m) {
      this.noMatch('method', e.name, owner, cands, e.args, e.pos);
      return ERROR;
    }
    e.lib = m;
    e.args = e.args.map((a, i) => (i < m.params.length ? this.adapt(a, m.params[i]) : this.adapt(a, OBJECT)));
    return m.ret;
  }

  private newExpr(e: Expr & { k: 'new' }, want?: JType): JType {
    const types = e.args.map((a) => this.expr(a));
    const name = e.type.name;
    const c = this.classes.get(name);
    if (c) {
      if (e.type.args.length || e.type.diamond) this.err('not-generic', `type ${name} does not take parameters`, e.type.pos, `${name} is a plain class, so it needs no <>.`);
      e.cls = name;
      if (!c.ctors.length) {
        if (e.args.length) this.noMatch('constructor', name, name, [], e.args, e.pos);
        return cls(name);
      }
      const m = this.pick(c.ctors, types);
      if (!m) {
        this.noMatch('constructor', name, name, c.ctors, e.args, e.pos);
        return cls(name);
      }
      this.privateCheck(m.access, name, `${name}(${sigOf(m)})`, e.pos);
      e.user = m;
      e.args = e.args.map((a, i) => this.adapt(a, m.params[i]));
      return cls(name);
    }
    if (!this.libVisible(name, e.pos.file)) {
      this.unknownType(e.type, e.pos.file, this.cur.cls.name);
      return ERROR;
    }
    const l = LIB[name];
    if (name === 'List') {
      this.err('abstract', 'List is abstract; cannot be instantiated', e.pos, 'List only describes what a list can do. Make an ArrayList instead.');
      return ERROR;
    }
    if (!l.ctors.length) {
      this.err('private-access', `${name}() has private access in ${name}`, e.pos, `You don't make ${name} objects with new. Call its methods on the class: ${name}.something().`);
      return ERROR;
    }
    const m = this.pick(l.ctors, types);
    if (!m) {
      this.noMatch('constructor', name, name, l.ctors, e.args, e.pos);
      return ERROR;
    }
    e.lib = m;
    e.cls = name;
    e.args = e.args.map((a, i) => this.adapt(a, m.params[i]));
    const args = e.type.args.map((a) => this.resolve(a, e.pos.file, this.cur.cls.name));
    if (e.type.diamond && want?.k === 'class') return cls(name, want.args);
    return cls(name, args);
  }

  private lvalueCheck(t: Expr, isCompound: boolean): void {
    if (t.k === 'name') {
      const local = t.ref?.to === 'local' ? this.find(t.name) : undefined;
      if (local?.isFinal) this.err('final-assign', `cannot assign a value to final variable ${t.name}`, t.pos, `${t.name} is final, so it can't change after it gets its value.`);
      const f = t.ref?.to === 'field' || t.ref?.to === 'static' ? t.ref.f : undefined;
      if (f) this.finalField(f, t.pos, isCompound);
      return;
    }
    if (t.k === 'field') {
      if (t.ref?.to === 'field' || t.ref?.to === 'static') this.finalField(t.ref.f, t.pos, isCompound, t.target.k === 'this');
      else if (t.ref?.to === 'length') this.err('final-assign', 'cannot assign a value to final variable length', t.pos, 'An array keeps its length for life. Make a new array to get a different size.');
      return;
    }
    if (t.k === 'index') return;
    this.err('not-variable', 'unexpected type', t.pos, 'The left side of = has to be a variable, so Java has somewhere to store the value.', ['  required: variable', '  found:    value']);
  }

  private finalField(f: FieldInfo, pos: Pos, isCompound: boolean, viaThis = true): void {
    if (!f.isFinal) return;
    const inCtor = this.cur.isCtor && f.owner === this.cur.cls.name && !f.decl.init && viaThis && !isCompound;
    if (!inCtor) this.err('final-assign', `cannot assign a value to final variable ${f.name}`, pos, `${f.name} is final, so it can't change after it gets its value.`);
  }

  private assignExpr(e: Expr & { k: 'assign' }): JType {
    const c = this.cur;
    const tgt = e.target;
    this.writing = tgt;
    // A plain `=` fills a local: don't read it first.
    let tt: JType;
    if (tgt.k === 'name' && e.op === '=') {
      const local = this.find(tgt.name);
      if (local) {
        tgt.ref = { to: 'local', slot: local.slot };
        tgt.ty = local.type;
        tt = local.type;
      } else tt = this.expr(tgt);
    } else tt = this.expr(tgt);
    this.lvalueCheck(tgt, e.op !== '=');
    if (e.op === '=') {
      if (e.value.k === 'arrayinit') {
        this.err('illegal-expr', 'illegal start of expression', e.value.pos, 'Braces only work when you declare an array. Here, write new int[] { 1, 2, 3 }.');
        return tt;
      }
      const vt = this.expr(e.value, tt);
      e.value = this.assignTo(e.value, vt, tt);
      if (tgt.k === 'name' && tgt.ref?.to === 'local') c.set.add(tgt.ref.slot);
      return tt;
    }
    const op = e.op.slice(0, -1);
    const vt = this.expr(e.value);
    if (tt.k === 'error' || vt.k === 'error') return tt;
    if (op === '+' && isStr(tt)) {
      e.mode = 'str';
      if (vt.k === 'void') this.err('void-value', "'void' type not allowed here", e.value.pos, 'This method is void, so it gives nothing back to add.');
      return tt;
    }
    const a = unboxed(tt);
    const b = unboxed(vt);
    if (a.k === 'boolean' && b.k === 'boolean' && (op === '&' || op === '|' || op === '^')) {
      e.mode = 'bool';
      e.value = this.adapt(e.value, BOOLEAN);
      return tt;
    }
    if (!isNumeric(a) || !isNumeric(b)) {
      this.err('bad-operands', `bad operand types for binary operator '${op}'`, e.pos, `${op} doesn't work with these types.`, [`  first type:  ${typeName(tt)}`, `  second type: ${typeName(vt)}`]);
      return tt;
    }
    e.mode = promote(a, b).k as 'int' | 'long' | 'double';
    e.value = this.adapt(e.value, b);
    return tt;
  }

  private binaryExpr(e: Expr & { k: 'binary' }): JType {
    const ta = this.expr(e.a);
    const tb = this.expr(e.b);
    const op = e.op;
    if (ta.k === 'error' || tb.k === 'error') {
      return ['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(op) ? BOOLEAN : ta.k === 'error' && isStr(tb) ? STRING : isStr(ta) ? STRING : ERROR;
    }
    if (ta.k === 'void' || tb.k === 'void') {
      this.err('void-value', "'void' type not allowed here", (ta.k === 'void' ? e.a : e.b).pos, 'This method is void, so it gives nothing back to use here.');
      return ERROR;
    }
    const bad = (help: string): JType => {
      this.err('bad-operands', `bad operand types for binary operator '${op}'`, e.pos, help, [`  first type:  ${typeName(ta)}`, `  second type: ${typeName(tb)}`]);
      return ERROR;
    };
    const a = unboxed(ta);
    const b = unboxed(tb);
    const numeric = () => {
      e.a = this.adapt(e.a, a);
      e.b = this.adapt(e.b, b);
    };
    if (op === '+' && (isStr(ta) || isStr(tb))) {
      // Java joins constants when it compiles, so "h" + "i" is the same object as "hi".
      const left = this.constText(e.a);
      const right = this.constText(e.b);
      if (left !== undefined && right !== undefined) Object.assign(e, { k: 'lit', lit: 'string', value: left + right });
      e.mode = 'str';
      return STRING;
    }
    switch (op) {
      case '+':
      case '-':
      case '*':
      case '/':
      case '%':
        if (!isNumeric(a) || !isNumeric(b)) return bad(`${op} works on numbers${op === '+' ? ' and Strings' : ''}, not on these types.`);
        numeric();
        e.mode = promote(a, b).k as 'int' | 'long' | 'double';
        return promote(a, b);
      case '<':
      case '>':
      case '<=':
      case '>=':
        if (!isNumeric(a) || !isNumeric(b)) {
          const obj = [ta, tb].find((t) => t.k === 'class');
          return bad(isStr(ta) || isStr(tb) ? `${op} compares numbers. To compare Strings, use compareTo.` : obj ? `${op} compares numbers, but one side here is ${an(obj)}. Call a method on it that gives back a number.` : `${op} compares numbers, not these types.`);
        }
        numeric();
        e.mode = promote(a, b).k as 'int' | 'long' | 'double';
        return BOOLEAN;
      case '==':
      case '!=':
        if (isPrimitive(ta) || isPrimitive(tb)) {
          if (isNumeric(a) && isNumeric(b)) {
            numeric();
            e.mode = 'double';
            return BOOLEAN;
          }
          if (a.k === 'boolean' && b.k === 'boolean') {
            numeric();
            e.mode = 'bool';
            return BOOLEAN;
          }
          if ((ta.k === 'null' && isPrimitive(tb)) || (tb.k === 'null' && isPrimitive(ta))) return bad('A primitive value is never null, so this test makes no sense.');
          return bad(`${typeName(ta)} and ${typeName(tb)} can't be compared with ${op}.`);
        }
        if (!fits(ta, tb, false) && !fits(tb, ta, false)) {
          this.err('incomparable', `incomparable types: ${typeName(ta)} and ${typeName(tb)}`, e.pos, `${An(ta)} and ${an(tb)} can never be the same object.`);
          return BOOLEAN;
        }
        e.mode = 'ref';
        return BOOLEAN;
      case '&&':
      case '||':
        if (a.k !== 'boolean' || b.k !== 'boolean') return bad(`${op} joins two true or false tests. Write out both sides: x > 0 ${op} x < 10.`);
        numeric();
        e.mode = op === '&&' ? 'and' : 'or';
        return BOOLEAN;
      case '&':
      case '|':
      case '^':
        if (a.k === 'boolean' && b.k === 'boolean') {
          numeric();
          e.mode = 'bool';
          return BOOLEAN;
        }
        if ((a.k === 'int' || a.k === 'char') && (b.k === 'int' || b.k === 'char')) {
          numeric();
          e.mode = 'int';
          return INT;
        }
        return bad(`${op} doesn't work with these types.`);
      default: // shifts
        if ((a.k === 'int' || a.k === 'char') && (b.k === 'int' || b.k === 'char')) {
          numeric();
          e.mode = 'int';
          return INT;
        }
        return bad(`${op} works on ints.`);
    }
  }

  private expr1(e: Expr, want?: JType): JType {
    switch (e.k) {
      case 'lit':
        switch (e.lit) {
          case 'int':
            return INT;
          case 'long':
            return LONG;
          case 'double':
            return DOUBLE;
          case 'bool':
            return BOOLEAN;
          case 'char':
            return CHAR;
          case 'string':
            return STRING;
          default:
            return NULL;
        }
      case 'name':
        return this.nameExpr(e);
      case 'field':
        return this.fieldExpr(e);
      case 'call':
        return this.callExpr(e);
      case 'new':
        return this.newExpr(e, want);
      case 'newarray': {
        let t = this.resolve({ ...e.elem, dims: 0 }, e.pos.file, this.cur.cls.name);
        for (let i = 0; i < e.sizes.length + e.extra; i++) t = arr(t);
        e.sizes = e.sizes.map((s) => {
          const st = this.expr(s);
          if (!fits(st, INT, true)) this.mismatch(st, INT, s.pos);
          return this.adapt(s, INT);
        });
        if (e.init?.k === 'arrayinit') this.arrayInit(e.init, t);
        return t;
      }
      case 'arrayinit':
        this.err('illegal-expr', 'illegal start of expression', e.pos, 'Braces only work when you declare an array.');
        return ERROR;
      case 'index': {
        const t = this.expr(e.target);
        const it = this.expr(e.index);
        if (!fits(it, INT, true)) this.mismatch(it, INT, e.index.pos);
        e.index = this.adapt(e.index, INT);
        if (t.k === 'error') return ERROR;
        if (t.k !== 'array') {
          this.err('not-array', `array required, but ${typeName(t)} found`, e.pos, isStr(t) ? 'Use charAt(i) to read one character of a String.' : t.k === 'class' && t.name === 'ArrayList' ? 'Use get(i) to read from an ArrayList.' : 'Square brackets only work on arrays.');
          return ERROR;
        }
        return t.of;
      }
      case 'unary': {
        const t = this.expr(e.e);
        if (t.k === 'error') return ERROR;
        const u = unboxed(t);
        e.e = this.adapt(e.e, u);
        if (e.op === '!') {
          if (u.k !== 'boolean') {
            this.err('bad-operand', "bad operand type " + typeName(t) + " for unary operator '!'", e.pos, '! flips a true or false value.');
            return ERROR;
          }
          return BOOLEAN;
        }
        if (!isNumeric(u) || (e.op === '~' && u.k === 'double')) {
          this.err('bad-operand', `bad operand type ${typeName(t)} for unary operator '${e.op}'`, e.pos, `${e.op} works on numbers.`);
          return ERROR;
        }
        return u.k === 'char' ? INT : u;
      }
      case 'incdec': {
        const t = this.expr(e.e);
        if (t.k === 'error') return ERROR;
        if (e.e.k !== 'name' && e.e.k !== 'field' && e.e.k !== 'index') {
          this.err('not-variable', 'unexpected type', e.pos, `${e.op} needs a variable.`, ['  required: variable', '  found:    value']);
          return ERROR;
        }
        this.lvalueCheck(e.e, true);
        if (!isNumeric(unboxed(t))) {
          this.err('bad-operand', `bad operand type ${typeName(t)} for unary operator '${e.op}'`, e.pos, `${e.op} works on numbers.`);
          return ERROR;
        }
        return t;
      }
      case 'binary':
        return this.binaryExpr(e);
      case 'assign':
        return this.assignExpr(e);
      case 'cond': {
        e.c = this.condition(e.c);
        const ta = this.expr(e.a, want);
        const tb = this.expr(e.b, want);
        if (ta.k === 'error' || tb.k === 'error') return ta.k === 'error' ? tb : ta;
        const a = unboxed(ta);
        const b = unboxed(tb);
        let t: JType;
        if (isNumeric(a) && isNumeric(b)) t = a.k === b.k ? a : this.charConst(a, e.b) || this.charConst(b, e.a) ? CHAR : promote(a, b);
        else if (a.k === 'boolean' && b.k === 'boolean') t = BOOLEAN;
        else if (same(ta, tb)) t = ta;
        else if (ta.k === 'null') t = isPrimitive(tb) ? cls(BOX[tb.k]) : tb;
        else if (tb.k === 'null') t = isPrimitive(ta) ? cls(BOX[ta.k]) : ta;
        else if (fits(ta, tb, false)) t = tb;
        else if (fits(tb, ta, false)) t = ta;
        else t = OBJECT;
        e.a = this.adapt(e.a, t);
        e.b = this.adapt(e.b, t);
        return t;
      }
      case 'cast': {
        const to = this.resolve(e.type, e.pos.file, this.cur.cls.name);
        const from = this.expr(e.e);
        if (from.k === 'error' || to.k === 'error') return to;
        const u = unboxed(from);
        if (isPrimitive(to)) {
          if (isNumeric(to) && isNumeric(u)) {
            e.e = this.adapt(e.e, u);
            return to;
          }
          if (to.k === 'boolean' && u.k === 'boolean') {
            e.e = this.adapt(e.e, u);
            return to;
          }
          if (from.k === 'class' && from.name === 'Object') return to;
        } else if (isPrimitive(from)) {
          if (fits(from, to, true)) return to;
        } else if (fits(from, to, false) || fits(to, from, false)) return to;
        this.err('bad-cast', `incompatible types: ${typeName(from)} cannot be converted to ${typeName(to)}`, e.e.pos, `A cast can't turn ${an(from)} into ${an(to)}.`);
        return to;
      }
      case 'instanceof': {
        const from = this.expr(e.e);
        const to = this.resolve(e.type, e.pos.file, this.cur.cls.name);
        if (isPrimitive(from)) this.err('type-mismatch', `unexpected type`, e.e.pos, 'instanceof works on objects.', ['  required: reference', `  found:    ${typeName(from)}`]);
        else if (from.k !== 'error' && to.k !== 'error' && !fits(from, to, false) && !fits(to, from, false)) this.err('incomparable', `incompatible types: ${typeName(from)} cannot be converted to ${typeName(to)}`, e.pos);
        return BOOLEAN;
      }
      case 'this':
        if (this.cur.isStatic) {
          this.err('static-context', 'non-static variable this cannot be referenced from a static context', e.pos, 'this means "the object this method is running on", and a static method has no object.');
          return ERROR;
        }
        return cls(this.cur.cls.name);
      case 'conv':
        return e.ty!;
    }
  }
}

/** Parses and checks a set of files, as `javac *.java` would. */
export function compile(files: SourceFile[], opts: CompileOptions = {}): CompileResult {
  const asts: FileAst[] = [];
  const errors: CompileError[] = [];
  for (const f of files) {
    try {
      asts.push(parseFile(f.name, f.text));
    } catch (e) {
      if (!(e instanceof SyntaxStop)) throw e;
      errors.push({ ...e.error, syntax: true });
    }
  }
  if (errors.length) return { errors };
  const c = new Checker(opts);
  c.run(asts);
  if (c.errors.length) {
    // javac looks at how code flows only once everything type-checks.
    const typed = c.errors.filter((e) => !FLOW_ERRORS.has(e.code));
    return { errors: typed.length ? typed : c.errors };
  }
  return { program: { files, classes: c.classes }, errors: [] };
}
