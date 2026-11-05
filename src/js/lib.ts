import { HostObject, JsArray, JsFunction, JsNamespace, JsNative, JsObject, isCallable, type NativeRun, type Runtime, type Value } from './values';

/**
 * The built-in library, as allowlists. A name here works. A real browser name
 * that isn't here stops with "not available", through the NOT_* sets below, so
 * nothing quietly comes back undefined. Any other name is a missing property,
 * which is undefined, as in a browser.
 */

const fn = (name: string, run: NativeRun) => new JsNative(name, run);

function table(entries: Record<string, NativeRun>): Map<string, JsNative> {
  return new Map(Object.entries(entries).map(([name, run]) => [name, fn(name, run)]));
}

const list = (s: string) => new Set(s.split(' '));

/** Names real values have that this editor leaves out. */
export const NOT_OBJECT = list('constructor __proto__ prototype __defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString valueOf');
export const NOT_ARRAY = list('copyWithin entries findLast findLastIndex flat flatMap keys reduceRight toLocaleString toReversed toSorted toSpliced values with');
export const NOT_STRING = list('anchor big blink bold charCodeAt codePointAt fixed fontcolor fontsize isWellFormed italics link localeCompare match matchAll normalize replaceAll search small strike sub substr sup toLocaleLowerCase toLocaleUpperCase toWellFormed trimEnd trimLeft trimRight trimStart');
export const NOT_NUMBER = list('toExponential toPrecision toLocaleString');
export const NOT_FUNCTION = list('apply bind call caller arguments');
export const NOT_MATH = list('acos acosh asin asinh atan atan2 atanh cbrt clz32 cos cosh exp expm1 fround hypot imul log log10 log1p log2 sign sin sinh tan tanh E LN10 LN2 LOG10E LOG2E SQRT1_2 SQRT2');
export const NOT_CONSOLE = list('assert clear count countReset debug dir dirxml group groupCollapsed groupEnd info profile profileEnd table time timeEnd timeLog timeStamp trace warn');
export const NOT_NUMBER_STATIC = list('EPSILON MAX_SAFE_INTEGER MAX_VALUE MIN_SAFE_INTEGER MIN_VALUE NEGATIVE_INFINITY NaN POSITIVE_INFINITY isFinite isNaN isSafeInteger parseFloat parseInt');
export const NOT_STRING_STATIC = list('fromCharCode fromCodePoint raw');
export const NOT_ARRAY_STATIC = list('from fromAsync of');

/** Global names a browser has and this editor doesn't. */
export const NOT_GLOBAL = list(
  'Object Date JSON Map Set WeakMap WeakSet WeakRef Symbol Promise RegExp Error TypeError RangeError ReferenceError SyntaxError EvalError URIError AggregateError BigInt Function eval Proxy Reflect Intl globalThis window self parent top frames document navigator location history localStorage sessionStorage indexedDB fetch XMLHttpRequest WebSocket Worker Notification crypto performance screen setTimeout setInterval clearTimeout clearInterval setImmediate requestAnimationFrame cancelAnimationFrame queueMicrotask structuredClone isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape ArrayBuffer SharedArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array BigInt64Array BigUint64Array Atomics WebAssembly arguments',
);

/** How V8 names a value passed where a built-in wanted a function. */
function describe(v: Value): string {
  if (typeof v === 'string') return `string "${v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return `${typeof v} ${String(v)}`;
  if (v === undefined) return 'undefined';
  if (v === null) return 'object null';
  return 'object';
}

/** How V8 writes a value in sort's error. */
function sortArg(v: Value): string {
  if (v instanceof JsArray) return '[object Array]';
  if (v instanceof JsObject) return '#<Object>';
  return v instanceof HostObject ? v.label() : String(v);
}

function callback(f: Value, rt: Runtime): Value {
  if (!isCallable(f)) rt.fail('TypeError', `${describe(f)} is not a function`, 'not-a-function');
  return f;
}

/** Numbers for a built-in's arguments, leaving undefined as it is so a default still applies. */
const nums = (a: Value[], rt: Runtime) => a.map((v) => (v === undefined ? undefined : rt.num(v)));

function arrayOf(self: Value, rt: Runtime, method: string): JsArray {
  if (!(self instanceof JsArray)) rt.notAvailable(`${method} has to be called on an array in this editor, like list.${method}().`);
  return self;
}

/** Stops `join` looping forever on an array that holds itself. */
const joining = new Set<JsArray>();

export function joinArray(a: JsArray, sep: string, rt: Runtime): string {
  if (joining.has(a)) return '';
  joining.add(a);
  try {
    const { items } = a;
    rt.charge(items.length);
    let out = '';
    for (let i = 0; i < items.length; i++) {
      if (i > 0) out += sep;
      const v = items[i];
      if (v !== undefined && v !== null) out += rt.str(v);
      rt.checkLength(out.length);
    }
    return out;
  } finally {
    joining.delete(a);
  }
}

/** Walks an array the way forEach and its relatives do: the length is fixed at the start, and `holes` says whether to visit them. */
function each(a: JsArray, rt: Runtime, holes: boolean, visit: (v: Value, i: number) => boolean | void): void {
  const n = a.items.length;
  for (let i = 0; i < n; i++) {
    rt.charge(1);
    if (!holes && !(i in a.items)) continue;
    if (visit(a.items[i], i) === true) return;
  }
}

function truthy(v: Value): boolean {
  return !!v;
}

/** The position `at` reads: negative numbers count back from the end. */
const atIndex = (a: Value[], length: number, rt: Runtime) => {
  const i = Math.trunc(rt.num(a[0])) || 0;
  return i < 0 ? i + length : i;
};

const ARRAY_RAW: Record<string, (s: JsArray, a: Value[], rt: Runtime) => Value> = {
  at: (s, a, rt) => s.items[atIndex(a, s.items.length, rt)],
  push(s, a) {
    return s.items.push(...a);
  },
  pop(s) {
    return s.items.pop();
  },
  shift(s, _a, rt) {
    rt.charge(s.items.length >> 8);
    return s.items.shift();
  },
  unshift(s, a, rt) {
    rt.charge(s.items.length >> 8);
    return s.items.unshift(...a);
  },
  indexOf(s, a, rt) {
    rt.charge(s.items.length);
    return s.items.indexOf(a[0], ...nums(a.slice(1), rt).map(Number));
  },
  lastIndexOf(s, a, rt) {
    rt.charge(s.items.length);
    return a.length > 1 ? s.items.lastIndexOf(a[0], rt.num(a[1])) : s.items.lastIndexOf(a[0]);
  },
  includes(s, a, rt) {
    rt.charge(s.items.length);
    return s.items.includes(a[0], a[1] === undefined ? undefined : rt.num(a[1]));
  },
  join(s, a, rt) {
    return joinArray(s, a[0] === undefined ? ',' : rt.str(a[0]), rt);
  },
  toString(s: JsArray, _a: Value[], rt: Runtime) {
    return joinArray(s, ',', rt);
  },
  slice(s, a, rt) {
    rt.charge(s.items.length);
    const [from, to] = nums(a, rt);
    return new JsArray(s.items.slice(from, to));
  },
  splice(s, a, rt) {
    rt.charge(s.items.length);
    const [from, count] = nums(a.slice(0, 2), rt);
    const rest = a.slice(2);
    if (a.length === 0) return new JsArray([]);
    if (a.length === 1) return new JsArray(s.items.splice(from!));
    return new JsArray(s.items.splice(from!, count ?? 0, ...rest));
  },
  concat(s, a, rt) {
    const out = s.items.slice();
    rt.charge(out.length);
    for (const v of a) {
      if (v instanceof JsArray) {
        rt.charge(v.items.length);
        const base = out.length;
        out.length = base + v.items.length;
        v.items.forEach((x, i) => {
          out[base + i] = x;
        });
      } else out.push(v);
    }
    return new JsArray(out);
  },
  reverse(s, _a, rt) {
    rt.charge(s.items.length);
    s.items.reverse();
    return s;
  },
  sort(s, a, rt) {
    const cmp = a[0];
    if (cmp !== undefined && !isCallable(cmp)) rt.fail('TypeError', `The comparison function must be either a function or undefined: ${sortArg(cmp)}`, 'bad-sort');
    rt.charge(s.items.length);
    // The real sort, so holes and undefined land where they do in a browser.
    s.items.sort((x, y) => {
      rt.charge(1);
      if (cmp !== undefined) return rt.num(rt.call(cmp, undefined, [x, y]));
      const l = rt.str(x);
      const r = rt.str(y);
      return l < r ? -1 : l > r ? 1 : 0;
    });
    return s;
  },
  forEach(s, a, rt) {
    const f = callback(a[0], rt);
    each(s, rt, false, (v, i) => void rt.call(f, undefined, [v, i, s]));
    return undefined;
  },
  map(s, a, rt) {
    const f = callback(a[0], rt);
    const out: Value[] = [];
    out.length = s.items.length;
    each(s, rt, false, (v, i) => {
      out[i] = rt.call(f, undefined, [v, i, s]);
    });
    return new JsArray(out);
  },
  filter(s, a, rt) {
    const f = callback(a[0], rt);
    const out: Value[] = [];
    each(s, rt, false, (v, i) => {
      if (truthy(rt.call(f, undefined, [v, i, s]))) out.push(v);
    });
    return new JsArray(out);
  },
  find(s, a, rt) {
    const f = callback(a[0], rt);
    let hit: Value;
    each(s, rt, true, (v, i) => {
      if (!truthy(rt.call(f, undefined, [v, i, s]))) return false;
      hit = v;
      return true;
    });
    return hit;
  },
  findIndex(s, a, rt) {
    const f = callback(a[0], rt);
    let hit = -1;
    each(s, rt, true, (v, i) => {
      if (!truthy(rt.call(f, undefined, [v, i, s]))) return false;
      hit = i;
      return true;
    });
    return hit;
  },
  some(s, a, rt) {
    const f = callback(a[0], rt);
    let hit = false;
    each(s, rt, false, (v, i) => {
      hit = truthy(rt.call(f, undefined, [v, i, s]));
      return hit;
    });
    return hit;
  },
  every(s, a, rt) {
    const f = callback(a[0], rt);
    let all = true;
    each(s, rt, false, (v, i) => {
      all = truthy(rt.call(f, undefined, [v, i, s]));
      return !all;
    });
    return all;
  },
  reduce(s, a, rt) {
    const f = callback(a[0], rt);
    let acc = a[1];
    let started = a.length > 1;
    each(s, rt, false, (v, i) => {
      if (!started) {
        acc = v;
        started = true;
      } else acc = rt.call(f, undefined, [acc, v, i, s]);
    });
    if (!started) rt.fail('TypeError', 'Reduce of empty array with no initial value', 'reduce-empty');
    return acc;
  },
  fill(s, a, rt) {
    rt.charge(s.items.length);
    const [from, to] = nums(a.slice(1), rt);
    s.items.fill(a[0], from, to);
    return s;
  },
};

export const ARRAY_METHODS = table(Object.fromEntries(Object.entries(ARRAY_RAW).map(([name, f]) => [name, (self, a, rt) => f(arrayOf(self, rt, name), a, rt)])));

function stringOf(self: Value, rt: Runtime, method: string): string {
  if (typeof self !== 'string') rt.notAvailable(`${method} has to be called on a string in this editor, like text.${method}().`);
  return self;
}

/** String methods the real engine can do once the arguments are primitives. Spreading keeps the count, which some of them care about. */
const STRING_PLAIN = ['charAt', 'indexOf', 'lastIndexOf', 'includes', 'startsWith', 'endsWith', 'slice', 'substring', 'toUpperCase', 'toLowerCase', 'trim', 'concat'] as const;

const STRING_RAW: Record<string, (s: string, a: Value[], rt: Runtime) => Value> = {
  toString: (s: string) => s,
  at: (s, a, rt) => s[atIndex(a, s.length, rt)],
  split(s, a, rt) {
    rt.charge(s.length);
    const [sep, limit] = a.map((v) => rt.prim(v));
    return new JsArray(s.split(sep as string, limit as number));
  },
  repeat(s, a, rt) {
    const n = Math.trunc(rt.num(a[0])) || 0;
    if (n < 0 || n === Infinity) rt.fail('RangeError', `Invalid count value: ${rt.str(a[0])}`, 'bad-count');
    rt.checkLength(s.length * n);
    return s.repeat(n);
  },
  replace(s, a, rt) {
    if (isCallable(a[1])) rt.notAvailable('replace with a function is not available in this editor. Use a string for the new text.');
    return s.replace(rt.str(a[0]), rt.str(a[1]));
  },
  padStart(s, a, rt) {
    const n = rt.num(a[0]);
    rt.checkLength(n);
    return s.padStart(n, a[1] === undefined ? undefined : rt.str(a[1]));
  },
  padEnd(s, a, rt) {
    const n = rt.num(a[0]);
    rt.checkLength(n);
    return s.padEnd(n, a[1] === undefined ? undefined : rt.str(a[1]));
  },
};

for (const name of STRING_PLAIN) {
  STRING_RAW[name] = (s, a, rt) => {
    const out = (String.prototype[name] as (...x: unknown[]) => string | number | boolean).apply(s, a.map((v) => rt.prim(v)));
    rt.checkLength(typeof out === 'string' ? out.length : 0);
    return out;
  };
}

export const STRING_METHODS = table(Object.fromEntries(Object.entries(STRING_RAW).map(([name, f]) => [name, (self, a, rt) => f(stringOf(self, rt, name), a, rt)])));

export const NUMBER_METHODS = table({
  toFixed(self, a, rt) {
    const n = Math.trunc(a[0] === undefined ? 0 : rt.num(a[0])) || 0;
    if (n < 0 || n > 100) rt.fail('RangeError', 'toFixed() digits argument must be between 0 and 100', 'bad-digits');
    return (self as number).toFixed(n);
  },
  toString(self: Value, a: Value[], rt: Runtime) {
    const r = a[0] === undefined ? 10 : Math.trunc(rt.num(a[0])) || 0;
    if (r < 2 || r > 36) rt.fail('RangeError', 'toString() radix argument must be between 2 and 36', 'bad-radix');
    return (self as number).toString(r);
  },
});

export const BOOLEAN_METHODS = table({ toString: (self: Value) => String(self) });

export const OBJECT_METHODS = table({ toString: (self: Value) => (self instanceof JsFunction ? self.source : self instanceof JsNative ? `function ${self.name}() { [native code] }` : '[object Object]') });

function namespace(name: string, entries: Record<string, NativeRun>, values: Record<string, Value> = {}): JsNamespace {
  const ns = new JsNamespace(name);
  for (const [k, run] of Object.entries(entries)) ns.props.set(k, fn(k, run));
  for (const [k, v] of Object.entries(values)) ns.props.set(k, v);
  return ns;
}

const math1 = (f: (x: number) => number): NativeRun => (_s, a, rt) => f(rt.num(a[0]));

/** A built-in for one run. `io` connects output and prompts to the interpreter. */
export interface LibIo {
  log(text: Value[], error: boolean): void;
  alert(text: string): void;
  ask(kind: 'prompt' | 'confirm', message: string, fallback: string): string | null;
  random(): number;
}

/** Number, String, and Array are functions with extras on them. */
function withStatics(run: NativeRun, name: string, statics: Record<string, NativeRun>): JsNative {
  const f = fn(name, run);
  for (const [k, r] of Object.entries(statics)) f.props.set(k, fn(k, r));
  return f;
}

export const STATIC_DENY: Record<string, Set<string>> = { Number: NOT_NUMBER_STATIC, String: NOT_STRING_STATIC, Array: NOT_ARRAY_STATIC, Math: NOT_MATH, console: NOT_CONSOLE };

/** The global names one run starts with. */
export function makeGlobals(io: LibIo): Map<string, Value> {
  const opt = (v: Value | undefined, rt: Runtime, fallback: string) => (v === undefined ? fallback : rt.str(v));
  const g = new Map<string, Value>([
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ]);
  const add = (name: string, run: NativeRun) => g.set(name, fn(name, run));

  add('alert', (_s, a, rt) => {
    io.alert(a.length ? rt.str(a[0]) : '');
    return undefined;
  });
  add('prompt', (_s, a, rt) => io.ask('prompt', opt(a[0], rt, ''), opt(a[1], rt, '')));
  add('confirm', (_s, a, rt) => io.ask('confirm', opt(a[0], rt, ''), '') !== null);
  add('parseInt', (_s, a, rt) => parseInt(rt.str(a[0]), a[1] === undefined ? undefined : rt.num(a[1])));
  add('parseFloat', (_s, a, rt) => parseFloat(rt.str(a[0])));
  add('isNaN', (_s, a, rt) => Number.isNaN(rt.num(a[0])));
  add('Boolean', (_s, a) => !!a[0]);
  g.set('Number', withStatics((_s, a, rt) => (a.length ? rt.num(a[0]) : 0), 'Number', { isInteger: (_s, a) => Number.isInteger(a[0]) }));
  g.set('String', withStatics((_s, a, rt) => (a.length ? rt.str(a[0]) : ''), 'String', {}));
  g.set('Array', withStatics((_s, _a, rt) => rt.notAvailable('Array() is not available in this editor. Write an array with square brackets, like [1, 2, 3].'), 'Array', { isArray: (_s, a) => a[0] instanceof JsArray }));

  g.set(
    'Math',
    namespace(
      'Math',
      {
        floor: math1(Math.floor),
        ceil: math1(Math.ceil),
        round: math1(Math.round),
        trunc: math1(Math.trunc),
        abs: math1(Math.abs),
        sqrt: math1(Math.sqrt),
        min: (_s, a, rt) => Math.min(...a.map((v) => rt.num(v))),
        max: (_s, a, rt) => Math.max(...a.map((v) => rt.num(v))),
        pow: (_s, a, rt) => Math.pow(rt.num(a[0]), rt.num(a[1])),
        random: () => io.random(),
      },
      { PI: Math.PI },
    ),
  );
  g.set(
    'console',
    namespace('console', {
      log(_s, a) {
        io.log(a, false);
        return undefined;
      },
      error(_s, a) {
        io.log(a, true);
        return undefined;
      },
    }),
  );
  return g;
}
