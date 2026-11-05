import { SyntaxStop, type Pos } from './errors';

export type TokKind = 'id' | 'kw' | 'int' | 'long' | 'double' | 'char' | 'string' | 'op' | 'eof';

export interface Tok {
  kind: TokKind;
  text: string;
  /** The value of a literal. */
  value?: number | string;
  pos: Pos;
  /** Just past the last character. */
  end: Pos;
}

export const KEYWORDS = new Set(
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'.split(
    ' ',
  ),
);

const OPS = ['>>>=', '<<=', '>>=', '>>>', '...', '->', '::', '++', '--', '&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>'];
const SINGLE = '(){}[];,.=<>!~?:+-*/&|^%@';

const stop = (code: string, msg: string, pos: Pos, help?: string): never => {
  throw new SyntaxStop({ code, msg, pos, help });
};

/** Turns one file into tokens. Comments and whitespace are dropped. */
export function lex(file: string, src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const here = (): Pos => ({ file, line, col: i - lineStart });
  const newline = () => {
    line++;
    lineStart = i + 1;
  };

  /** One character of a string or char literal, past the backslash if it has one. */
  const escape = (): string => {
    const pos = here();
    i++; // the backslash
    const c = src[i];
    const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', s: ' ', '0': '\0', '"': '"', "'": "'", '\\': '\\' };
    if (c === 'u') {
      let j = i;
      while (src[j] === 'u') j++;
      const hex = src.slice(j, j + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) stop('bad-escape', 'illegal unicode escape', pos);
      i = j + 4;
      return String.fromCharCode(parseInt(hex, 16));
    }
    if (c !== undefined && c in simple) {
      i++;
      return simple[c];
    }
    return stop('bad-escape', 'illegal escape character', pos, 'A backslash starts a special character, like \\n for a new line or \\" for a quote. To print a backslash, write \\\\.');
  };

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      newline();
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const pos = here();
      i += 2;
      for (;;) {
        if (i >= src.length) stop('unclosed-comment', 'unclosed comment', pos, 'A comment that starts with /* has to end with */.');
        if (src[i] === '*' && src[i + 1] === '/') break;
        if (src[i] === '\n') newline();
        i++;
      }
      i += 2;
      continue;
    }
    const pos = here();
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) i++;
      const text = src.slice(start, i);
      toks.push({ kind: KEYWORDS.has(text) ? 'kw' : 'id', text, pos, end: here() });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i;
      let kind: TokKind = 'int';
      let value = 0;
      if (c === '0' && /[xXbB]/.test(src[i + 1] ?? '')) {
        const hex = /[xX]/.test(src[i + 1]);
        i += 2;
        const digits = i;
        while (i < src.length && (hex ? /[0-9a-fA-F_]/ : /[01_]/).test(src[i])) i++;
        value = parseInt(src.slice(digits, i).replace(/_/g, ''), hex ? 16 : 2);
        if (value > 0xffffffff) stop('int-too-large', 'integer number too large', pos);
        value = value | 0;
      } else {
        while (i < src.length && /[0-9_]/.test(src[i])) i++;
        if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
          kind = 'double';
          i++;
          while (i < src.length && /[0-9_]/.test(src[i])) i++;
        } else if (src[i] === '.' && !/[A-Za-z_.]/.test(src[i + 1] ?? '')) {
          kind = 'double'; // "5." is a double.
          i++;
        }
        if (/[eE]/.test(src[i] ?? '') && /[0-9+-]/.test(src[i + 1] ?? '')) {
          kind = 'double';
          i += 2;
          while (i < src.length && /[0-9]/.test(src[i])) i++;
        }
        value = Number(src.slice(start, i).replace(/_/g, ''));
      }
      if (/[fF]/.test(src[i] ?? '')) stop('unsupported', 'this editor does not run float values', pos, 'Use double instead of float. AP CSA uses int, double, and boolean for numbers and true or false.');
      if (/[dD]/.test(src[i] ?? '')) {
        kind = 'double';
        i++;
      } else if (/[lL]/.test(src[i] ?? '')) {
        kind = 'long';
        i++;
      }
      if (kind === 'int' && value > 2147483648) stop('int-too-large', 'integer number too large', pos, 'An int can hold numbers up to 2147483647. This number is bigger than that.');
      toks.push({ kind, text: src.slice(start, i), value, pos, end: here() });
      continue;
    }
    if (c === '"') {
      if (src.startsWith('"""', i)) stop('unsupported', 'this editor does not run text blocks', pos, 'Write the text as a normal string, with \\n for a new line.');
      i++;
      let s = '';
      for (;;) {
        const ch = src[i];
        if (ch === undefined || ch === '\n')
          stop('unclosed-string', 'unclosed string literal', pos, 'Text in Java goes between two double quotes on the same line. This one has no closing ".');
        if (ch === '"') break;
        if (ch === '\\') s += escape();
        else {
          s += ch;
          i++;
        }
      }
      i++;
      toks.push({ kind: 'string', text: src.slice(pos.col + lineStart, i), value: s, pos, end: here() });
      continue;
    }
    if (c === "'") {
      i++;
      if (src[i] === "'") stop('bad-char', 'empty character literal', pos, 'A char holds one character between single quotes, like \'A\'.');
      if (src[i] === '\n' || src[i] === undefined) stop('bad-char', 'illegal line end in character literal', pos);
      let s: string;
      if (src[i] === '\\') s = escape();
      else s = src[i++];
      if (src[i] !== "'") stop('bad-char', 'unclosed character literal', pos, 'A char holds one character between single quotes. For text, use double quotes: "like this".');
      i++;
      toks.push({ kind: 'char', text: src.slice(pos.col + lineStart, i), value: s.charCodeAt(0), pos, end: here() });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      i += op.length;
      toks.push({ kind: 'op', text: op, pos, end: here() });
      continue;
    }
    if (SINGLE.includes(c)) {
      i++;
      toks.push({ kind: 'op', text: c, pos, end: here() });
      continue;
    }
    stop('bad-char', `illegal character: '${c}'`, pos, c === '“' || c === '”' || c === '‘' || c === '’' ? 'That is a curly quote from a word processor. Java only understands straight quotes: " and \'.' : undefined);
  }
  toks.push({ kind: 'eof', text: '', pos: here(), end: here() });
  return toks;
}
