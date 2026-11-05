/**
 * A small JavaScript for the browser: a parser, a tree-walking interpreter, and
 * a mistake detector. It covers what a beginner touches, and stops with a plain
 * message on anything else. differential.test.ts holds it to the real language.
 */
import { SyntaxStop, type JsError } from './errors';
import { parseFile } from './parser';
import { isStackOverflow, runProgram, type RunOptions, type RunResult } from './run';
import type { Program } from './ast';

export { errorText, type JsError, type Pos } from './errors';
export { LINT_RULES, lint, type LintNote } from './lint';
export { Query, type CallFact, type DeclFact, type FnFact, type LoopFact } from './query';
export { runProgram, type Limit, type OutputLine, type RunFacts, type RunOptions, type RunResult, type TraceFrame, type TraceItem, type TraceStep, type TraceVar, type Waiting } from './run';
export { HostObject, type PageHooks, type Runtime, type Value } from './values';
export type { Program } from './ast';

export interface SourceFile {
  name: string;
  text: string;
}

export interface Parsed {
  programs: Program[];
  error?: JsError;
}

/** V8's parser gives up the same way on code nested thousands of levels deep. */
const tooNested = (file: string): JsError => ({
  type: 'RangeError',
  msg: 'Maximum call stack size exceeded',
  code: 'too-nested',
  pos: { file, line: 1, col: 0, off: 0 },
  help: 'This code has too many brackets inside other brackets, so the editor could not read it. Take out the extra brackets, then press Run.',
});

/** Parses every `.js` file, in order. A file with any other name, such as page.html, is not code to run. */
export function parseFiles(files: readonly SourceFile[]): Parsed {
  const programs: Program[] = [];
  for (const f of files) {
    if (!f.name.endsWith('.js')) continue;
    try {
      programs.push(parseFile(f.name, f.text));
    } catch (e) {
      if (e instanceof SyntaxStop) return { programs, error: e.error };
      if (isStackOverflow(e)) return { programs, error: tooNested(f.name) };
      throw e;
    }
  }
  return { programs };
}

/** Parses and runs. A syntax error stops everything before any line runs. */
export function runFiles(files: readonly SourceFile[], options: RunOptions = {}): RunResult {
  const { programs, error } = parseFiles(files);
  if (!error) return runProgram(programs, options);
  return { status: 'error', error, lines: [], vars: {}, dataMissing: Object.keys(options.data ?? {}), steps: 0, facts: { indexAtLength: [], promptPlus: [], misspelled: [], loops: [], builtinCalls: [], prompts: 0 } };
}
