import { lint, parseFiles, Query, runProgram, type JsError, type Limit, type LintNote, type OutputLine, type Program, type RunFacts, type RunOptions, type RunResult, type TraceStep, type Waiting } from '../js';
import type { DemoFacts, DemoInput, DemoModel, JsCheck, JsFile, JsSpec } from './types';

/** What the last Run did, as saved and shown. */
export interface JsLast {
  status: RunResult['status'];
  /** Everything printed, with each prompt and its answer in its place. */
  lines: OutputLine[];
  error?: JsError;
  limit?: Limit;
}

export interface JsCheckResult {
  id: string;
  ok: boolean;
  note?: string;
}

export interface JsState {
  files: JsFile[];
  open: string;
  /** Tabs the student has opened. */
  opened?: string[];
  /** Presses of Run. The current run's seed, so Math.random changes between runs and not between prompts. */
  runs: number;
  /** Answers so far in this run or step-through. A string is OK and null is Cancel. */
  answers: (string | null)[];
  /** The run is stopped at this prompt until the student answers. */
  waiting?: Waiting;
  last?: JsLast;
  /** What the mistake detector found in the last finished run. */
  notes?: LintNote[];
  checks?: JsCheckResult[];
  /** The last run had a syntax error, so `checks` are from an earlier run. */
  held?: boolean;
  /** How many hints of each check the student has opened. */
  hints?: Record<string, number>;
  /** The step on screen in the step-through, while it's on. */
  at?: number;
  /** The furthest step reached in the step-through. */
  far?: number;
  /** Reached the end of the step-through. */
  finished?: boolean;
  /** Code changed since the last Run, so `last` may point at lines that moved. */
  edited?: boolean;
}

/** A line the program printed. */
export interface JsCheckLine {
  kind: 'log' | 'alert';
  text: string;
  line: number;
  /** From console.error. */
  error?: true;
}

/** What `c.run()` asks for. */
export interface JsCheckRunOptions {
  /** Answers for prompt() and confirm(), in order. A string is OK and null is Cancel. */
  prompts?: readonly (string | null)[];
  /** Math.random starts from this. Default: 1, so a check doesn't change from one Run to the next. */
  seed?: number;
  /** Replaces the first value of these top-level variables, so a check can try the student's code on other data. */
  data?: Record<string, unknown>;
}

/** How one run of the student's code went. */
export interface JsCheckRun {
  status: RunResult['status'];
  ok: boolean;
  /** Lines from console.log, console.error, and alert, in order. */
  output: JsCheckLine[];
  /** The same lines joined with newlines. */
  text: string;
  /** Top-level variables at the end, as plain values. */
  vars: Record<string, unknown>;
  error?: JsError;
  limit?: Limit;
  /** The prompt it stopped at: the run needed one more answer than it was given. */
  waiting?: Waiting;
  facts: RunFacts;
  /** Names in `data` the program never gave a first value to, because the student renamed or removed them. */
  dataMissing: string[];
}

/** Steps one hidden run may take. A loop of 100,000 passes fits. */
const CHECK_STEPS = 400_000;
/** Steps all the hidden runs of one Run may take together, so a long list of checks can't freeze the page. */
const CHECK_TOTAL = 1_500_000;
const NO_FACTS: RunFacts = { indexAtLength: [], promptPlus: [], misspelled: [], loops: [], builtinCalls: [], prompts: 0 };

const printed = (lines: readonly OutputLine[]): JsCheckLine[] => lines.flatMap((l) => (l.kind === 'log' || l.kind === 'alert' ? [{ kind: l.kind, text: l.text, line: l.line, ...(l.error ? { error: l.error } : {}) }] : []));

function checkRun(r: RunResult): JsCheckRun {
  const output = printed(r.lines);
  return { status: r.status, ok: r.status === 'ok', output, text: output.map((l) => l.text).join('\n'), vars: r.vars, error: r.error, limit: r.limit, waiting: r.waiting, facts: r.facts, dataMissing: r.dataMissing };
}

/**
 * What a check can look at: the code, through the methods of Query, and how the
 * student's own Run went. `c.run()` runs a hidden copy of the code, with its own
 * prompts and data, so a check can catch an answer that was typed in by hand.
 */
export class JsCheckCtx extends Query {
  /** The student's own Run. */
  readonly status: JsCheckRun['status'];
  readonly ok: boolean;
  readonly output: JsCheckLine[];
  readonly text: string;
  readonly vars: Record<string, unknown>;
  readonly error?: JsError;
  readonly limit?: Limit;
  readonly facts: RunFacts;
  /** What the mistake detector found. */
  readonly notes: LintNote[];
  private readonly seen = new Map<string, JsCheckRun>();
  private spent = 0;

  constructor(
    programs: Program[],
    own: RunResult,
    notes: LintNote[],
    private readonly hosts?: RunOptions['hosts'],
  ) {
    super(programs);
    const r = checkRun(own);
    this.status = r.status;
    this.ok = r.ok;
    this.output = r.output;
    this.text = r.text;
    this.vars = r.vars;
    this.error = r.error;
    this.limit = r.limit;
    this.facts = r.facts;
    this.notes = notes;
  }

  /** Runs a hidden copy of the code. The same options give the same result without running again. It can't hang. */
  run(options: JsCheckRunOptions = {}): JsCheckRun {
    const { prompts = [], seed = 1, data } = options;
    const key = JSON.stringify([prompts, seed, data]);
    const done = this.seen.get(key);
    if (done) return done;
    const left = CHECK_TOTAL - this.spent;
    let r: JsCheckRun;
    if (left <= 0) {
      r = { status: 'limit', ok: false, output: [], text: '', vars: {}, limit: { why: 'steps', text: 'The checks ran out of time on this code.' }, facts: NO_FACTS, dataMissing: [] };
    } else {
      const run = runProgram(this.programs, { seed, answers: prompts, data, maxSteps: Math.min(CHECK_STEPS, left), hosts: this.hosts });
      this.spent += run.steps;
      r = checkRun(run);
    }
    this.seen.set(key, r);
    return r;
  }
}

function runChecks(spec: JsSpec, makeCtx: () => JsCheckCtx): JsCheckResult[] | undefined {
  if (!spec.checks) return undefined;
  let ctx: JsCheckCtx | undefined;
  let stuck = false;
  return spec.checks.map((c) => {
    // Checks build on each other, so show only the first thing left to do.
    if (stuck) return { id: c.id, ok: false };
    let note: string | undefined;
    try {
      ctx = ctx ?? makeCtx();
      note = c.test(ctx);
    } catch {
      // A check reads what the student wrote, which can be anything. The answer key still has to pass it, so this can't hide a broken check.
      note = 'This check could not read your code. Make sure your variable names match the instructions, then press Run.';
    }
    stuck = note !== undefined;
    return { id: c.id, ok: !stuck, note };
  });
}

/** The first check not yet passed. It's the one with a Hint button, and that holds before the first Run too. */
export function firstUnmet(spec: JsSpec, s: JsState): JsCheck | undefined {
  return spec.checks?.find((c) => !s.checks?.find((r) => r.id === c.id)?.ok);
}

const hostsFor = (spec: JsSpec, files: JsFile[]): RunOptions['hosts'] => {
  const make = spec.hosts;
  return make && ((rt) => make(rt, files));
};

const lastOf = (r: RunResult): JsLast => ({ status: r.status, lines: r.lines, error: r.error, limit: r.limit });

/** Parts of the state a syntax error sets. Nothing ran, so old checks are held, not rerun. */
const stoppedBy = (spec: JsSpec, error: JsError): Pick<JsState, 'last' | 'notes' | 'held' | 'waiting' | 'answers' | 'edited'> => ({ last: { status: 'error', lines: [], error }, notes: undefined, held: !!spec.checks?.length, waiting: undefined, answers: [], edited: false });

/** Runs from the top with these answers, up to the next unanswered prompt or the end. */
function execute(spec: JsSpec, s: JsState, seed: number, answers: JsState['answers']): JsState {
  const { programs, error } = parseFiles(s.files);
  if (error) return { ...s, runs: seed, at: undefined, ...stoppedBy(spec, error) };
  const hosts = hostsFor(spec, s.files);
  const r = runProgram(programs, { seed, answers, hosts });
  const base: JsState = { ...s, runs: seed, answers, last: lastOf(r), waiting: undefined, notes: undefined, held: false, edited: false, at: undefined };
  // Notes and checks judge a whole run, so they wait for the last answer.
  if (r.status === 'waiting') return { ...base, waiting: r.waiting };
  const notes = lint(programs, r, spec.lintOff);
  return { ...base, notes: notes.length ? notes : undefined, checks: runChecks(spec, () => new JsCheckCtx(programs, r, notes, hosts)) };
}

export interface JsTrace {
  steps: TraceStep[];
  /** Everything printed. A step's `out` says how many lines existed by then. */
  lines: OutputLine[];
  /** The prompt the last step stopped at. */
  waiting?: Waiting;
}

let traced: { spec: JsSpec; key: string; trace: JsTrace } | undefined;

/** The step-through of these files with these answers. Remembers the last one, since the view and the model both ask. */
export function traceOf(spec: JsSpec, s: Pick<JsState, 'files' | 'answers' | 'runs'>): JsTrace {
  const key = JSON.stringify([s.files, s.answers, s.runs]);
  if (traced?.spec !== spec || traced.key !== key) {
    const { programs, error } = parseFiles(s.files);
    const r = error ? undefined : runProgram(programs, { seed: s.runs, answers: s.answers, trace: true, hosts: hostsFor(spec, s.files) });
    traced = { spec, key, trace: { steps: r?.trace ?? [], lines: r?.lines ?? [], waiting: r?.waiting } };
  }
  return traced.trace;
}

export const jsModel: DemoModel<JsSpec, JsState> = {
  init: (spec) => ({ files: spec.files.map((f) => ({ ...f })), open: spec.open ?? spec.files[0].name, runs: 0, answers: [] }),

  start(spec, earlier) {
    const base = jsModel.init(spec);
    if (!spec.from) return base;
    const prior = earlier(spec.from.step, spec.from.demo) as JsState | undefined;
    if (!prior) return base;
    const keep = spec.from.files ?? base.files.map((f) => f.name);
    return { ...base, files: base.files.map((f) => ({ ...f, text: (keep.includes(f.name) ? prior.files.find((p) => p.name === f.name)?.text : undefined) ?? f.text })) };
  },

  apply(spec, s, input: DemoInput) {
    if ('edit' in input) {
      const f = s.files.find((x) => x.name === input.edit);
      if (!f || f.locked || f.text === input.code || s.at !== undefined) return s;
      // A prompt from code that has changed can't be answered: its run no longer matches what's on screen.
      return { ...s, edited: true, waiting: undefined, answers: [], files: s.files.map((x) => (x === f ? { ...x, text: input.code } : x)) };
    }
    if ('tab' in input) return s.files.some((f) => f.name === input.tab) && s.open !== input.tab && s.at === undefined ? { ...s, open: input.tab, opened: [...new Set([...(s.opened ?? []), input.tab])] } : s;
    if ('run' in input) return execute(spec, s, s.runs + 1, []);
    if ('answer' in input) {
      if (s.at === undefined) return s.waiting ? execute(spec, s, s.runs, [...s.answers, input.answer]) : s;
      const steps = traceOf(spec, s).steps;
      if (s.at !== steps.length - 1 || steps[s.at].end !== 'waiting') return s;
      // The rerun carries on past the prompt, so the same step number now shows what came next.
      return { ...s, answers: [...s.answers, input.answer] };
    }
    if ('stepping' in input) {
      if (!input.stepping) return s.at === undefined ? s : { ...s, at: undefined, answers: [] };
      const { error } = parseFiles(s.files);
      if (error) return { ...s, ...stoppedBy(spec, error) };
      return { ...s, at: 0, far: Math.max(s.far ?? 0, 0), answers: [], waiting: undefined };
    }
    if ('seek' in input) {
      if (s.at === undefined) return s;
      const steps = traceOf(spec, s).steps;
      const at = Math.min(Math.max(0, input.seek), steps.length - 1);
      if (at === s.at) return s;
      // A step-through stopped at a prompt hasn't reached the end, however far along it is.
      return { ...s, at, far: Math.max(s.far ?? 0, at), finished: s.finished || (at === steps.length - 1 && steps[at].end !== 'waiting') };
    }
    if ('hint' in input) {
      const c = firstUnmet(spec, s);
      const seen = s.hints?.[input.hint] ?? 0;
      if (!c?.hints || c.id !== input.hint || seen >= c.hints.length) return s;
      return { ...s, hints: { ...s.hints, [c.id]: seen + 1 } };
    }
    return s;
  },

  facts(spec, s) {
    const f: DemoFacts = {
      runs: s.runs,
      ok: s.last?.status === 'ok',
      waiting: !!s.waiting,
      error: s.last?.error?.code ?? '',
      errorType: s.last?.error?.type ?? '',
      limit: s.last?.limit?.why ?? '',
      output: printed(s.last?.lines ?? [])
        .map((l) => l.text)
        .join('\n')
        .slice(0, 4000),
      notes: (s.notes ?? []).map((n) => n.rule).join(' '),
      far: s.far ?? -1,
      finished: !!s.finished,
      checks: !!spec.checks && !!s.checks && s.checks.every((c) => c.ok),
      hints: Object.values(s.hints ?? {}).reduce((a, b) => a + b, 0),
    };
    for (const c of s.checks ?? []) f[`check:${c.id}`] = c.ok;
    for (const [id, n] of Object.entries(s.hints ?? {})) f[`hints:${id}`] = n;
    for (const name of s.opened ?? []) f[`opened:${name}`] = true;
    return f;
  },
};
