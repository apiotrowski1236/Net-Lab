import vm from 'node:vm';
import { describe, expect, test } from 'vitest';
import { GOOD, SYNTAX } from './corpus';
import { runFiles } from './index';

/**
 * Chrome's console format for real values. It's written apart from format.ts on
 * purpose: this one reads real objects, and that one reads the interpreter's.
 */
function chromeFormat(v: unknown, top = true, depth = 0, seen: unknown[] = []): string {
  if (typeof v === 'string') {
    if (top) return v;
    const q = !v.includes("'") ? "'" : !v.includes('"') ? '"' : !v.includes('`') ? '`' : "'";
    let body = v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    if (q === "'") body = body.replace(/'/g, "\\'");
    return q + body + q;
  }
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'function') {
    if (!top) return 'ƒ';
    const text = Function.prototype.toString.call(v);
    return /^(?:function\b)/.test(text) ? `ƒ ${text.replace(/^function\s*/, '')}` : text;
  }
  if (typeof v !== 'object' || v === null) return String(v);
  const open = Array.isArray(v) ? '[' : '{';
  const close = Array.isArray(v) ? ']' : '}';
  if (depth >= 6 || seen.includes(v)) return `${open}…${close}`;
  const inner = [...seen, v];
  const parts: string[] = [];
  const keyOf = (k: string) => (/^(?:[$_\p{ID_Start}][$‌‍\p{ID_Continue}]*|0|[1-9]\d*)$/u.test(k) ? k : chromeFormat(k, false));
  let more = false;
  const keys = Object.keys(v);
  if (Array.isArray(v)) {
    let i = 0;
    while (i < v.length && parts.length < 100) {
      if (i in v) {
        parts.push(chromeFormat(v[i], false, depth + 1, inner));
        i++;
      } else {
        let run = 0;
        while (i < v.length && !(i in v)) {
          run++;
          i++;
        }
        parts.push(run === 1 ? 'empty' : `empty × ${run}`);
      }
    }
    more = i < v.length;
  }
  for (const k of keys) {
    if (Array.isArray(v) && /^(?:0|[1-9]\d*)$/.test(k)) continue;
    if (parts.length >= 100) {
      more = true;
      break;
    }
    parts.push(`${keyOf(k)}: ${chromeFormat((v as Record<string, unknown>)[k], false, depth + 1, inner)}`);
  }
  if (more) parts.push('…');
  return open + parts.join(', ') + close;
}

function consoleLine(args: unknown[]): string {
  const rest = [...args];
  let out = '';
  if (typeof rest[0] === 'string' && rest[0].includes('%')) {
    const form = rest.shift() as string;
    out = form.replace(/%([sdifoOc%])/g, (all, c: string) => {
      if (c === '%') return '%';
      if (!rest.length) return all;
      const v = rest.shift();
      if (c === 's') return typeof v === 'object' && v !== null ? chromeFormat(v) : String(v);
      if (c === 'd' || c === 'i') return typeof v === 'object' ? 'NaN' : String(Math.trunc(Number(v)));
      if (c === 'f') return typeof v === 'object' ? 'NaN' : String(Number(v));
      if (c === 'c') return '';
      return chromeFormat(v);
    });
    if (rest.length) out += ' ';
  }
  return out + rest.map((v) => chromeFormat(v)).join(' ');
}

interface Outcome {
  lines: string[];
  error?: string;
}

function lineOf(e: Error): string {
  const m = /s\.js:(\d+)/.exec(e.stack ?? '');
  return m ? m[1] : '?';
}

function realRun(code: string, answers: (string | null)[] = []): Outcome {
  const lines: string[] = [];
  const q = [...answers];
  const opt = (v: unknown) => (v === undefined ? '' : String(v));
  const sandbox = {
    alert: (...a: unknown[]) => void lines.push(`alert: ${a.length ? String(a[0]) : ''}`),
    prompt: (m?: unknown) => {
      const answer = q.shift() as string | null;
      lines.push(`prompt: ${opt(m)} = ${answer}`);
      return answer;
    },
    confirm: (m?: unknown) => {
      const answer = q.shift() as string | null;
      lines.push(`confirm: ${opt(m)} = ${answer}`);
      return answer !== null;
    },
    console: {
      log: (...a: unknown[]) => void lines.push(`log: ${consoleLine(a)}`),
      error: (...a: unknown[]) => void lines.push(`error: ${consoleLine(a)}`),
    },
  };
  try {
    new vm.Script(code, { filename: 's.js' }).runInNewContext(sandbox, { timeout: 5000 });
    return { lines };
  } catch (e) {
    const err = e as Error;
    return { lines, error: `${err.name}: ${err.message} @${lineOf(err)}` };
  }
}

function mine(code: string, answers: (string | null)[] = []): Outcome {
  const r = runFiles([{ name: 's.js', text: code }], { answers });
  const lines = r.lines.map((l) => {
    if (l.kind === 'prompt' || l.kind === 'confirm') return `${l.kind}: ${l.text} = ${l.answer}`;
    return `${l.kind === 'alert' ? 'alert' : l.error ? 'error' : 'log'}: ${l.text}`;
  });
  if (r.status === 'limit' || r.status === 'waiting') return { lines, error: `stopped: ${r.limit?.text ?? 'waiting'}` };
  return { lines, ...(r.error ? { error: `${r.error.type}: ${r.error.msg} @${r.error.pos.line}` } : {}) };
}

describe('the same as real JavaScript', () => {
  for (const c of GOOD) {
    test(c.code.slice(0, 100).replace(/\n/g, ' '), () => {
      expect(mine(c.code, c.answers)).toEqual(realRun(c.code, c.answers));
    });
  }
});

describe('the same syntax errors as V8', () => {
  for (const code of SYNTAX) {
    test(code.replace(/\n/g, ' '), () => {
      const real = realRun(code).error;
      expect(real).toMatch(/^SyntaxError/);
      expect(mine(code).error).toBe(real);
    });
  }
});
