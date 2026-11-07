import type { Pos } from './errors';

export type TokenType = 'id' | 'kw' | 'num' | 'str' | 'tpl' | 'op' | 'eof' | 'illegal';

export interface Token {
  t: TokenType;
  /** The name, keyword, or operator. A string's cooked text. */
  v: string;
  n?: number;
  pos: Pos;
  end: number;
  /** A line break comes before this token, which semicolon insertion needs. */
  nl: boolean;
  /** For 'illegal': V8's message, and a code for the help text. */
  msg?: string;
  code?: string;
}

/** One piece of a template literal: its text, and whether the closing backtick ended it. */
export interface TemplateChunk {
  text: string;
  done: boolean;
  /** The file ran out, or an escape was bad. */
  bad?: Token;
}

const KEYWORDS = new Set(
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with'.split(' '),
);

/** Longest first, so `>>>=` isn't read as `>>` and `>=`. */
const OPERATORS = '>>>= ... === !== **= <<= >>= >>> &&= ||= ??= => == != <= >= && || ?? ?. ++ -- += -= *= /= %= &= |= ^= << >> ** { } ( ) [ ] ; , < > + - * / % & | ^ ! ~ ? : = .'.split(' ');

const OPS_BY_FIRST = new Map<string, string[]>();
for (const op of OPERATORS) OPS_BY_FIRST.set(op[0], [...(OPS_BY_FIRST.get(op[0]) ?? []), op]);

/** Quotes a word processor swaps in for " and '. */
const SMART_QUOTES = '“”‘’„‟‚‛″′';

const isIdStart = (c: string) => /^[$_\p{ID_Start}]$/u.test(c);
const isIdPart = (c: string) => /^[$_‌‍\p{ID_Continue}]$/u.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isLineEnd = (c: string | undefined) => c === '\n' || c === '\r' || c === ' ' || c === ' ';
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\v' || c === '\f' || c === ' ' || c === '﻿' || /^\p{Zs}$/u.test(c);

/** Reads one token at a time, because only the parser knows what a backtick's `}` closes. */
export class Lexer {
  private i = 0;
  private line = 1;
  private lineStart = 0;

  constructor(
    readonly file: string,
    readonly src: string,
  ) {
    if (src.startsWith('#!')) this.lineComment();
  }

  /** Where the reader is, so the parser can look one token ahead and come back. */
  save() {
    return { i: this.i, line: this.line, lineStart: this.lineStart };
  }

  restore(s: ReturnType<Lexer['save']>) {
    this.i = s.i;
    this.line = s.line;
    this.lineStart = s.lineStart;
  }

  private here(): Pos {
    return { file: this.file, line: this.line, col: this.i - this.lineStart, off: this.i };
  }

  private newline() {
    const c = this.src[this.i];
    this.i += c === '\r' && this.src[this.i + 1] === '\n' ? 2 : 1;
    this.line++;
    this.lineStart = this.i;
  }

  private lineComment() {
    while (this.i < this.src.length && !isLineEnd(this.src[this.i])) this.i++;
  }

  /** Skips spaces and comments. Says whether it crossed a line break. A comment that never closes comes back as a token. */
  private skip(): { nl: boolean; bad?: Token } {
    let nl = false;
    const { src } = this;
    while (this.i < src.length) {
      const c = src[this.i];
      if (isLineEnd(c)) {
        this.newline();
        nl = true;
      } else if (isSpace(c)) this.i++;
      else if (c === '/' && src[this.i + 1] === '/') this.lineComment();
      else if (c === '/' && src[this.i + 1] === '*') {
        const pos = this.here();
        this.i += 2;
        for (;;) {
          if (this.i >= src.length) return { nl, bad: this.illegal(pos, 'Invalid or unexpected token', 'unterminated-comment', nl) };
          if (src[this.i] === '*' && src[this.i + 1] === '/') {
            this.i += 2;
            break;
          }
          if (isLineEnd(src[this.i])) {
            this.newline();
            nl = true;
          } else this.i++;
        }
      } else if (src.startsWith('<!--', this.i)) this.lineComment();
      else if (src.startsWith('-->', this.i) && (nl || this.i === 0)) this.lineComment();
      else break;
    }
    return { nl };
  }

  private illegal(pos: Pos, msg: string, code: string, nl: boolean): Token {
    return { t: 'illegal', v: this.src.slice(pos.off, Math.max(this.i, pos.off + 1)), pos, end: Math.max(this.i, pos.off + 1), nl, msg, code };
  }

  next(): Token {
    const { nl, bad } = this.skip();
    if (bad) return bad;
    const { src } = this;
    const pos = this.here();
    if (this.i >= src.length) return { t: 'eof', v: '', pos, end: this.i, nl };
    const c = String.fromCodePoint(src.codePointAt(this.i)!);
    if (isIdStart(c)) return this.word(pos, nl);
    if (isDigit(c) || (c === '.' && isDigit(src[this.i + 1]))) return this.number(pos, nl);
    if (c === '"' || c === "'") return this.string(pos, nl, c);
    if (c === '`') {
      this.i++;
      return { t: 'tpl', v: '`', pos, end: this.i, nl };
    }
    if (SMART_QUOTES.includes(c)) {
      this.i += c.length;
      return this.illegal(pos, 'Invalid or unexpected token', 'smart-quote', nl);
    }
    for (const op of OPS_BY_FIRST.get(c) ?? []) {
      // `x?.5:1` is a conditional and a number.
      if (op === '?.' && isDigit(src[this.i + 2])) continue;
      if (src.startsWith(op, this.i)) {
        this.i += op.length;
        return { t: 'op', v: op, pos, end: this.i, nl };
      }
    }
    this.i += c.length;
    return this.illegal(pos, 'Invalid or unexpected token', 'bad-character', nl);
  }

  private word(pos: Pos, nl: boolean): Token {
    const { src } = this;
    for (;;) {
      const cp = src.codePointAt(this.i);
      if (cp === undefined) break;
      const c = String.fromCodePoint(cp);
      if (!isIdPart(c)) break;
      this.i += c.length;
    }
    const v = src.slice(pos.off, this.i);
    return { t: KEYWORDS.has(v) ? 'kw' : 'id', v, pos, end: this.i, nl };
  }

  private digits(ok: (c: string) => boolean): string {
    const { src } = this;
    const start = this.i;
    while (this.i < src.length && (ok(src[this.i]) || (src[this.i] === '_' && this.i > start))) this.i++;
    return src.slice(start, this.i);
  }

  private number(pos: Pos, nl: boolean): Token {
    const { src } = this;
    const bad = (msg = 'Invalid or unexpected token', code = 'bad-number') => this.illegal(pos, msg, code, nl);
    let value: number;
    const radix = src[this.i] === '0' ? { x: 16, X: 16, o: 8, O: 8, b: 2, B: 2 }[src[this.i + 1]] : undefined;
    if (radix) {
      this.i += 2;
      const text = this.digits((c) => !Number.isNaN(parseInt(c, radix)));
      if (!text) return bad();
      if (text.endsWith('_')) return bad('Numeric separators are not allowed at the end of numeric literals');
      value = [...text.replace(/_/g, '')].reduce((acc, c) => acc * radix + parseInt(c, radix), 0);
    } else if (src[this.i] === '0' && isDigit(src[this.i + 1])) {
      // An old-style number: 017 is octal, and 08 is decimal.
      const text = this.digits(isDigit);
      if (/[89]/.test(text)) {
        if (src[this.i] === '.') {
          this.i++;
          this.digits(isDigit);
        }
        value = Number(src.slice(pos.off, this.i));
      } else value = parseInt(text, 8);
    } else {
      const whole = this.digits(isDigit);
      if (whole.endsWith('_')) return bad('Numeric separators are not allowed at the end of numeric literals');
      if (src[this.i] === '.') {
        this.i++;
        const part = this.digits(isDigit);
        if (part.endsWith('_')) return bad('Numeric separators are not allowed at the end of numeric literals');
      }
      if (src[this.i] === 'e' || src[this.i] === 'E') {
        this.i++;
        if (src[this.i] === '+' || src[this.i] === '-') this.i++;
        if (!this.digits(isDigit)) return bad();
      }
      value = Number(src.slice(pos.off, this.i).replace(/_/g, ''));
    }
    if (src[this.i] === 'n') {
      this.i++;
      return bad('BigInt numbers, written with an n on the end, are not available in this editor.', 'bigint');
    }
    const after = src.codePointAt(this.i);
    if (after !== undefined) {
      const c = String.fromCodePoint(after);
      if (isIdStart(c) || isDigit(c)) {
        this.i += c.length;
        return bad('Invalid or unexpected token', 'number-then-letter');
      }
    }
    return { t: 'num', v: src.slice(pos.off, this.i), n: value, pos, end: this.i, nl };
  }

  /** One escape, starting after the backslash. Returns its text, or the error's message. */
  private escape(): { text: string } | { msg: string } {
    const { src } = this;
    const c = src[this.i];
    if (isLineEnd(c)) {
      this.newline();
      return { text: '' };
    }
    this.i++;
    const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' }[c as 'n'];
    if (simple !== undefined) return { text: simple };
    if (c === 'x') {
      const hex = src.slice(this.i, this.i + 2);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return { msg: 'Invalid hexadecimal escape sequence' };
      this.i += 2;
      return { text: String.fromCharCode(parseInt(hex, 16)) };
    }
    if (c === 'u') {
      if (src[this.i] === '{') {
        const close = src.indexOf('}', this.i);
        const hex = src.slice(this.i + 1, close);
        if (close < 0 || !/^[0-9a-fA-F]+$/.test(hex) || parseInt(hex, 16) > 0x10ffff) return { msg: 'Invalid Unicode escape sequence' };
        this.i = close + 1;
        return { text: String.fromCodePoint(parseInt(hex, 16)) };
      }
      const hex = src.slice(this.i, this.i + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { msg: 'Invalid Unicode escape sequence' };
      this.i += 4;
      return { text: String.fromCharCode(parseInt(hex, 16)) };
    }
    if (c >= '0' && c <= '7') {
      // Old-style octal escapes, and the plain \0.
      let v = c.charCodeAt(0) - 48;
      for (let n = 0; n < 2 && src[this.i] >= '0' && src[this.i] <= '7' && v * 8 + (src.charCodeAt(this.i) - 48) <= 255; n++) v = v * 8 + (src.charCodeAt(this.i++) - 48);
      return { text: String.fromCharCode(v) };
    }
    const point = src.codePointAt(this.i - 1)!;
    if (point > 0xffff) this.i++;
    return { text: String.fromCodePoint(point) };
  }

  private string(pos: Pos, nl: boolean, quote: string): Token {
    const { src } = this;
    this.i++;
    let out = '';
    for (;;) {
      if (this.i >= src.length || src[this.i] === '\n' || src[this.i] === '\r') return this.illegal(pos, 'Invalid or unexpected token', 'unterminated-string', nl);
      const c = src[this.i];
      if (c === quote) {
        this.i++;
        return { t: 'str', v: out, pos, end: this.i, nl };
      }
      if (c === '\\') {
        this.i++;
        if (this.i >= src.length) return this.illegal(pos, 'Invalid or unexpected token', 'unterminated-string', nl);
        const e = this.escape();
        if ('msg' in e) return this.illegal(pos, e.msg, 'bad-escape', nl);
        out += e.text;
      } else {
        out += c;
        this.i++;
      }
    }
  }

  /** The template text after a backtick or a `}`, up to `${` or the closing backtick. */
  templateChunk(): TemplateChunk {
    const { src } = this;
    const pos = this.here();
    let text = '';
    for (;;) {
      if (this.i >= src.length) return { text, done: true, bad: { t: 'eof', v: '', pos: this.here(), end: this.i, nl: false } };
      const c = src[this.i];
      if (c === '`') {
        this.i++;
        return { text, done: true };
      }
      if (c === '$' && src[this.i + 1] === '{') {
        this.i += 2;
        return { text, done: false };
      }
      if (c === '\\') {
        this.i++;
        if (this.i >= src.length) return { text, done: true, bad: { t: 'eof', v: '', pos: this.here(), end: this.i, nl: false } };
        const e = this.escape();
        if ('msg' in e) return { text, done: true, bad: this.illegal(pos, e.msg, 'bad-escape', false) };
        text += e.text;
      } else if (isLineEnd(c)) {
        text += c === '\r' ? '\n' : c;
        this.newline();
      } else {
        text += c;
        this.i++;
      }
    }
  }
}
