import { describe, expect, it } from 'vitest';
import { firstUnmet, jsModel, traceOf, type JsState } from './js';
import type { DemoInput, JsSpec } from './types';

const spec = (text: string, more: Partial<JsSpec> = {}): JsSpec => ({ kind: 'js', id: 'code', title: 'Code', files: [{ name: 'script.js', text }], step: true, ...more });

function play(s: JsSpec, inputs: DemoInput[], from = jsModel.init(s)): JsState {
  let state = from;
  for (const input of inputs) {
    state = jsModel.apply(s, state, input);
    // Saved progress is JSON, so every state has to survive it.
    state = JSON.parse(JSON.stringify(state));
  }
  return state;
}

const printed = (s: JsState) => s.last?.lines.map((l) => l.text);

describe('run', () => {
  it('shows alert and console.log together, in order', () => {
    const s = play(spec('alert([1, 2]);\nconsole.log([1, "a"]);\nalert("hi");\n'), [{ run: true }]);
    expect(s.last?.lines.map((l) => [l.kind, l.text])).toEqual([
      ['alert', '1,2'],
      ['log', "[1, 'a']"],
      ['alert', 'hi'],
    ]);
    expect(jsModel.facts(spec(''), s)).toMatchObject({ runs: 1, ok: true, waiting: false, error: '', output: "1,2\n[1, 'a']\nhi" });
  });

  it('keeps the output from before a crash, with the error', () => {
    const s = play(spec('console.log("before");\nnope();\n'), [{ run: true }]);
    expect(printed(s)).toEqual(['before']);
    expect(s.last?.error).toMatchObject({ type: 'ReferenceError', msg: 'nope is not defined', pos: { line: 2 } });
    expect(jsModel.facts(spec(''), s)).toMatchObject({ ok: false, error: 'not-defined', errorType: 'ReferenceError' });
  });

  it('gives Math.random a new seed for each Run, and the same one for reruns inside a Run', () => {
    const d = spec('console.log(Math.random());\nprompt("Next?");\nconsole.log(Math.random());\n');
    const first = play(d, [{ run: true }]);
    const answered = play(d, [{ answer: 'x' }], first);
    expect(printed(answered)?.[0]).toBe(printed(first)?.[0]);
    const second = play(d, [{ run: true }], answered);
    expect(printed(second)?.[0]).not.toBe(printed(first)?.[0]);
    expect(play(d, [{ run: true }, { answer: 'x' }, { run: true }])).toEqual(second);
  });

  it('stops an endless loop and says so', () => {
    const s = play(spec('let i = 0;\nwhile (i < 5) {\n  console.log("x");\n}\n'), [{ run: true }]);
    expect(s.last?.status).toBe('limit');
    expect(jsModel.facts(spec(''), s).limit).toBeTruthy();
  });
});

describe('prompts', () => {
  const d = spec('let name = prompt("Name?", "Sam");\nlet sure = confirm("Sure?");\nconsole.log(name, sure);\n');

  it('stops at each prompt and carries on from the top with the answers', () => {
    let s = play(d, [{ run: true }]);
    expect(s.waiting).toEqual({ kind: 'prompt', message: 'Name?', default: 'Sam' });
    expect(s.last?.status).toBe('waiting');
    expect(jsModel.facts(d, s).waiting).toBe(true);
    s = play(d, [{ answer: 'Ann' }], s);
    expect(s.waiting).toEqual({ kind: 'confirm', message: 'Sure?', default: '' });
    s = play(d, [{ answer: '' }], s);
    expect(s.waiting).toBeUndefined();
    expect(s.last?.lines.map((l) => l.kind)).toEqual(['prompt', 'confirm', 'log']);
    expect(s.last?.lines[2].text).toBe('Ann true');
    expect(s.runs).toBe(1);
  });

  it('gives null for Cancel, and false for a confirm', () => {
    const s = play(d, [{ run: true }, { answer: null }, { answer: null }]);
    expect(printed(s)?.[2]).toBe('null false');
  });

  it('does not duplicate output when it reruns', () => {
    const e = spec('console.log("start");\nprompt("a");\nprompt("b");\nconsole.log("end");\n');
    const s = play(e, [{ run: true }, { answer: '1' }, { answer: '2' }]);
    expect(s.last?.lines.filter((l) => l.kind === 'log').map((l) => l.text)).toEqual(['start', 'end']);
  });

  it('restores a waiting prompt from saved state', () => {
    const saved = JSON.stringify(play(d, [{ run: true }]));
    const s = play(d, [{ answer: 'Ann' }], JSON.parse(saved));
    expect(s.answers).toEqual(['Ann']);
    expect(s.waiting?.kind).toBe('confirm');
  });

  it('ignores an answer nobody asked for', () => {
    const s = play(d, []);
    expect(jsModel.apply(d, s, { answer: 'x' })).toBe(s);
  });

  it('drops the prompt when the code changes', () => {
    const s = play(d, [{ run: true }, { edit: 'script.js', code: 'console.log(1);\n' }]);
    expect(s.waiting).toBeUndefined();
    expect(s.edited).toBe(true);
    expect(s.answers).toEqual([]);
    expect(jsModel.apply(d, s, { answer: 'x' })).toBe(s);
  });

  it('waits for the last answer before it judges the run', () => {
    const c = spec('let a = prompt("n");\nlet b = a + 1;\nconsole.log(b);\n', { checks: [{ id: 'one', label: 'One', test: (x) => (x.text === '51' ? undefined : 'Not yet.') }] });
    const asked = play(c, [{ run: true }]);
    expect(asked.checks).toBeUndefined();
    expect(asked.notes).toBeUndefined();
    const done = play(c, [{ answer: '5' }], asked);
    expect(done.checks).toEqual([{ id: 'one', ok: true }]);
  });
});

describe('files', () => {
  const two: JsSpec = { kind: 'js', id: 'code', title: 'Code', files: [{ name: 'lib.js', text: 'function twice(n) {\n  return n * 2;\n}\n' }, { name: 'script.js', text: 'console.log(twice(4));\n' }, { name: 'data.js', text: 'let x = 1;\n', locked: true }], open: 'script.js' };

  it('runs the files in order, and shares their names', () => {
    expect(printed(play(two, [{ run: true }]))).toEqual(['8']);
  });

  it('opens the right tab, records tabs, and leaves a locked file alone', () => {
    const s = play(two, [{ tab: 'lib.js' }, { edit: 'data.js', code: 'nope' }]);
    expect(s.open).toBe('lib.js');
    expect(jsModel.facts(two, s)['opened:lib.js']).toBe(true);
    expect(s.files[2].text).toBe('let x = 1;\n');
  });

  it('does not run a file that is not JavaScript', () => {
    const page: JsSpec = { ...two, files: [{ name: 'page.html', text: '<p>hi</p>' }, { name: 'script.js', text: 'console.log(1);\n' }] };
    expect(printed(play(page, [{ run: true }]))).toEqual(['1']);
  });
});

describe('from', () => {
  const first = spec('let a = 1;\n');
  const second = spec('starter', { from: { step: 'one', demo: 'code' } });
  const third = spec('starter', { from: { step: 'two', demo: 'code' } });

  it('carries code through a chain of steps', () => {
    const one = play(first, [{ edit: 'script.js', code: 'let a = 2;\n' }]);
    const two = jsModel.start!(second, (step) => (step === 'one' ? one : undefined));
    const three = jsModel.start!(third, (step) => (step === 'two' ? two : undefined));
    expect(three.files[0].text).toBe('let a = 2;\n');
    expect(three.runs).toBe(0);
  });

  it('uses the starter when there is no earlier work, or the file is not listed', () => {
    expect(jsModel.start!(second, () => undefined).files[0].text).toBe('starter');
    const only = spec('starter', { from: { step: 'one', demo: 'code', files: [] } });
    expect(jsModel.start!(only, () => play(first, [])).files[0].text).toBe('starter');
  });
});

describe('checks', () => {
  const sum = spec('let scores = [1, 2, 3];\nlet total = 0;\nfor (let i = 0; i < scores.length; i++) {\n  total = total + scores[i];\n}\nconsole.log(total);\n', {
    checks: [
      { id: 'loop', label: 'Use a loop', test: (c) => (c.loops().length ? undefined : 'Write a for loop.'), hints: ['Think about a for loop.', 'Start with `for (let i = 0; i < 3; i++) {`'] },
      {
        id: 'sum',
        label: 'Add them up',
        test(c) {
          const r = c.run({ data: { scores: [10, 20] } });
          if (r.dataMissing.length) return 'Keep the variable named scores.';
          return r.text === '30' ? undefined : 'Your total did not change with the list.';
        },
      },
    ],
  });
  const hardCoded = 'let scores = [1, 2, 3];\nfor (let i = 0; i < 1; i++) {}\nconsole.log(6);\n';

  it('passes real work and sets a fact for each check', () => {
    const s = play(sum, [{ run: true }]);
    expect(s.checks?.every((c) => c.ok)).toBe(true);
    expect(jsModel.facts(sum, s)).toMatchObject({ checks: true, 'check:loop': true, 'check:sum': true });
  });

  it('catches a typed-in answer with other data', () => {
    const s = play(sum, [{ edit: 'script.js', code: hardCoded }, { run: true }]);
    expect(s.checks?.[1]).toEqual({ id: 'sum', ok: false, note: 'Your total did not change with the list.' });
  });

  it('shows only the first unmet check', () => {
    const s = play(sum, [{ edit: 'script.js', code: 'console.log(6);\n' }, { run: true }]);
    expect(s.checks).toEqual([
      { id: 'loop', ok: false, note: 'Write a for loop.' },
      { id: 'sum', ok: false },
    ]);
  });

  it('notices a renamed variable', () => {
    const s = play(sum, [{ edit: 'script.js', code: 'let marks = [1];\nfor (let i = 0; i < 1; i++) {}\n' }, { run: true }]);
    expect(s.checks?.[1].note).toBe('Keep the variable named scores.');
  });

  it('holds the old results through a syntax error', () => {
    const s = play(sum, [{ run: true }, { edit: 'script.js', code: 'let = = 1' }, { run: true }]);
    expect(s.held).toBe(true);
    expect(s.checks?.every((c) => c.ok)).toBe(true);
    expect(s.last?.error?.type).toBe('SyntaxError');
    expect(play(sum, [{ edit: 'script.js', code: 'console.log(1);\n' }, { run: true }], s).held).toBe(false);
  });

  it('turns a check that throws into a note, not a crash', () => {
    const bad = spec('let a = 1;\n', { checks: [{ id: 'x', label: 'X', test: (c) => ((c.vars.nope as number[]).length ? undefined : 'no') }] });
    expect(play(bad, [{ run: true }]).checks?.[0].note).toMatch(/could not read your code/);
  });

  it('never hangs on a hidden run, even with many of them', () => {
    let calls = 0;
    const slow = spec('let n = 0;\nwhile (true) {\n  n = n + 1;\n}\n', {
      checks: [
        {
          id: 'x',
          label: 'X',
          test(c) {
            for (let seed = 1; seed < 50; seed++) {
              if (c.run({ seed }).status === 'limit') calls++;
            }
            return undefined;
          },
        },
      ],
    });
    const s = play(slow, [{ run: true }]);
    expect(s.last?.status).toBe('limit');
    expect(calls).toBe(49);
  });

  it('runs hidden copies with their own prompts, and reports a missing answer', () => {
    const results: unknown[] = [];
    const d = spec('let n = Number(prompt("n"));\nalert(n * 2);\nconsole.log(n);\n', {
      checks: [
        {
          id: 'x',
          label: 'X',
          test(c) {
            const a = c.run({ prompts: ['4'] });
            const b = c.run();
            results.push(a.output, a.vars, b.status, b.waiting?.message);
            return undefined;
          },
        },
      ],
    });
    play(d, [{ run: true }, { answer: '1' }]);
    expect(results).toEqual([
      [
        { kind: 'alert', text: '8', line: 2 },
        { kind: 'log', text: '4', line: 3 },
      ],
      { n: 4 },
      'waiting',
      'n',
    ]);
  });

  it('remembers a hidden run with the same options', () => {
    const seen: boolean[] = [];
    const d = spec('console.log(1);\n', {
      checks: [
        {
          id: 'x',
          label: 'X',
          test(c) {
            seen.push(c.run({ data: { a: 1 } }) === c.run({ data: { a: 1 } }));
            return undefined;
          },
        },
      ],
    });
    play(d, [{ run: true }]);
    expect(seen).toEqual([true]);
  });
});

describe('hints', () => {
  const d = spec('', {
    checks: [
      { id: 'a', label: 'A', test: (c) => (c.calls('alert').length ? undefined : 'Call alert.'), hints: ['one', 'two'] },
      { id: 'b', label: 'B', test: () => 'Not yet.', hints: ['three'] },
    ],
  });

  it('opens one at a time, stops at the end, and counts them', () => {
    const s = play(d, [{ hint: 'a' }, { hint: 'a' }, { hint: 'a' }]);
    expect(s.hints).toEqual({ a: 2 });
    expect(jsModel.facts(d, s)).toMatchObject({ hints: 2, 'hints:a': 2 });
  });

  it('works before the first Run, for the first check only', () => {
    const s = play(d, []);
    expect(firstUnmet(d, s)?.id).toBe('a');
    expect(jsModel.apply(d, s, { hint: 'b' })).toBe(s);
  });

  it('moves on to the next unmet check', () => {
    const s = play(d, [{ edit: 'script.js', code: 'alert(1);\n' }, { run: true }]);
    expect(firstUnmet(d, s)?.id).toBe('b');
    expect(play(d, [{ hint: 'b' }], s).hints).toEqual({ b: 1 });
  });
});

describe('notes', () => {
  it('reports a mistake with its line, and honors lintOff', () => {
    const code = 'let x = 1;\nif (x = 5) {\n  console.log(x);\n}\n';
    const s = play(spec(code), [{ run: true }]);
    expect(s.notes?.[0]).toMatchObject({ rule: 'assign-in-condition', line: 2 });
    expect(jsModel.facts(spec(''), s).notes).toBe('assign-in-condition');
    expect(play(spec(code, { lintOff: ['assign-in-condition'] }), [{ run: true }]).notes).toBeUndefined();
  });

  it('clears when the next run is clean', () => {
    const d = spec('let x = 1;\nif (x = 5) {\n}\n');
    const s = play(d, [{ run: true }, { edit: 'script.js', code: 'console.log(1);\n' }, { run: true }]);
    expect(s.notes).toBeUndefined();
  });
});

describe('step through', () => {
  const d = spec('let total = 0;\nfor (let i = 0; i < 2; i++) {\n  total += i;\n}\nconsole.log(total);\n');

  it('walks the program and records how far it got', () => {
    let s = play(d, [{ stepping: true }]);
    expect(s.at).toBe(0);
    const n = traceOf(d, s).steps.length;
    s = play(d, [{ seek: 1 }, { seek: n + 5 }], s);
    expect(s.at).toBe(n - 1);
    expect(s.finished).toBe(true);
    expect(jsModel.facts(d, s)).toMatchObject({ far: n - 1, finished: true });
    expect(play(d, [{ stepping: false }], s).at).toBeUndefined();
  });

  it('shows each test of a loop condition as its own step', () => {
    const s = play(d, [{ stepping: true }]);
    expect(traceOf(d, s).steps.map((t) => t.say)).toEqual(expect.arrayContaining(['i < 2 is true, so the loop runs.', 'i < 2 is false, so the loop ends.']));
  });

  it('asks for a prompt in the same way, and carries on from the same step', () => {
    const p = spec('let a = prompt("Name?");\nconsole.log(a);\n');
    let s = play(p, [{ stepping: true }, { seek: 1 }]);
    const steps = traceOf(p, s).steps;
    expect(steps[s.at!].end).toBe('waiting');
    expect(s.finished).toBeFalsy();
    s = play(p, [{ answer: 'Ann' }], s);
    expect(s.at).toBe(1);
    expect(traceOf(p, s).steps[1].say).toBe("a is now 'Ann'.");
    expect(traceOf(p, s).lines.map((l) => l.text)).toEqual(['Name?', 'Ann']);
  });

  it('takes no answer away from the last step', () => {
    const p = spec('let a = prompt("Name?");\n');
    const s = play(p, [{ stepping: true }]);
    expect(jsModel.apply(p, s, { answer: 'x' })).toBe(s);
  });

  it('turns a syntax error into an error, not a step-through', () => {
    const s = play(spec('let = = 1'), [{ stepping: true }]);
    expect(s.at).toBeUndefined();
    expect(s.last?.error?.type).toBe('SyntaxError');
  });

  it('survives an empty file', () => {
    const e = spec('');
    const s = play(e, [{ stepping: true }, { seek: 1 }]);
    expect(s.finished).toBe(true);
  });

  it('leaves the code alone while it runs', () => {
    const s = play(d, [{ stepping: true }]);
    expect(jsModel.apply(d, s, { edit: 'script.js', code: 'x' })).toBe(s);
    expect(jsModel.apply(d, s, { seek: 0 })).toBe(s);
  });

  it('forgets a prompt that was waiting when it starts', () => {
    const p = spec('prompt("a");\n');
    const s = play(p, [{ run: true }, { stepping: true }]);
    expect(s.waiting).toBeUndefined();
    expect(jsModel.apply(p, play(p, [{ stepping: false }], s), { answer: 'x' })).toEqual(play(p, [{ stepping: false }], s));
  });

  it('ends a run that is on when Run is pressed', () => {
    const s = play(d, [{ stepping: true }, { run: true }]);
    expect(s.at).toBeUndefined();
    expect(printed(s)).toEqual(['1']);
  });
});

describe('code nested too deep for the browser stack', () => {
  const NEST: Record<string, (n: number) => string> = {
    parens: (n) => `let x = ${'('.repeat(n)}1${')'.repeat(n)};\nconsole.log(x);\n`,
    arrays: (n) => `let x = ${'['.repeat(n)}${']'.repeat(n)};\nconsole.log(1);\n`,
    blocks: (n) => `${'{'.repeat(n)}${'}'.repeat(n)}\nconsole.log(1);\n`,
    objects: (n) => `let x = ${'{a:'.repeat(n)}1${'}'.repeat(n)};\nconsole.log(1);\n`,
    calls: (n) => `let x = ${'Math.abs('.repeat(n)}1${')'.repeat(n)};\nconsole.log(x);\n`,
    plus: (n) => `let x = 1${' + 1'.repeat(n)};\nconsole.log(x);\n`,
    not: (n) => `let x = ${'!'.repeat(n)}1;\nconsole.log(x);\n`,
    ifs: (n) => `${'if (true) '.repeat(n)}console.log(1);\n`,
    elses: (n) => `if (false) {}${' else if (false) {}'.repeat(n)}\nconsole.log(1);\n`,
  };
  const SIZES = [300, 1000, 2000, 3000, 5000, 10000, 40000];

  for (const [name, make] of Object.entries(NEST)) {
    it(`${name}: Run and Step through report what happened, with no crash`, () => {
      for (const n of SIZES) {
        const d = spec(make(n), { checks: [{ id: 'seen', label: 'Use a loop', test: (c) => (c.loops().length ? undefined : 'Write a loop.') }] });
        const s = play(d, [{ run: true }]);
        expect(['ok', 'error', 'limit']).toContain(s.last?.status);
        if (s.last?.error) expect(s.last.error.msg).toBe('Maximum call stack size exceeded');
        expect(() => traceOf(d, s)).not.toThrow();
        // Code that can't be parsed never reaches the checks.
        if (s.checks) expect(s.checks[0].ok).toBe(false);
      }
    });
  }

  it('says plainly why the editor could not read the code', () => {
    const s = play(spec(NEST.parens(40000)), [{ run: true }]);
    expect(s.last?.error).toMatchObject({ type: 'RangeError', code: 'too-nested', pos: { line: 1 } });
    expect(s.last?.error?.help).toMatch(/too many brackets/);
    expect(jsModel.facts(spec(''), s)).toMatchObject({ ok: false, error: 'too-nested' });
  });

  it('does not blame a function when the code has none', () => {
    const s = play(spec(NEST.plus(40000)), [{ run: true }]);
    expect(s.last?.error?.msg).toBe('Maximum call stack size exceeded');
    expect(s.last?.error?.help).toMatch(/too long/);
  });
});

