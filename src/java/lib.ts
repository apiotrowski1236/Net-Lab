import { formatJava } from './format';
import { arr, BOOLEAN, CHAR, cls, DOUBLE, INT, LONG, OBJECT, STRING, VOID, type JType, type LibMember } from './types';
import { JArr, JBox, JList, JStr } from './values';

/** What library code can ask of the running program. Implemented by the interpreter. */
export interface Rt {
  str(s: string): JStr;
  text(v: unknown): string;
  /** `v` as text, given its static type: a char as a character, a double as 5.0. */
  show(v: unknown, t: JType): string;
  equals(a: unknown, b: unknown): boolean;
  hash(v: unknown): number;
  print(s: string): void;
  fail(cls: string, msg: string | null): never;
  npe(what: string): never;
  random(): number;
  newArray(elem: JType, items: unknown[]): JArr;
  newList(): JList;
  exit(): never;
}

const parseT = (s: string): JType => {
  const dims = s.match(/\[\]/g)?.length ?? 0;
  const base = s.replace(/\[\]/g, '');
  const prim: Record<string, JType> = { int: INT, long: LONG, double: DOUBLE, boolean: BOOLEAN, char: CHAR, void: VOID };
  let t = prim[base] ?? cls(base);
  for (let i = 0; i < dims; i++) t = arr(t);
  return t;
};

/** One library member from a signature like "static double pow(double,double)". */
function sig(owner: string, s: string, run: LibMember['run']): LibMember {
  const m = /^(static )?(?:(\S+) )?(\w+)\(([^)]*)\)(\.\.\.)?$/.exec(s);
  if (!m) throw new Error(`Bad library signature: ${s}`);
  return { name: m[3], params: m[4] ? m[4].split(',').map(parseT) : [], ret: m[2] ? parseT(m[2]) : cls(owner), isStatic: !!m[1], owner, varargs: !!m[5], run };
}

export interface LibClass {
  name: string;
  /** Needs this import. */
  pkg?: string;
  /** Takes a type argument, written E in signatures. */
  generic?: boolean;
  members: LibMember[];
  ctors: LibMember[];
  statics: Record<string, { type: JType; value: () => unknown }>;
}

const lib = (name: string, opts: { pkg?: string; generic?: boolean; statics?: LibClass['statics'] } = {}) => {
  const c: LibClass = { name, pkg: opts.pkg, generic: opts.generic, members: [], ctors: [], statics: opts.statics ?? {} };
  LIB[name] = c;
  return {
    c,
    m(s: string, run: LibMember['run']) {
      c.members.push(sig(name, s, run));
      return this;
    },
    /** A constructor: the signature has no return type. */
    make(s: string, run: LibMember['run']) {
      c.ctors.push(sig(name, s.replace(/^/, ''), run));
      return this;
    },
  };
};

export const LIB: Record<string, LibClass> = {};

const s = (v: unknown, rt: Rt, what = 'a String'): string => {
  if (v === null) rt.npe(what);
  return (v as JStr).v;
};
const unboxArg = (a: unknown) => (a instanceof JBox ? { box: a.box, v: a.v } : null);
const need = (a: unknown, rt: Rt): void => {
  if (a === null) rt.npe('a value');
};

// --- Object ---

lib('Object')
  .make('Object()', () => {
    throw new Error('handled by the interpreter');
  })
  .m('String toString()', (self, _a, rt) => rt.str(rt.text(self)))
  .m('boolean equals(Object)', (self, [o], rt) => rt.equals(self, o))
  .m('int hashCode()', (self, _a, rt) => rt.hash(self));

// --- String ---

function checkIndex(i: number, n: number, rt: Rt): void {
  if (i < 0 || i >= n) rt.fail('StringIndexOutOfBoundsException', `Index ${i} out of bounds for length ${n}`);
}
function checkRange(a: number, b: number, n: number, rt: Rt): void {
  if (a < 0 || b > n || a > b) rt.fail('StringIndexOutOfBoundsException', `Range [${a}, ${b}) out of bounds for length ${n}`);
}
const javaCompare = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a.charCodeAt(i) - b.charCodeAt(i);
  return a.length - b.length;
};

lib('String')
  .make('String()', (_s, _a, rt) => rt.str(''))
  .make('String(String)', (_s, [o], rt) => rt.str(s(o, rt)))
  .m('int length()', (t) => t.v.length)
  .m('boolean isEmpty()', (t) => t.v.length === 0)
  .m('boolean isBlank()', (t) => t.v.trim().length === 0)
  .m('char charAt(int)', (t, [i], rt) => {
    checkIndex(i, t.v.length, rt);
    return t.v.charCodeAt(i);
  })
  .m('String substring(int)', (t, [a], rt) => {
    checkRange(a, t.v.length, t.v.length, rt);
    return rt.str(t.v.slice(a));
  })
  .m('String substring(int,int)', (t, [a, b], rt) => {
    checkRange(a, b, t.v.length, rt);
    return rt.str(t.v.slice(a, b));
  })
  .m('int indexOf(String)', (t, [o], rt) => t.v.indexOf(s(o, rt)))
  .m('int indexOf(String,int)', (t, [o, from], rt) => t.v.indexOf(s(o, rt), from))
  .m('int indexOf(int)', (t, [c]) => t.v.indexOf(String.fromCharCode(c)))
  .m('int lastIndexOf(String)', (t, [o], rt) => t.v.lastIndexOf(s(o, rt)))
  .m('int lastIndexOf(int)', (t, [c]) => t.v.lastIndexOf(String.fromCharCode(c)))
  .m('boolean equals(Object)', (t, [o]) => o instanceof JStr && o.v === t.v)
  .m('boolean equalsIgnoreCase(String)', (t, [o]) => o instanceof JStr && o.v.toLowerCase() === t.v.toLowerCase())
  .m('int compareTo(String)', (t, [o], rt) => javaCompare(t.v, s(o, rt)))
  .m('int compareToIgnoreCase(String)', (t, [o], rt) => javaCompare(t.v.toLowerCase(), s(o, rt).toLowerCase()))
  .m('boolean contains(String)', (t, [o], rt) => t.v.includes(s(o, rt)))
  .m('boolean startsWith(String)', (t, [o], rt) => t.v.startsWith(s(o, rt)))
  .m('boolean endsWith(String)', (t, [o], rt) => t.v.endsWith(s(o, rt)))
  .m('String toUpperCase()', (t, _a, rt) => rt.str(t.v.toUpperCase()))
  .m('String toLowerCase()', (t, _a, rt) => rt.str(t.v.toLowerCase()))
  .m('String trim()', (t, _a, rt) => rt.str(t.v.trim()))
  .m('String strip()', (t, _a, rt) => rt.str(t.v.trim()))
  .m('String concat(String)', (t, [o], rt) => rt.str(t.v + s(o, rt)))
  .m('String repeat(int)', (t, [n], rt) => {
    if (n < 0) rt.fail('IllegalArgumentException', `count is negative: ${n}`);
    return rt.str(t.v.repeat(n));
  })
  .m('String replace(String,String)', (t, [a, b], rt) => rt.str(t.v.split(s(a, rt)).join(s(b, rt))))
  .m('String replace(char,char)', (t, [a, b], rt) => rt.str(t.v.split(String.fromCharCode(a)).join(String.fromCharCode(b))))
  .m('String[] split(String)', (t, [o], rt) => {
    const parts = t.v.split(new RegExp(s(o, rt)));
    while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    return rt.newArray(STRING, parts.map((p: string) => rt.str(p)));
  })
  .m('String toString()', (t) => t)
  .m('int hashCode()', (t, _a, rt) => rt.hash(t))
  .m('static String valueOf(int)', (_t, [v], rt) => rt.str(rt.show(v, INT)))
  .m('static String valueOf(long)', (_t, [v], rt) => rt.str(rt.show(v, LONG)))
  .m('static String valueOf(double)', (_t, [v], rt) => rt.str(rt.show(v, DOUBLE)))
  .m('static String valueOf(boolean)', (_t, [v], rt) => rt.str(rt.show(v, BOOLEAN)))
  .m('static String valueOf(char)', (_t, [v], rt) => rt.str(rt.show(v, CHAR)))
  .m('static String valueOf(Object)', (_t, [v], rt) => rt.str(rt.text(v)))
  .m('static String format(String)...', (_t, [f, ...rest], rt) => rt.str(formatJava(s(f, rt), rest, rt, unboxArg)));

// --- Math ---

const roundJava = (d: number) => (Number.isNaN(d) ? 0 : Math.floor(d + 0.5));

lib('Math', {
  statics: { PI: { type: DOUBLE, value: () => Math.PI }, E: { type: DOUBLE, value: () => Math.E } },
})
  .m('static int abs(int)', (_t, [v]) => Math.abs(v) | 0)
  .m('static long abs(long)', (_t, [v]) => Math.abs(v))
  .m('static double abs(double)', (_t, [v]) => Math.abs(v))
  .m('static double pow(double,double)', (_t, [a, b]) => a ** b)
  .m('static double sqrt(double)', (_t, [v]) => Math.sqrt(v))
  .m('static double cbrt(double)', (_t, [v]) => Math.cbrt(v))
  .m('static int max(int,int)', (_t, [a, b]) => Math.max(a, b))
  .m('static long max(long,long)', (_t, [a, b]) => Math.max(a, b))
  .m('static double max(double,double)', (_t, [a, b]) => Math.max(a, b))
  .m('static int min(int,int)', (_t, [a, b]) => Math.min(a, b))
  .m('static long min(long,long)', (_t, [a, b]) => Math.min(a, b))
  .m('static double min(double,double)', (_t, [a, b]) => Math.min(a, b))
  .m('static double floor(double)', (_t, [v]) => Math.floor(v))
  .m('static double ceil(double)', (_t, [v]) => Math.ceil(v))
  .m('static long round(double)', (_t, [v]) => roundJava(v))
  .m('static double random()', (_t, _a, rt) => rt.random())
  .m('static double sin(double)', (_t, [v]) => Math.sin(v))
  .m('static double cos(double)', (_t, [v]) => Math.cos(v))
  .m('static double tan(double)', (_t, [v]) => Math.tan(v))
  .m('static double log(double)', (_t, [v]) => Math.log(v))
  .m('static double log10(double)', (_t, [v]) => Math.log10(v))
  .m('static double exp(double)', (_t, [v]) => Math.exp(v))
  .m('static double hypot(double,double)', (_t, [a, b]) => Math.hypot(a, b))
  .m('static double toRadians(double)', (_t, [v]) => (v / 180) * Math.PI)
  .m('static double toDegrees(double)', (_t, [v]) => (v * 180) / Math.PI);

// --- Wrappers ---

const parseInteger = (o: unknown, rt: Rt): number => {
  const t = o === null ? 'null' : (o as JStr).v;
  if (!/^[+-]?\d+$/.test(t) || Math.abs(Number(t)) > 2147483648 || Number(t) === 2147483648) {
    rt.fail('NumberFormatException', t === 'null' ? 'Cannot parse null string: null' : `For input string: "${t}"`);
  }
  return Number(t);
};
const parseDouble = (o: unknown, rt: Rt): number => {
  const t = s(o, rt).trim();
  if (t === '' || Number.isNaN(Number(t))) rt.fail('NumberFormatException', t === '' ? 'empty String' : `For input string: "${t}"`);
  return Number(t);
};

lib('Integer', { statics: { MAX_VALUE: { type: INT, value: () => 2147483647 }, MIN_VALUE: { type: INT, value: () => -2147483648 } } })
  .m('static int parseInt(String)', (_t, [o], rt) => parseInteger(o, rt))
  .m('static Integer valueOf(int)', (_t, [v]) => new JBox('Integer', v))
  .m('static String toString(int)', (_t, [v], rt) => rt.str(rt.show(v, INT)))
  .m('int intValue()', (t) => t.v)
  .m('double doubleValue()', (t) => t.v)
  .m('int compareTo(Integer)', (t, [o], rt) => {
    need(o, rt);
    return Math.sign(t.v - (o as JBox as { v: number }).v);
  })
  .m('boolean equals(Object)', (t, [o]) => o instanceof JBox && o.box === 'Integer' && o.v === t.v)
  .m('String toString()', (t, _a, rt) => rt.str(rt.show(t.v, INT)))
  .m('int hashCode()', (t) => t.v);
lib('Long');
lib('Double', { statics: { MAX_VALUE: { type: DOUBLE, value: () => Number.MAX_VALUE }, MIN_VALUE: { type: DOUBLE, value: () => Number.MIN_VALUE } } })
  .m('static double parseDouble(String)', (_t, [o], rt) => parseDouble(o, rt))
  .m('static Double valueOf(double)', (_t, [v]) => new JBox('Double', v))
  .m('static String toString(double)', (_t, [v], rt) => rt.str(rt.show(v, DOUBLE)))
  .m('double doubleValue()', (t) => t.v)
  .m('int intValue()', (t) => Math.trunc(t.v))
  .m('int compareTo(Double)', (t, [o], rt) => {
    need(o, rt);
    return Math.sign(t.v - (o as JBox as { v: number }).v);
  })
  .m('boolean equals(Object)', (t, [o]) => o instanceof JBox && o.box === 'Double' && o.v === t.v)
  .m('String toString()', (t, _a, rt) => rt.str(rt.show(t.v, DOUBLE)));
lib('Boolean')
  .m('static boolean parseBoolean(String)', (_t, [o]) => o instanceof JStr && o.v.toLowerCase() === 'true')
  .m('boolean booleanValue()', (t) => t.v)
  .m('boolean equals(Object)', (t, [o]) => o instanceof JBox && o.box === 'Boolean' && o.v === t.v)
  .m('String toString()', (t, _a, rt) => rt.str(String(t.v)));
const ch = (c: number) => String.fromCharCode(c);
lib('Character')
  .m('static boolean isDigit(char)', (_t, [c]) => /\d/.test(ch(c)))
  .m('static boolean isLetter(char)', (_t, [c]) => /\p{L}/u.test(ch(c)))
  .m('static boolean isLetterOrDigit(char)', (_t, [c]) => /[\p{L}\d]/u.test(ch(c)))
  .m('static boolean isUpperCase(char)', (_t, [c]) => /\p{Lu}/u.test(ch(c)))
  .m('static boolean isLowerCase(char)', (_t, [c]) => /\p{Ll}/u.test(ch(c)))
  .m('static boolean isWhitespace(char)', (_t, [c]) => /\s/.test(ch(c)))
  .m('static char toUpperCase(char)', (_t, [c]) => ch(c).toUpperCase().charCodeAt(0))
  .m('static char toLowerCase(char)', (_t, [c]) => ch(c).toLowerCase().charCodeAt(0))
  .m('static int getNumericValue(char)', (_t, [c]) => (/\d/.test(ch(c)) ? c - 48 : -1))
  .m('static String toString(char)', (_t, [c], rt) => rt.str(ch(c)))
  .m('char charValue()', (t) => t.v)
  .m('boolean equals(Object)', (t, [o]) => o instanceof JBox && o.box === 'Character' && o.v === t.v)
  .m('String toString()', (t, _a, rt) => rt.str(ch(t.v)));

// --- System ---

const printers = (name: 'print' | 'println', end: string) => {
  const types: [string, JType][] = [['int', INT], ['long', LONG], ['double', DOUBLE], ['boolean', BOOLEAN], ['char', CHAR], ['String', STRING], ['Object', OBJECT]];
  return types.map(([t, ty]) => sig('PrintStream', `void ${name}(${t})`, (_s, [v], rt: Rt) => rt.print(rt.show(v, ty) + end)));
};
const stream = lib('PrintStream')
  .m('void println()', (_s, _a, rt) => rt.print('\n'))
  .m('void printf(String)...', (_s, [f, ...rest], rt) => rt.print(formatJava(s(f, rt), rest, rt, unboxArg)))
  .m('void flush()', () => undefined);
stream.c.members.push(...printers('println', '\n'), ...printers('print', ''));

lib('System', {
  statics: { out: { type: cls('PrintStream'), value: () => 'stream' }, err: { type: cls('PrintStream'), value: () => 'stream' } },
})
  .m('static void exit(int)', (_t, _a, rt) => rt.exit())
  .m('static long currentTimeMillis()', () => 0)
  .m('static long nanoTime()', () => 0);

// --- ArrayList ---

const bound = (i: number, n: number, rt: Rt) => {
  if (i < 0 || i >= n) rt.fail('IndexOutOfBoundsException', `Index ${i} out of bounds for length ${n}`);
};
const listLike = (name: string) => {
  const l = lib(name, { pkg: 'java.util', generic: true })
    .m('boolean add(E)', (t: JList, [v]) => {
      t.items.push(v);
      t.mods++;
      return true;
    })
    .m('void add(int,E)', (t: JList, [i, v], rt) => {
      if (i < 0 || i > t.items.length) rt.fail('IndexOutOfBoundsException', `Index: ${i}, Size: ${t.items.length}`);
      t.items.splice(i, 0, v);
      t.mods++;
    })
    .m('E get(int)', (t: JList, [i], rt) => {
      bound(i, t.items.length, rt);
      return t.items[i];
    })
    .m('E set(int,E)', (t: JList, [i, v], rt) => {
      bound(i, t.items.length, rt);
      const old = t.items[i];
      t.items[i] = v;
      return old;
    })
    .m('E remove(int)', (t: JList, [i], rt) => {
      bound(i, t.items.length, rt);
      t.mods++;
      return t.items.splice(i, 1)[0];
    })
    .m('boolean remove(Object)', (t: JList, [v], rt) => {
      const i = t.items.findIndex((x) => rt.equals(v, x));
      if (i < 0) return false;
      t.items.splice(i, 1);
      t.mods++;
      return true;
    })
    .m('int size()', (t: JList) => t.items.length)
    .m('boolean isEmpty()', (t: JList) => t.items.length === 0)
    .m('boolean contains(Object)', (t: JList, [v], rt) => t.items.some((x) => rt.equals(v, x)))
    .m('int indexOf(Object)', (t: JList, [v], rt) => t.items.findIndex((x) => rt.equals(v, x)))
    .m('void clear()', (t: JList) => {
      t.items = [];
      t.mods++;
    })
    .m('String toString()', (t, _a, rt) => rt.str(rt.text(t)))
    .m('boolean equals(Object)', (t, [o], rt) => rt.equals(t, o))
    .m('int hashCode()', (t, _a, rt) => rt.hash(t));
  return l;
};
listLike('ArrayList')
  .make('ArrayList()', (_s, _a, rt) => rt.newList())
  .make('ArrayList(int)', (_s, _a, rt) => rt.newList())
  .make('ArrayList(ArrayList)', (_s, [o], rt) => {
    need(o, rt);
    const l = rt.newList();
    l.items = [...(o as JList).items];
    return l;
  });
listLike('List');

lib('Arrays', { pkg: 'java.util' })
  .m('static String toString(Object)', (_t, [a], rt) => {
    if (a === null) return rt.str('null');
    const x = a as JArr;
    return rt.str(`[${x.items.map((v) => rt.show(v, x.elem)).join(', ')}]`);
  })
  .m('static void sort(Object)', (_t, [a], rt) => {
    need(a, rt);
    const x = a as JArr;
    if (x.elem.k === 'class') x.items.sort((p, q) => javaCompare(s(p, rt), s(q, rt)));
    else x.items.sort((p, q) => (p as number) - (q as number));
  });

// --- Exceptions a student can throw ---

export const EXCEPTIONS: Record<string, string> = {
  RuntimeException: 'Object',
  IllegalArgumentException: 'RuntimeException',
  IllegalStateException: 'RuntimeException',
  ArithmeticException: 'RuntimeException',
  NullPointerException: 'RuntimeException',
  IndexOutOfBoundsException: 'RuntimeException',
  ArrayIndexOutOfBoundsException: 'IndexOutOfBoundsException',
  StringIndexOutOfBoundsException: 'IndexOutOfBoundsException',
  ClassCastException: 'RuntimeException',
  NumberFormatException: 'IllegalArgumentException',
  UnsupportedOperationException: 'RuntimeException',
};
for (const name of Object.keys(EXCEPTIONS)) {
  lib(name)
    .make(`${name}()`, () => null)
    .make(`${name}(String)`, () => null)
    .m('String getMessage()', (t, _a, rt) => (t.msg === null ? null : rt.str(t.msg)))
    .m('String toString()', (t, _a, rt) => rt.str(rt.text(t)));
}

/** Classes that exist in Java but not here, with what to say instead of "cannot find symbol". */
export const MISSING_CLASSES: Record<string, string> = {
  Scanner: 'This editor has no keyboard input, so Scanner does not run here. Put the values right in your code.',
  HashMap: 'HashMap is not part of AP CSA, and this editor does not run it. Use an ArrayList instead.',
  Random: 'This editor does not run the Random class. Use Math.random() instead.',
};
