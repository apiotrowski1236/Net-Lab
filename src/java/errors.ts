/** Where something is in a student's source. `line` starts at 1, `col` at 0. */
export interface Pos {
  file: string;
  line: number;
  col: number;
}

/**
 * One compile error. `msg` and `detail` use javac's wording, so what students
 * see here is what they'll see in any other Java tool. `help` says the same
 * thing in plain English, and is what a student reads first.
 */
export interface CompileError {
  /** Short stable name, for goals and tests: 'private-access', 'missing-semicolon'. */
  code: string;
  msg: string;
  pos: Pos;
  /** Lines javac prints under the caret ("symbol:   variable x"). */
  detail?: string[];
  help?: string;
  /** From the parser, which stops at the first error. */
  syntax?: boolean;
}

/** Thrown by the lexer and parser, which stop at the first error, as a student should. */
export class SyntaxStop extends Error {
  constructor(readonly error: CompileError) {
    super(error.msg);
  }
}

/** A file's text as javac prints an error: name, line, message, the source line, and a caret. */
export function formatError(e: CompileError, files: { name: string; text: string }[]): string {
  const src = files.find((f) => f.name === e.pos.file)?.text.split('\n')[e.pos.line - 1] ?? '';
  const out = [`${e.pos.file}:${e.pos.line}: error: ${e.msg}`];
  out.push(src.replace(/\r$/, ''), ' '.repeat(e.pos.col) + '^');
  if (e.detail) out.push(...e.detail);
  return out.join('\n');
}
