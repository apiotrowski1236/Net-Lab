import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { BAD, GOOD, type Case } from './corpus';
import { compile, findMain, runProgram } from './index';

const hasJdk = spawnSync('javac', ['--version']).status === 0;

function sources(c: Case): { name: string; text: string }[] {
  const files: Record<string, string> = { ...(c.files ?? {}) };
  if (c.main !== undefined) {
    files['Main.java'] = `${c.head ?? ''}public class Main {\n  ${c.members ?? ''}\n  public static void main(String[] args) {\n    ${c.main}\n  }\n}\n`;
  }
  return Object.entries(files).map(([name, text]) => ({ name, text }));
}

let root = '';

/** What the real javac said, one entry per error. */
interface Diag {
  at: string;
  lines: string[];
}

function diags(id: string): Diag[] {
  const lines = readFileSync(join(root, id, 'diag.txt'), 'utf8').split('\n');
  const out: Diag[] = [];
  for (const l of lines) {
    const m = /^.*?([^/]+\.java):(\d+): error: (.*)$/.exec(l);
    if (m) out.push({ at: `${m[1]}:${m[2]}`, lines: [m[3]] });
    else if (/^\s*\^\s*$/.test(l)) out[out.length - 1]?.lines.pop(); // The caret, and the source line above it.
    else if (/^\d+ errors?$/.test(l) || l.startsWith('Note: ')) continue;
    else if (l) out[out.length - 1]?.lines.push(l);
  }
  return out;
}

beforeAll(() => {
  if (!hasJdk) return;
  root = mkdtempSync(join(tmpdir(), 'java-oracle-'));
  for (const c of [...GOOD, ...BAD]) {
    const dir = join(root, c.id);
    mkdirSync(dir);
    const files = sources(c);
    for (const f of files) writeFileSync(join(dir, f.name), f.text);
    writeFileSync(join(dir, 'main.txt'), files.some((f) => f.name === 'Main.java') ? 'Main' : files[0].name.replace('.java', ''));
  }
  execFileSync('java', ['scripts/java-oracle/Oracle.java', root], { stdio: 'pipe', maxBuffer: 1 << 26 });
}, 120_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasJdk)('programs that run', () => {
  test.each(GOOD.map((c) => [c.id, c] as const))('%s', (id, c) => {
    const real = diags(id);
    expect(real.map((d) => d.lines.join('\n'))).toEqual([]);
    const r = compile(sources(c));
    expect(r.errors.map((e) => `${e.pos.file}:${e.pos.line} ${e.msg}`)).toEqual([]);
    const main = findMain(r.program!, 'Main');
    const out = runProgram(r.program!, { mainClass: main ? 'Main' : undefined });
    const dir = join(root, id);
    expect(out.output).toBe(existsSync(join(dir, 'stdout.txt')) ? readFileSync(join(dir, 'stdout.txt'), 'utf8') : '');
    const [type, message, ...at] = readFileSync(join(dir, 'exc.txt'), 'utf8').split('\n').slice(0, -1);
    if (!type) {
      expect(out.exception).toBeUndefined();
      return;
    }
    expect(out.exception?.type).toBe(type);
    if (type === 'java.lang.StackOverflowError') return;
    expect(out.exception?.message ?? '\u0001null').toBe(message);
    expect(out.exception?.at.map((s) => `${s.cls}.${s.method}:${s.line}`)).toEqual(at);
  });
});

describe.skipIf(!hasJdk)('programs that fail to compile', () => {
  test.each(BAD.map((c) => [c.id, c] as const))('%s', (id, c) => {
    const real = diags(id);
    expect(real.length).toBeGreaterThan(0);
    const r = compile(sources(c));
    expect(r.errors.length).toBeGreaterThan(0);
    const mine = r.errors[0];
    const first = real[0];
    expect(`${mine.pos.file}:${mine.pos.line} ${mine.msg}`).toBe(`${first.at} ${first.lines[0]}`);
    expect((mine.detail ?? []).join('\n')).toBe(first.lines.slice(1).join('\n'));
    // After a syntax error javac guesses and often prints more. This stops at the first.
    if (mine.syntax) return;
    expect(r.errors.map((e) => `${e.pos.file}:${e.pos.line} ${e.msg}`)).toEqual([...new Set(real.map((d) => `${d.at} ${d.lines[0]}`))]);
  });
});
