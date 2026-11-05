import { elementsIn, parentElement, walkElements, type DomElement, type DomParent } from './tree';

/**
 * CSS selectors for `querySelector` and friends: tags, classes, ids, attributes,
 * the four combinators, commas, and the common pseudo-classes. A selector a
 * browser would refuse throws BadSelector, and one it would accept that this
 * file leaves out throws LeftOutSelector.
 */
export class BadSelector extends Error {}
export class LeftOutSelector extends Error {}

interface AttrTest {
  name: string;
  op?: string;
  value?: string;
}
type Pseudo = { p: 'first-child' | 'last-child' | 'only-child' | 'first-of-type' | 'last-of-type' | 'empty' | 'root' } | { p: 'nth-child' | 'nth-of-type' | 'nth-last-child'; a: number; b: number } | { p: 'not'; of: Selector };

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: AttrTest[];
  pseudos: Pseudo[];
}
type Combinator = ' ' | '>' | '+' | '~';
interface Complex {
  parts: Compound[];
  /** `links[i]` joins parts[i] and parts[i + 1]. */
  links: Combinator[];
}
export type Selector = Complex[];

const NAME_START = /[a-zA-Z_\u0080-￿-]/;
const NAME_PART = /[a-zA-Z0-9_\u0080-￿-]/;
const SPACE = /[ \t\n\f\r]/;

class Reader {
  at = 0;
  constructor(readonly s: string) {}

  look(): string | undefined {
    return this.s[this.at];
  }

  is(re: RegExp): boolean {
    const c = this.look();
    return c !== undefined && re.test(c);
  }

  bad(): never {
    throw new BadSelector(this.s);
  }

  spaces(): boolean {
    const from = this.at;
    while (this.is(SPACE)) this.at++;
    return this.at > from;
  }

  name(): string {
    const from = this.at;
    if (!this.is(NAME_START)) this.bad();
    if (this.look() === '-' && !(this.s[this.at + 1] && (NAME_START.test(this.s[this.at + 1]) || this.s[this.at + 1] === '-'))) this.bad();
    while (this.is(NAME_PART)) this.at++;
    return this.s.slice(from, this.at);
  }

  list(stop?: string): Selector {
    const out: Complex[] = [];
    while (true) {
      out.push(this.complex(stop));
      this.spaces();
      if (this.look() !== ',') break;
      this.at++;
    }
    return out;
  }

  private complex(stop?: string): Complex {
    this.spaces();
    const parts = [this.compound()];
    const links: Combinator[] = [];
    while (true) {
      const spaced = this.spaces();
      const c = this.look();
      if (c === undefined || c === ',' || c === stop) break;
      if (c === '>' || c === '+' || c === '~') {
        this.at++;
        this.spaces();
        links.push(c);
      } else if (spaced) links.push(' ');
      else this.bad();
      parts.push(this.compound());
    }
    return { parts, links };
  }

  private compound(): Compound {
    const c: Compound = { classes: [], attrs: [], pseudos: [] };
    const from = this.at;
    if (this.look() === '*') this.at++;
    else if (this.is(NAME_START)) c.tag = this.name();
    while (true) {
      const n = this.look();
      if (n === '#') {
        this.at++;
        c.id = this.name();
      } else if (n === '.') {
        this.at++;
        c.classes.push(this.name());
      } else if (n === '[') c.attrs.push(this.attr());
      else if (n === ':') c.pseudos.push(this.pseudo());
      else break;
    }
    if (this.at === from) this.bad();
    return c;
  }

  private attr(): AttrTest {
    this.at++;
    this.spaces();
    const name = this.name();
    this.spaces();
    if (this.look() === ']') {
      this.at++;
      return { name };
    }
    let op = '=';
    if (this.is(/[~|^$*]/)) {
      op = `${this.look()}=`;
      this.at++;
    }
    if (this.look() !== '=') this.bad();
    this.at++;
    this.spaces();
    let value: string;
    const q = this.look();
    if (q === '"' || q === "'") {
      const end = this.s.indexOf(q, this.at + 1);
      if (end < 0) this.bad();
      value = this.s.slice(this.at + 1, end);
      this.at = end + 1;
    } else value = this.name();
    this.spaces();
    if (this.look() !== ']') this.bad();
    this.at++;
    return { name, op, value };
  }

  private pseudo(): Pseudo {
    this.at++;
    if (this.look() === ':') throw new LeftOutSelector(this.s);
    const name = this.name().toLowerCase();
    if (name === 'not') {
      if (this.look() !== '(') this.bad();
      this.at++;
      const of = this.list(')');
      if (this.look() !== ')') this.bad();
      this.at++;
      return { p: 'not', of };
    }
    if (name === 'nth-child' || name === 'nth-of-type' || name === 'nth-last-child') {
      if (this.look() !== '(') this.bad();
      const end = this.s.indexOf(')', this.at);
      if (end < 0) this.bad();
      const m = /^\s*(?:(even)|(odd)|([+-]?\d*)n\s*(?:([+-])\s*(\d+))?|([+-]?\d+))\s*$/i.exec(this.s.slice(this.at + 1, end));
      if (!m) this.bad();
      this.at = end + 1;
      if (m[1]) return { p: name, a: 2, b: 0 };
      if (m[2]) return { p: name, a: 2, b: 1 };
      if (m[6] !== undefined) return { p: name, a: 0, b: Number(m[6]) };
      const a = m[3] === '' || m[3] === '+' ? 1 : m[3] === '-' ? -1 : Number(m[3]);
      return { p: name, a, b: m[5] ? Number(`${m[4]}${m[5]}`) : 0 };
    }
    if (name === 'first-child' || name === 'last-child' || name === 'only-child' || name === 'first-of-type' || name === 'last-of-type' || name === 'empty' || name === 'root') return { p: name };
    throw new LeftOutSelector(this.s);
  }
}

export function parseSelector(text: string): Selector {
  const r = new Reader(text);
  const list = r.list();
  r.spaces();
  if (r.look() !== undefined) r.bad();
  return list;
}

const siblings = (e: DomElement): DomElement[] => (e.parent ? elementsIn(e.parent) : [e]);

function nth(i: number, a: number, b: number): boolean {
  if (a === 0) return i === b;
  const n = (i - b) / a;
  return n >= 0 && Number.isInteger(n);
}

function matchPseudo(e: DomElement, p: Pseudo): boolean {
  const sibs = siblings(e);
  const typed = () => sibs.filter((x) => x.tag === e.tag);
  switch (p.p) {
    case 'first-child':
      return sibs[0] === e;
    case 'last-child':
      return sibs[sibs.length - 1] === e;
    case 'only-child':
      return sibs.length === 1;
    case 'first-of-type':
      return typed()[0] === e;
    case 'last-of-type':
      return typed().at(-1) === e;
    case 'empty':
      return !e.children.some((c) => c.kind !== 'comment');
    case 'root':
      return !parentElement(e) && e.parent?.kind === 'document';
    case 'nth-child':
      return nth(sibs.indexOf(e) + 1, p.a, p.b);
    case 'nth-last-child':
      return nth(sibs.length - sibs.indexOf(e), p.a, p.b);
    case 'nth-of-type':
      return nth(typed().indexOf(e) + 1, p.a, p.b);
    case 'not':
      return !matches(e, p.of);
  }
}

function matchAttr(e: DomElement, t: AttrTest): boolean {
  const v = e.attrs.get(t.name.toLowerCase());
  if (v === undefined) return false;
  const want = t.value ?? '';
  switch (t.op) {
    case undefined:
      return true;
    case '=':
      return v === want;
    case '~=':
      return v.split(/\s+/).includes(want);
    case '|=':
      return v === want || v.startsWith(`${want}-`);
    case '^=':
      return !!want && v.startsWith(want);
    case '$=':
      return !!want && v.endsWith(want);
    default:
      return !!want && v.includes(want);
  }
}

function matchCompound(e: DomElement, c: Compound): boolean {
  if (c.tag !== undefined && (e.ns === 'html' ? e.tag !== c.tag.toLowerCase() : e.tag !== c.tag)) return false;
  if (c.id !== undefined && e.attrs.get('id') !== c.id) return false;
  if (c.classes.length) {
    const have = (e.attrs.get('class') ?? '').split(/[ \t\n\f\r]+/);
    if (!c.classes.every((k) => have.includes(k))) return false;
  }
  return c.attrs.every((a) => matchAttr(e, a)) && c.pseudos.every((p) => matchPseudo(e, p));
}

function matchFrom(e: DomElement, c: Complex, i: number): boolean {
  if (!matchCompound(e, c.parts[i])) return false;
  if (i === 0) return true;
  const link = c.links[i - 1];
  if (link === '>') {
    const up = parentElement(e);
    return !!up && matchFrom(up, c, i - 1);
  }
  if (link === ' ') {
    for (let up = parentElement(e); up; up = parentElement(up)) if (matchFrom(up, c, i - 1)) return true;
    return false;
  }
  const sibs = siblings(e);
  const at = sibs.indexOf(e);
  if (link === '+') return at > 0 && matchFrom(sibs[at - 1], c, i - 1);
  return sibs.slice(0, at).some((x) => matchFrom(x, c, i - 1));
}

export const matches = (e: DomElement, s: Selector): boolean => s.some((c) => matchFrom(e, c, c.parts.length - 1));

/** Every element under `p` that matches, in document order. `counted` hears how many were looked at. */
export function selectAll(p: DomParent, s: Selector, counted?: (n: number) => void): DomElement[] {
  const out: DomElement[] = [];
  let n = 0;
  walkElements(p, (e) => {
    n++;
    if (matches(e, s)) out.push(e);
  });
  counted?.(n);
  return out;
}

export function selectFirst(p: DomParent, s: Selector, counted?: (n: number) => void): DomElement | null {
  let hit: DomElement | null = null;
  let n = 0;
  walkElements(p, (e) => {
    n++;
    if (!matches(e, s)) return false;
    hit = e;
    return true;
  });
  counted?.(n);
  return hit;
}

/** A selector that's one bare word, such as `li` or `title`: the word, or undefined. */
export function bareTag(text: string): string | undefined {
  return /^\s*[a-zA-Z][a-zA-Z0-9-]*\s*$/.test(text) ? text.trim() : undefined;
}
