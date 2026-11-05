import { compile, formatError, runProgram, runtimeHelp, type Program, type RunResult, type TraceStep } from '../java';
import type { DemoFacts, DemoInput, DemoModel, JavaFile, JavaSpec } from './types';

/** A compile error, as saved and shown. */
export interface JavaError {
  file: string;
  line: number;
  code: string;
  /** javac's message, with the source line and caret. */
  text: string;
  /** The same thing in plain English. */
  help?: string;
}

export interface JavaLast {
  kind: 'errors' | 'ok' | 'exception' | 'limit' | 'no-main';
  output: string;
  errors?: JavaError[];
  exception?: { short: string; text: string; help: string; file?: string; line?: number };
  limit?: 'steps' | 'output';
}

export interface JavaCheckResult {
  id: string;
  ok: boolean;
  note?: string;
}

export interface JavaState {
  files: JavaFile[];
  open: string;
  /** Tabs the student has opened. */
  opened?: string[];
  runs: number;
  last?: JavaLast;
  checks?: JavaCheckResult[];
  /** The last run didn't compile far enough to check, so `checks` are from an earlier run. */
  held?: boolean;
  /** The step on screen in the step-through, while it's on. */
  at?: number;
  /** The furthest step reached in the step-through. */
  far?: number;
  /** Reached the end of the step-through. */
  finished?: boolean;
  /** Code changed since the last Run, so `last` may point at lines that moved. */
  edited?: boolean;
}

/** What a check can look at. */
export interface JavaCheckCtx {
  /** Everything the student wrote, compiled. */
  program: Program;
  /** What the student's main printed. */
  output: string;
  ok: boolean;
  source(file: string): string;
  /** A class's instance or static variable. */
  field(cls: string, name: string): { type: string; access: string; isStatic: boolean } | undefined;
  /** A method's return type, given its parameter types: `method('Song', 'play')`, `method('Song', 'add', 'int')`. */
  method(cls: string, name: string, ...params: string[]): { ret: string; access: string; isStatic: boolean } | undefined;
  ctor(cls: string, ...params: string[]): boolean;
  /** Runs `body` as a main method beside the student's classes. It may read their private variables. */
  run(body: string, imports?: string): { output: string; failed?: string };
}

const CHECK_CLASS = 'NetLabCheck';

const sources = (files: JavaFile[]) => files.map(({ name, text }) => ({ name, text }));

const typeText = (t: import('../java/types').JType) => (t.k === 'class' ? t.name : t.k === 'array' ? 'array' : t.k);

function checkCtx(files: JavaFile[], program: Program, r: RunResult, compiled = files): JavaCheckCtx {
  const sig = (m: { params: import('../java/types').JType[] }) => m.params.map(typeText).join(',');
  return {
    program,
    output: r.output,
    ok: r.status === 'ok',
    source: (file) => files.find((f) => f.name === file)?.text ?? '',
    field(cls, name) {
      const f = program.classes.get(cls)?.fields.get(name);
      return f && { type: typeText(f.type), access: f.access, isStatic: f.isStatic };
    },
    method(cls, name, ...params) {
      const m = program.classes.get(cls)?.methods.get(name)?.find((x) => sig(x) === params.join(','));
      return m && { ret: typeText(m.ret), access: m.access, isStatic: m.isStatic };
    },
    ctor: (cls, ...params) => !!program.classes.get(cls)?.ctors.some((x) => sig(x) === params.join(',')),
    run(body, imports = '') {
      const text = `${imports}\npublic class ${CHECK_CLASS} {\n  public static void main(String[] args) {\n${body}\n  }\n}\n`;
      const hidden = compile([...sources(compiled), { name: `${CHECK_CLASS}.java`, text }], { ignorePrivate: true });
      if (!hidden.program) return { output: '', failed: hidden.errors[0]?.help ?? hidden.errors[0]?.msg ?? 'That code did not compile.' };
      const run = runProgram(hidden.program, { mainClass: CHECK_CLASS, maxSteps: 200_000 });
      if (run.status === 'ok') return { output: run.output };
      return { output: run.output, failed: run.exception ? `${run.exception.short}${run.exception.message ? `: ${run.exception.message}` : ''}` : 'It ran too long.' };
    },
  };
}

function runChecks(spec: JavaSpec, ctx: JavaCheckCtx): JavaCheckResult[] | undefined {
  if (!spec.checks) return undefined;
  let stuck = false;
  return spec.checks.map((c) => {
    // Checks build on each other, so show only the first thing left to do.
    if (stuck) return { id: c.id, ok: false };
    const note = c.test(ctx);
    stuck = note !== undefined;
    return { id: c.id, ok: !stuck, note };
  });
}

/**
 * Checks for a program that didn't compile. When only the main file has errors, the classes
 * still get checked on their own. Main calls what the student hasn't written yet, so otherwise
 * finished work shows no progress until the last piece is in. Other errors keep the old results,
 * marked as held, so their notes don't read as being about the code on screen.
 */
function checksWithoutMain(spec: JavaSpec, s: JavaState, errors: ReturnType<typeof compile>['errors']): Pick<JavaState, 'checks' | 'held'> {
  const main = `${spec.main ?? 'Main'}.java`;
  if (!spec.checks?.length) return { checks: s.checks };
  const rest = s.files.filter((f) => f.name !== main);
  const program = errors.every((e) => e.pos.file === main) ? compile(sources(rest)).program : undefined;
  if (!program) return { checks: s.checks, held: true };
  const checks = runChecks(spec, checkCtx(s.files, program, { output: '', status: 'no-main' }, rest));
  const stuck = spec.checks.find((c) => checks?.find((r) => r.id === c.id && !r.ok));
  return { checks, held: !!stuck?.main };
}

function lastOf(r: RunResult, files: JavaFile[]): JavaLast {
  const output = r.output;
  if (r.status === 'no-main') return { kind: 'no-main', output };
  if (r.status === 'limit') return { kind: 'limit', output, limit: r.limit };
  if (r.exception) {
    const x = r.exception;
    const head = `Exception in thread "main" ${x.type}${x.message === null ? '' : `: ${x.message}`}`;
    const text = [head, ...x.at.map((s) => `\tat ${s.cls}.${s.method}(${s.file}:${s.line})`)].join('\n');
    // Point at the student's own line, not one in a file they can't change.
    const top = x.at.find((s) => files.some((f) => f.name === s.file));
    return { kind: 'exception', output, exception: { short: x.short, text, help: runtimeHelp(x.short), file: top?.file, line: top?.line } };
  }
  return { kind: 'ok', output };
}

function compileErrors(files: JavaFile[], errors: ReturnType<typeof compile>['errors']): JavaLast {
  const src = sources(files);
  return { kind: 'errors', output: '', errors: errors.map((e) => ({ file: e.pos.file, line: e.pos.line, code: e.code, text: formatError(e, src), help: e.help })) };
}

export interface JavaTrace {
  steps: TraceStep[];
  /** Everything the program printed. A step's `outLen` says how much of it existed by then. */
  output: string;
  /** The program ran past the last step shown. */
  cut: boolean;
}

let traced: { key: string; trace: JavaTrace } | undefined;

/** The step-through of these files. Remembers the last one, since the view and the model both ask. */
export function traceOf(spec: JavaSpec, files: JavaFile[]): JavaTrace {
  const key = JSON.stringify([spec.main, files]);
  if (traced?.key !== key) {
    const { program } = compile(sources(files));
    const r = program && runProgram(program, { mainClass: spec.main, trace: true });
    traced = { key, trace: { steps: r?.trace ?? [], output: r?.output ?? '', cut: !!r?.traceCut } };
  }
  return traced.trace;
}

export const javaModel: DemoModel<JavaSpec, JavaState> = {
  init: (spec) => ({ files: spec.files.map((f) => ({ ...f })), open: spec.open ?? spec.files[0].name, runs: 0 }),

  start(spec, earlier) {
    const base = javaModel.init(spec);
    if (!spec.from) return base;
    const prior = earlier(spec.from.step, spec.from.demo) as JavaState | undefined;
    if (!prior) return base;
    const keep = spec.from.files ?? base.files.map((f) => f.name);
    return { ...base, files: base.files.map((f) => ({ ...f, text: (keep.includes(f.name) ? prior.files.find((p) => p.name === f.name)?.text : undefined) ?? f.text })) };
  },

  apply(spec, s, input: DemoInput) {
    if ('edit' in input) {
      const f = s.files.find((x) => x.name === input.edit);
      if (!f || f.locked || f.text === input.code || s.at !== undefined) return s;
      return { ...s, edited: true, files: s.files.map((x) => (x === f ? { ...x, text: input.code } : x)) };
    }
    if ('tab' in input) return s.files.some((f) => f.name === input.tab) && s.open !== input.tab && s.at === undefined ? { ...s, open: input.tab, opened: [...new Set([...(s.opened ?? []), input.tab])] } : s;
    if ('run' in input) {
      const seed = s.runs + 1;
      const { program, errors } = compile(sources(s.files));
      if (!program) {
        return { ...s, runs: seed, last: compileErrors(s.files, errors), edited: false, ...checksWithoutMain(spec, s, errors), at: undefined };
      }
      const r = runProgram(program, { mainClass: spec.main, seed });
      return { ...s, runs: seed, last: lastOf(r, s.files), edited: false, checks: runChecks(spec, checkCtx(s.files, program, r)), held: false, at: undefined };
    }
    if ('stepping' in input) {
      if (!input.stepping) return s.at === undefined ? s : { ...s, at: undefined };
      const { errors } = compile(sources(s.files));
      if (errors.length) return { ...s, last: compileErrors(s.files, errors), edited: false, ...checksWithoutMain(spec, s, errors) };
      return { ...s, at: 0, far: Math.max(s.far ?? 0, 0) };
    }
    if ('seek' in input) {
      if (s.at === undefined) return s;
      const n = traceOf(spec, s.files).steps.length;
      const at = Math.min(Math.max(0, input.seek), n - 1);
      if (at === s.at) return s;
      return { ...s, at, far: Math.max(s.far ?? 0, at), finished: s.finished || at === n - 1 };
    }
    return s;
  },

  facts(spec, s) {
    const f: DemoFacts = {
      runs: s.runs,
      ok: s.last?.kind === 'ok',
      errors: s.last?.errors?.map((e) => e.code).join(' ') ?? '',
      exception: s.last?.exception?.short ?? '',
      output: (s.last?.output ?? '').slice(0, 4000),
      far: s.far ?? -1,
      finished: !!s.finished,
      checks: !!spec.checks && !!s.checks && s.checks.every((c) => c.ok),
    };
    for (const c of s.checks ?? []) f[`check:${c.id}`] = c.ok;
    for (const name of s.opened ?? []) f[`opened:${name}`] = true;
    return f;
  },
};

