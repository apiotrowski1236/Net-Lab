import type { Fn } from './ast';
import type { JsError, Pos } from './errors';
import type { LintNote } from './lint';

/**
 * What a running program holds. Numbers, strings, booleans, null, and undefined
 * are the real JavaScript values, so coercion and printing come out right with
 * no extra work. Everything else is one of these classes. Properties live in a
 * Map, so a key like "__proto__" is only a string, and student code has no path
 * to a real host object.
 */
export type Primitive = undefined | null | boolean | number | string;
export type Value = Primitive | JsObject | HostObject;

export class JsObject {
  readonly props = new Map<string, Value>();
}

export class JsArray extends JsObject {
  constructor(
    /** A real array, so holes, `length`, and sorting behave as they do in a browser. Only `run.ts` and `lib.ts` touch it. */
    public items: Value[] = [],
  ) {
    super();
  }
}

/** A function the student wrote. */
export class JsFunction extends JsObject {
  constructor(
    readonly fn: Fn,
    readonly scope: Scope,
    readonly name: string,
    /** Its text, which is what String(f) gives. */
    readonly source: string,
  ) {
    super();
  }
}

export type NativeRun = (self: Value, args: Value[], rt: Runtime) => Value;

/** A built-in function. */
export class JsNative extends JsObject {
  constructor(
    readonly name: string,
    readonly run: NativeRun,
  ) {
    super();
  }
}

/** Math or console: a bag of built-ins. */
export class JsNamespace extends JsObject {
  constructor(readonly name: string) {
    super();
  }
}

export type Callable = JsFunction | JsNative;

export const isCallable = (v: Value): v is Callable => v instanceof JsFunction || v instanceof JsNative;

export interface Binding {
  v: Value;
  /** 'self' is a function expression's own name, and 'fixed' is undefined, NaN, Infinity, or a host object. Writes to both are ignored, as in a browser. */
  kind: 'let' | 'const' | 'var' | 'fn' | 'param' | 'implicit' | 'self' | 'fixed';
  /** Declared, but its line hasn't run yet. */
  tdz?: boolean;
}

export class Scope {
  readonly vars = new Map<string, Binding>();
  constructor(
    readonly parent: Scope | null,
    /** The name of the function this scope starts, for the step-through. */
    readonly fnLabel?: string,
  ) {}

  find(name: string): Binding | undefined {
    for (let s: Scope | null = this; s; s = s.parent) {
      const b = s.vars.get(name);
      if (b) return b;
    }
    return undefined;
  }
}

/** What the library and host objects can ask of a running program. */
export interface Runtime {
  /** String(v), with the student's own toString if there is one. */
  str(v: Value): string;
  /** Number(v). */
  num(v: Value): number;
  prim(v: Value, hint?: 'string' | 'number'): Primitive;
  /** Calls a student's function from a built-in. */
  call(f: Value, self: Value, args: Value[]): Value;
  /** Counts `n` steps against the budget, so a built-in can't outrun it. */
  charge(n: number): void;
  /** About to build a string this long: stops if that's too much, and charges for the work. */
  checkLength(n: number): void;
  /** Stops the program with a JavaScript error, in V8's words. `help` replaces the usual plain words. */
  fail(type: string, msg: string, code?: string, help?: string): never;
  /** Stops the program: this editor leaves that out. */
  notAvailable(msg: string): never;
  array(items: Value[]): JsArray;
  /** The line running now, so a host object can say where something happened. */
  at(): Pos;
  /** Sets a global that a host owns, such as p5.js's `width`. A top-level name the student declares hides it, as in a browser. */
  global(name: string, v: Value): void;
  /** What a name means at the top level right now, or undefined. Reading it is not a step. */
  lookup(name: string): Value;
  /** While set, prompt() and confirm() stop the program with this help instead of asking. */
  holdAsks(help: string | undefined): void;
}

/**
 * What the object that owns a page gives the editor around a run. The two type
 * parameters keep this file from knowing anything about the DOM.
 */
export interface PageHooks<State = unknown, View = unknown> {
  /** The program's last line has run. Delivers events, then the recorded clicks in order. */
  finish(clicks: readonly string[], rt: Runtime): void;
  /** The page as plain JSON. `whole`: even if it's too long to save. */
  state(whole?: boolean): State;
  /** The page for a check to read. */
  view(): View;
  /** What the page noticed that a browser would have let pass without a word. */
  notes(): LintNote[];
  /** Plainer help for an error the page can say more about. */
  explain(e: JsError): string | undefined;
}

/**
 * An object from outside the language, such as `document` in a lab about the
 * DOM. Student code reaches it only through these three doors, and only with
 * the names in `allow`. Anything else stops with "not available in this editor".
 */
export abstract class HostObject {
  /** How console.log and error messages name it: "document", "<p id=intro>". */
  abstract label(): string;
  abstract readonly allow: {
    /** Properties student code may read. */
    get?: readonly string[];
    /** Properties student code may set. */
    set?: readonly string[];
    /** Methods student code may call. */
    call?: readonly string[];
  };
  get(_name: string, _rt: Runtime): Value {
    return undefined;
  }
  set(_name: string, _value: Value, _rt: Runtime): void {}
  call(_name: string, _args: Value[], _rt: Runtime): Value {
    return undefined;
  }
  /** The items for `for...of`, if this is a list. */
  items?(): Value[];
  /** A name not in `allow`. Answer with `{ value }`, as a browser answers `el.textcontent` with undefined, or nothing to stop as "not available". */
  read?(name: string, rt: Runtime): { value: Value } | undefined;
  /** Setting a name not in `allow`. True means it's handled, and false stops as "not available". */
  write?(name: string, value: Value, rt: Runtime): boolean;
  /** What String(v) gives, if that isn't `label()`. */
  asString?(): string;
  /** Set on the object that owns a page. */
  pageHooks?: PageHooks;
}

/** An array index, or -1. Array keys go through here so `arr["1"]` and `arr[1]` agree, and `arr["01"]` doesn't. */
export function arrayIndex(key: string): number {
  if (key.length === 0 || key.length > 10) return -1;
  const c = key.charCodeAt(0);
  if (c < 48 || c > 57 || (c === 48 && key.length > 1)) return -1;
  for (let i = 1; i < key.length; i++) {
    const d = key.charCodeAt(i);
    if (d < 48 || d > 57) return -1;
  }
  const n = Number(key);
  return n < 4294967295 ? n : -1;
}

/** An object's keys in the order for...in and console.log use: index-like keys first, ascending, then the rest as added. */
export function ownKeys(o: JsObject): string[] {
  const keys = [...o.props.keys()];
  if (!keys.some((k) => arrayIndex(k) >= 0)) return keys;
  const nums = keys.filter((k) => arrayIndex(k) >= 0).sort((a, b) => Number(a) - Number(b));
  return [...nums, ...keys.filter((k) => arrayIndex(k) < 0)];
}
