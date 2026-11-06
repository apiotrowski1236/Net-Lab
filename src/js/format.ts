import { HostObject, JsArray, JsFunction, JsNamespace, JsNative, ownKeys, type Value } from './values';

/** How deep console.log follows arrays and objects, and how many items of one it prints. Chrome stops at 100 too. */
const MAX_DEPTH = 6;
const MAX_ITEMS = 100;
/** The most values one line visits. A hundred arrays of a hundred arrays would otherwise take forever to print. */
const MAX_VISITS = 1500;
let visits = 0;

/** A string as Chrome prints it inside an array: single quotes, unless the text has one. */
export function quoted(s: string): string {
  const q = !s.includes("'") ? "'" : !s.includes('"') ? '"' : !s.includes('`') ? '`' : "'";
  const body = s.replace(/[\\\n\r\t]/g, (c) => ({ '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c]!);
  return q + (q === "'" ? body.replace(/'/g, "\\'") : body) + q;
}

const keyText = (k: string) => (/^(?:[$_\p{ID_Start}][$‌‍\p{ID_Continue}]*|0|[1-9]\d*)$/u.test(k) ? k : quoted(k));

const numText = (n: number) => (Object.is(n, -0) ? '-0' : String(n));

/** What a function's own text says it is. Chrome writes `ƒ` in place of the word function. */
function functionText(f: JsFunction | JsNative): string {
  if (f instanceof JsNative) return `ƒ ${f.name}() { [native code] }`;
  if (f.fn.arrow) return f.source;
  return `ƒ ${f.source.replace(/^function\s*/, '')}`;
}

function nested(v: Value, depth: number, seen: object[]): string {
  if (++visits > MAX_VISITS) return '\u2026';
  if (typeof v === 'string') return quoted(v);
  if (typeof v === 'number') return numText(v);
  if (v === undefined || v === null || typeof v === 'boolean') return String(v);
  if (v instanceof HostObject) return v.label();
  if (v instanceof JsFunction || v instanceof JsNative) return 'ƒ';
  if (v instanceof JsNamespace) return v.name;
  const isArray = v instanceof JsArray;
  const shut = isArray ? '[…]' : '{…}';
  if (depth >= MAX_DEPTH || seen.includes(v)) return shut;
  const inner = [...seen, v];
  const parts: string[] = [];
  let more = false;
  if (v instanceof JsArray) {
    const { items } = v;
    const sparse = items.length > 1000 ? Object.keys(items).length < items.length : false;
    let i = 0;
    while (i < items.length && parts.length < MAX_ITEMS) {
      if (i in items) {
        parts.push(nested(items[i], depth + 1, inner));
        i++;
        continue;
      }
      // A run of holes.
      const from = i;
      if (sparse) {
        const next = Object.keys(items)
          .map(Number)
          .find((k) => k > i);
        i = next ?? items.length;
      } else while (i < items.length && !(i in items)) i++;
      const run = i - from;
      parts.push(run === 1 ? 'empty' : `empty × ${run}`);
    }
    more = i < items.length;
  }
  for (const k of ownKeys(v)) {
    if (parts.length >= MAX_ITEMS) {
      more = true;
      break;
    }
    parts.push(`${keyText(k)}: ${nested(v.props.get(k), depth + 1, inner)}`);
  }
  if (more) parts.push('…');
  return isArray ? `[${parts.join(', ')}]` : `{${parts.join(', ')}}`;
}

/** One console.log argument. A string prints bare at the top and in quotes inside an array. */
export function logText(v: Value): string {
  if (typeof v === 'string') return v;
  if (v instanceof JsFunction || v instanceof JsNative) return functionText(v);
  return shownText(v);
}

/** A value for the step-through: strings keep their quotes, so "5" and 5 look different. */
export function shownText(v: Value): string {
  visits = 0;
  return nested(v, 0, []);
}

/** The console's %s, %d, %i, %f, and %% in a first argument. */
export function logLine(args: Value[], rt: { str(v: Value): string; num(v: Value): number }): string {
  const rest = [...args];
  let out = '';
  if (typeof rest[0] === 'string' && rest[0].includes('%')) {
    const form = rest.shift() as string;
    out = form.replace(/%([sdifoOc%])/g, (all, c: string) => {
      if (c === '%') return '%';
      if (!rest.length) return all;
      const v = rest.shift();
      switch (c) {
        case 's':
          return typeof v === 'object' && v !== null ? logText(v) : rt.str(v);
        case 'd':
        case 'i':
          return typeof v === 'object' ? 'NaN' : String(Math.trunc(rt.num(v)));
        case 'f':
          return typeof v === 'object' ? 'NaN' : String(rt.num(v));
        case 'c':
          return '';
        default:
          return logText(v);
      }
    });
    if (rest.length) out += ' ';
  }
  return out + rest.map(logText).join(' ');
}
