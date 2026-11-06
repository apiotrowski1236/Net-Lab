/** Where something is in a student's source. `line` starts at 1, `col` at 0, `off` counts characters from the top of the file. */
export interface Pos {
  file: string;
  line: number;
  col: number;
  off: number;
}

/**
 * One error. `msg` is V8's exact wording, so what students see here is what
 * they'll see in the Chrome console. `help` says the same thing in plain English,
 * and is what a student reads first.
 */
export interface JsError {
  /** 'SyntaxError', 'TypeError', 'ReferenceError', 'RangeError', or 'NotAvailable' for language this editor leaves out. */
  type: string;
  msg: string;
  /** Short stable name, for goals and tests: 'not-defined', 'missing-brace', 'for-commas'. */
  code: string;
  pos: Pos;
  help?: string;
}

/** Thrown by the lexer and parser, which stop at the first error, as a student should. */
export class SyntaxStop extends Error {
  constructor(readonly error: JsError) {
    super(error.msg);
  }
}

/** The error as Chrome's console words it. `NotAvailable` is ours, so it has no prefix. */
export const errorText = (e: Pick<JsError, 'type' | 'msg'>) => (e.type === 'NotAvailable' ? e.msg : `${e.type}: ${e.msg}`);
