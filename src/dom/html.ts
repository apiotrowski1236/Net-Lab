import { DomComment, DomDocument, DomElement, DomFragment, DomText, insert, RAW_TEXT_TAGS, VOID_TAGS, type DomNode, type DomParent, type Namespace } from './tree';

/**
 * Reads HTML the way a browser does: nothing is ever an error, and a tag left
 * open or a tag in the wrong place lands where the HTML standard says it lands.
 * `<li>` closes the `<li>` before it, `<p>` closes at the next block, a page
 * with no `<html>` or `<body>` gets them, and a `<tr>` in a table gets its
 * `<tbody>`. differential.test.ts compares the result with a real parser.
 *
 * Scripts are kept in the tree and never run. The interpreter runs the `.js`
 * files in their own order.
 *
 * Left out: the adoption agency's reshuffle for a formatting tag that crosses a
 * block, like `<b><p>one</b>two</p>`, frameset pages, and `<template>` contents.
 */

// --- reading tags ---

interface StartTag {
  t: 'start';
  name: string;
  attrs: [string, string][];
  selfClosing: boolean;
}
type Token = StartTag | { t: 'end'; name: string } | { t: 'text'; data: string } | { t: 'comment'; data: string } | { t: 'doctype'; html: boolean };

const SPACE = /[ \t\n\f\r]/;
const isLetter = (c: string | undefined) => !!c && /[a-zA-Z]/.test(c);

const NAMED: Record<string, string> = {
  amp: '&', not: '¬', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', times: '×', divide: '÷', deg: '°', laquo: '«', raquo: '»', cent: '¢', pound: '£', euro: '€', yen: '¥', sect: '§', para: '¶', larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', hearts: '♥', spades: '♠', clubs: '♣', diams: '♦', check: '✓', star: '☆', eacute: 'é', egrave: 'è', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä',
};
/** These work with no semicolon, for pages written long ago. */
const LEGACY = new Set(['amp', 'not', 'lt', 'gt', 'quot', 'nbsp', 'copy', 'reg', 'times', 'divide', 'deg', 'laquo', 'raquo', 'cent', 'pound', 'yen', 'sect', 'para', 'middot', 'eacute', 'egrave', 'ntilde', 'uuml', 'ouml', 'auml']);

function codePoint(n: number): string {
  if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) || Number.isNaN(n)) return '�';
  return String.fromCodePoint(n);
}

/** Turns `&amp;` and `&#39;` into their characters. An unknown name stays as it was written. */
export function decodeEntities(s: string, inAttribute = false): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([a-zA-Z][a-zA-Z0-9]*)(;?))/g, (all, hex?: string, dec?: string, name?: string, semi?: string, at?: number) => {
    if (hex) return codePoint(parseInt(hex, 16));
    if (dec) return codePoint(parseInt(dec, 10));
    if (semi && Object.prototype.hasOwnProperty.call(NAMED, name!)) return NAMED[name!];
    // Unknown, or no semicolon: the old names still match, even at the front of a longer word.
    const next = s[(at ?? 0) + all.length];
    for (let n = name!.length; n >= 2; n--) {
      const head = name!.slice(0, n);
      if (!LEGACY.has(head)) continue;
      const after = n < name!.length ? name![n] : semi ? ';' : next;
      if (inAttribute && (after === '=' || (after && /[a-zA-Z0-9]/.test(after)))) return all;
      return NAMED[head] + all.slice(n + 1);
    }
    return all;
  });
}

class Lexer {
  private at = 0;
  constructor(private readonly s: string) {}

  /** The text up to the matching end tag, for `<style>`, `<script>`, `<title>`, and `<textarea>`. */
  rawUntil(tag: string): string {
    const low = this.s.toLowerCase();
    let i = this.at;
    while (true) {
      i = low.indexOf(`</${tag}`, i);
      if (i < 0) {
        const text = this.s.slice(this.at);
        this.at = this.s.length;
        return text;
      }
      const after = this.s[i + tag.length + 2];
      if (after === undefined || after === '>' || after === '/' || SPACE.test(after)) break;
      i++;
    }
    const text = this.s.slice(this.at, i);
    this.at = i;
    return text;
  }

  /** Everything left, as text: what comes after `<plaintext>`. */
  rest(): string {
    const text = this.s.slice(this.at);
    this.at = this.s.length;
    return text;
  }

  skipNewline(): void {
    if (this.s[this.at] === '\n') this.at++;
    else if (this.s.startsWith('\r\n', this.at)) this.at += 2;
  }

  next(): Token | null {
    const { s } = this;
    if (this.at >= s.length) return null;
    if (s[this.at] !== '<') return this.text();
    const n = s[this.at + 1];
    if (isLetter(n)) return this.startTag();
    if (n === '/') {
      if (isLetter(s[this.at + 2])) return this.endTag();
      if (s[this.at + 2] === '>') {
        this.at += 3;
        return this.next();
      }
      if (this.at + 2 >= s.length) return this.text();
      return this.bogus(this.at + 2);
    }
    if (n === '!') {
      if (s.startsWith('--', this.at + 2)) return this.comment();
      if (s.slice(this.at + 2, this.at + 9).toLowerCase() === 'doctype') return this.doctype();
      return this.bogus(this.at + 2);
    }
    if (n === '?') return this.bogus(this.at + 1);
    return this.text();
  }

  private text(): Token {
    const { s } = this;
    let i = this.at + 1;
    while (i < s.length) {
      if (s[i] === '<') {
        const n = s[i + 1];
        if (isLetter(n) || n === '/' || n === '!' || n === '?') break;
      }
      i++;
    }
    const data = decodeEntities(s.slice(this.at, i));
    this.at = i;
    return { t: 'text', data };
  }

  private bogus(from: number): Token {
    const end = this.s.indexOf('>', from);
    const data = this.s.slice(from, end < 0 ? undefined : end);
    this.at = end < 0 ? this.s.length : end + 1;
    return { t: 'comment', data };
  }

  private comment(): Token {
    const { s } = this;
    const start = this.at + 4;
    if (s[start] === '>') {
      this.at = start + 1;
      return { t: 'comment', data: '' };
    }
    if (s.startsWith('->', start)) {
      this.at = start + 2;
      return { t: 'comment', data: '' };
    }
    const m = /--!?>/g;
    m.lastIndex = start;
    const hit = m.exec(s);
    if (!hit) {
      this.at = s.length;
      return { t: 'comment', data: s.slice(start) };
    }
    this.at = hit.index + hit[0].length;
    return { t: 'comment', data: s.slice(start, hit.index) };
  }

  private doctype(): Token {
    const end = this.s.indexOf('>', this.at);
    const body = this.s.slice(this.at + 9, end < 0 ? undefined : end);
    this.at = end < 0 ? this.s.length : end + 1;
    return { t: 'doctype', html: /^\s*html\s*$/i.test(body) };
  }

  private tagName(from: number): number {
    let i = from;
    while (i < this.s.length && !SPACE.test(this.s[i]) && this.s[i] !== '/' && this.s[i] !== '>') i++;
    return i;
  }

  private endTag(): Token | null {
    const nameEnd = this.tagName(this.at + 2);
    const name = this.s.slice(this.at + 2, nameEnd).toLowerCase();
    this.at = nameEnd;
    if (!this.attributes()) return null;
    return { t: 'end', name };
  }

  private startTag(): Token | null {
    const nameEnd = this.tagName(this.at + 1);
    const name = this.s.slice(this.at + 1, nameEnd).toLowerCase();
    this.at = nameEnd;
    const read = this.attributes();
    // The file ended in the middle of the tag, and a browser drops the whole tag.
    if (!read) return null;
    return { t: 'start', name, ...read };
  }

  /** Reads to the end of a tag. Null if the file ends first. */
  private attributes(): { attrs: [string, string][]; selfClosing: boolean } | null {
    const { s } = this;
    const attrs: [string, string][] = [];
    const seen = new Set<string>();
    let i = this.at;
    let selfClosing = false;
    while (true) {
      while (i < s.length && (SPACE.test(s[i]) || s[i] === '/')) {
        selfClosing = s[i] === '/' && s[i + 1] === '>';
        i++;
      }
      if (i >= s.length) {
        this.at = s.length;
        return null;
      }
      if (s[i] === '>') {
        this.at = i + 1;
        return { attrs, selfClosing };
      }
      const nameStart = i;
      i++;
      while (i < s.length && !SPACE.test(s[i]) && s[i] !== '/' && s[i] !== '>' && s[i] !== '=') i++;
      const name = s.slice(nameStart, i).toLowerCase();
      while (i < s.length && SPACE.test(s[i])) i++;
      let value = '';
      if (s[i] === '=') {
        i++;
        while (i < s.length && SPACE.test(s[i])) i++;
        const q = s[i];
        if (q === '"' || q === "'") {
          const end = s.indexOf(q, i + 1);
          if (end < 0) {
            this.at = s.length;
            return null;
          }
          value = s.slice(i + 1, end);
          i = end + 1;
        } else if (q !== '>') {
          const start = i;
          while (i < s.length && !SPACE.test(s[i]) && s[i] !== '>') i++;
          value = s.slice(start, i);
        }
      }
      if (!seen.has(name)) {
        seen.add(name);
        attrs.push([name, decodeEntities(value, true)]);
      }
    }
  }
}

// --- building the tree ---

const SPECIAL = new Set('address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp'.split(' '));
const IMPLIED_END = new Set(['dd', 'dt', 'li', 'optgroup', 'option', 'p', 'rb', 'rp', 'rt', 'rtc']);
/** A new one of these closes an open `<p>`. */
const CLOSES_P = new Set('address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer header hgroup main menu nav ol p search section summary ul'.split(' '));
const BLOCK_END = new Set('address article aside blockquote button center details dialog dir div dl fieldset figcaption figure footer header hgroup listing main menu nav ol pre search section select summary ul'.split(' '));
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const FORMATTING = new Set('a b big code em font i nobr s small strike strong tt u'.split(' '));
const IN_HEAD = new Set(['base', 'basefont', 'bgsound', 'link', 'meta', 'noframes', 'script', 'style', 'template', 'title']);
const SCOPE = new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template']);
const TABLE_SCOPE = new Set(['html', 'table', 'template']);
const TABLE_PARTS = new Set(['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']);
const BODY_IGNORES = new Set(['caption', 'col', 'colgroup', 'frame', 'head', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'frameset']);
const CELL_ENDS = new Set(['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']);
/** Inside `<svg>`, these snap back out to HTML. */
const BREAKOUT = new Set('b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var'.split(' '));
const SVG_TAGS = new Map('altGlyph altGlyphDef altGlyphItem animateColor animateMotion animateTransform clipPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject glyphRef linearGradient radialGradient textPath'.split(' ').map((n) => [n.toLowerCase(), n]));
const SVG_ATTRS = new Map('attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits diffuseConstant edgeMode filterUnits glyphRef gradientTransform gradientUnits kernelMatrix kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant specularExponent spreadMethod startOffset stdDeviation stitchTiles surfaceScale systemLanguage tableValues targetX targetY textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan'.split(' ').map((n) => [n.toLowerCase(), n]));

type Phase = 'start' | 'beforeHead' | 'inHead' | 'afterHead' | 'body' | 'afterBody' | 'afterAfterBody';
type Marker = null;

/** What a browser allows here. The options under a `<select>`, or the parts of a table. */
const isIntegration = (e: DomElement) => e.ns === 'svg' && (e.tag === 'foreignObject' || e.tag === 'desc' || e.tag === 'title');

class Builder {
  readonly stack: DomElement[] = [];
  private readonly lex: Lexer;
  private phase: Phase = 'start';
  private headEl?: DomElement;
  private bodyEl?: DomElement;
  private htmlEl?: DomElement;
  /** Tags like `<b>` still open, so the next text can pick them up again after a `</p>`. */
  private formatting: (DomElement | Marker)[] = [];
  private skipNewline = false;

  constructor(
    html: string,
    private readonly doc: DomDocument | undefined,
    private readonly fragment: DomFragment | undefined,
    private readonly quirks: boolean,
    /** Set by a host that wants to mark what it built. */
    private readonly fresh: (e: DomElement) => void,
    charge: (n: number) => void,
  ) {
    this.lex = new Lexer(html);
    charge(html.length >> 3);
  }

  private get cur(): DomElement {
    return this.stack[this.stack.length - 1];
  }

  private isTag(e: DomElement | undefined, tag: string): boolean {
    return !!e && e.ns === 'html' && e.tag === tag;
  }

  // --- the document ---

  document(): void {
    for (let tok = this.lex.next(); tok; tok = this.lex.next()) this.token(tok);
    this.finishDocument();
  }

  fragmentOf(context: DomElement): void {
    const root = new DomElement(context.tag, context.ns);
    this.stack.push(root);
    this.phase = 'body';
    if (context.ns === 'html' && (RAW_TEXT_TAGS.has(context.tag) || context.tag === 'title' || context.tag === 'textarea')) {
      const text = this.lex.rest();
      const data = context.tag === 'title' || context.tag === 'textarea' ? decodeEntities(text) : text;
      if (data) insert(root, new DomText(data));
    } else {
      for (let tok = this.lex.next(); tok; tok = this.lex.next()) this.token(tok);
    }
    const f = this.fragment!;
    for (const c of [...root.children]) insert(f, c);
  }

  private finishDocument(): void {
    if (this.phase === 'start') this.startHtml([]);
    if (this.phase === 'beforeHead') this.startHead([]);
    if (this.phase === 'inHead') this.endHead();
    if (this.phase === 'afterHead') this.startBody([]);
  }

  private make(name: string, attrs: [string, string][], ns: Namespace = 'html'): DomElement {
    const e = new DomElement(name, ns);
    for (const [k, v] of attrs) e.attrs.set(k, v);
    this.fresh(e);
    return e;
  }

  private startHtml(attrs: [string, string][]): void {
    const e = this.make('html', attrs);
    insert(this.doc!, e);
    this.htmlEl = e;
    this.stack.push(e);
    this.phase = 'beforeHead';
  }

  private startHead(attrs: [string, string][]): void {
    const e = this.make('head', attrs);
    insert(this.htmlEl!, e);
    this.headEl = e;
    this.stack.push(e);
    this.phase = 'inHead';
  }

  private endHead(): void {
    this.stack.pop();
    this.phase = 'afterHead';
  }

  private startBody(attrs: [string, string][]): void {
    const e = this.make('body', attrs);
    insert(this.htmlEl!, e);
    this.bodyEl = e;
    this.stack.push(e);
    this.phase = 'body';
  }

  private token(tok: Token): void {
    // A newline right after <pre> or <textarea> doesn't count.
    if (this.skipNewline) {
      this.skipNewline = false;
      if (tok.t === 'text' && tok.data[0] === '\n') {
        if (tok.data.length === 1) return;
        tok = { t: 'text', data: tok.data.slice(1) };
      }
    }
    switch (this.phase) {
      case 'start':
        return this.inStart(tok);
      case 'beforeHead':
        return this.inBeforeHead(tok);
      case 'inHead':
        return this.inHead(tok);
      case 'afterHead':
        return this.inAfterHead(tok);
      case 'afterBody':
      case 'afterAfterBody':
        return this.inAfterBody(tok);
      default:
        return this.inBody(tok);
    }
  }

  /** Splits white space off the front of a text token. Returns the rest. */
  private leadingSpace(tok: Token & { t: 'text' }): { space: string; rest: string } {
    const m = /^[ \t\n\f\r]*/.exec(tok.data)![0];
    return { space: m, rest: tok.data.slice(m.length) };
  }

  private inStart(tok: Token): void {
    if (tok.t === 'doctype') {
      this.doc!.doctype = true;
      this.doc!.quirks = !tok.html;
      return;
    }
    if (tok.t === 'comment') return insert(this.doc!, new DomComment(tok.data));
    if (tok.t === 'text') {
      const { rest } = this.leadingSpace(tok);
      if (!rest) return;
      tok = { t: 'text', data: rest };
    }
    if (tok.t === 'start' && tok.name === 'html') return this.startHtml(tok.attrs);
    if (tok.t === 'end' && !['head', 'body', 'html', 'br'].includes(tok.name)) return;
    this.startHtml([]);
    this.token(tok);
  }

  private inBeforeHead(tok: Token): void {
    if (tok.t === 'doctype') return;
    if (tok.t === 'comment') return insert(this.htmlEl!, new DomComment(tok.data));
    if (tok.t === 'text') {
      const { rest } = this.leadingSpace(tok);
      if (!rest) return;
      tok = { t: 'text', data: rest };
    }
    if (tok.t === 'start' && tok.name === 'html') return this.mergeAttrs(this.htmlEl!, tok.attrs);
    if (tok.t === 'start' && tok.name === 'head') return this.startHead(tok.attrs);
    if (tok.t === 'end' && !['head', 'body', 'html', 'br'].includes(tok.name)) return;
    this.startHead([]);
    this.token(tok);
  }

  private inHead(tok: Token): void {
    if (tok.t === 'doctype') return;
    if (tok.t === 'comment') return insert(this.cur, new DomComment(tok.data));
    if (tok.t === 'text') {
      const { space, rest } = this.leadingSpace(tok);
      if (space) this.addText(space);
      if (!rest) return;
      tok = { t: 'text', data: rest };
    }
    if (tok.t === 'start') {
      if (tok.name === 'html') return this.mergeAttrs(this.htmlEl!, tok.attrs);
      if (IN_HEAD.has(tok.name)) return this.headTag(tok);
      if (tok.name === 'head') return;
    }
    if (tok.t === 'end') {
      if (tok.name === 'head') return this.endHead();
      if (!['body', 'html', 'br'].includes(tok.name)) return;
    }
    this.endHead();
    this.token(tok);
  }

  private inAfterHead(tok: Token): void {
    if (tok.t === 'doctype') return;
    if (tok.t === 'comment') return insert(this.htmlEl!, new DomComment(tok.data));
    if (tok.t === 'text') {
      const { space, rest } = this.leadingSpace(tok);
      if (space) this.addText(space);
      if (!rest) return;
      tok = { t: 'text', data: rest };
    }
    if (tok.t === 'start') {
      if (tok.name === 'html') return this.mergeAttrs(this.htmlEl!, tok.attrs);
      if (tok.name === 'body') return this.startBody(tok.attrs);
      if (tok.name === 'frameset') return;
      if (tok.name === 'head') return;
      if (IN_HEAD.has(tok.name)) {
        this.stack.push(this.headEl!);
        this.headTag(tok);
        this.stack.splice(this.stack.indexOf(this.headEl!), 1);
        return;
      }
    }
    if (tok.t === 'end' && !['body', 'html', 'br'].includes(tok.name)) return;
    this.startBody([]);
    this.token(tok);
  }

  private inAfterBody(tok: Token): void {
    if (tok.t === 'doctype') return;
    if (tok.t === 'comment') {
      if (this.phase === 'afterBody') return insert(this.htmlEl!, new DomComment(tok.data));
      return insert(this.doc!, new DomComment(tok.data));
    }
    if (tok.t === 'text') {
      const { rest } = this.leadingSpace(tok);
      if (!rest) return this.addBodyText(tok.data);
      this.phase = 'body';
      return this.inBody(tok);
    }
    if (tok.t === 'start' && tok.name === 'html') return this.mergeAttrs(this.htmlEl!, tok.attrs);
    if (tok.t === 'end' && tok.name === 'html') {
      this.phase = 'afterAfterBody';
      return;
    }
    this.phase = 'body';
    this.inBody(tok);
  }

  private addBodyText(data: string): void {
    this.addText(data);
  }

  private mergeAttrs(e: DomElement, attrs: [string, string][]): void {
    for (const [k, v] of attrs) if (!e.attrs.has(k)) e.attrs.set(k, v);
  }

  /** `<title>`, `<style>`, `<script>`, `<meta>`, and `<link>`: they stay where they are, in the head or not. */
  private headTag(tok: StartTag): void {
    const e = this.make(tok.name, tok.attrs);
    insert(this.cur, e);
    if (VOID_TAGS.has(tok.name) || tok.name === 'template') return;
    const text = this.lex.rawUntil(tok.name);
    const data = tok.name === 'title' ? decodeEntities(text) : text;
    if (data) insert(e, new DomText(data));
    this.lex.next();
  }

  // --- helpers from the standard ---

  private inScope(match: (e: DomElement) => boolean, stops: Set<string> = SCOPE, extra?: string): DomElement | undefined {
    const base = this.fragment ? 1 : 0;
    for (let i = this.stack.length - 1; i >= base; i--) {
      const e = this.stack[i];
      if (match(e)) return e;
      if (e.ns === 'html' && (stops.has(e.tag) || e.tag === extra)) return undefined;
      if (e.ns === 'svg' && isIntegration(e)) return undefined;
    }
    return undefined;
  }

  private hasP(): boolean {
    return !!this.inScope((e) => this.isTag(e, 'p'), SCOPE, 'button');
  }

  private closeP(): void {
    if (!this.hasP()) return;
    this.impliedEnds('p');
    this.popTo((e) => this.isTag(e, 'p'));
  }

  private impliedEnds(except?: string): void {
    while (this.cur.ns === 'html' && IMPLIED_END.has(this.cur.tag) && this.cur.tag !== except && this.stack.length > 1) this.stack.pop();
  }

  private popTo(match: (e: DomElement) => boolean): void {
    while (this.stack.length > 1) {
      const e = this.stack.pop()!;
      if (match(e)) return;
    }
  }

  private place(e: DomNode): void {
    if (this.fostering()) {
      const table = [...this.stack].reverse().find((x) => this.isTag(x, 'table'));
      if (table?.parent) return insert(table.parent, e, table);
      if (!table) return insert(this.stack[0], e);
    }
    insert(this.cur, e);
  }

  /** The current node is part of a table, so anything else lands in front of the table. */
  private fostering(): boolean {
    return this.cur.ns === 'html' && ['table', 'tbody', 'tfoot', 'thead', 'tr'].includes(this.cur.tag);
  }

  private addText(data: string): void {
    const blank = !/[^ \t\n\f\r]/.test(data);
    const parent = this.fostering() && !blank ? this.fosterParent() : this.cur;
    const before = parent === this.cur ? undefined : this.fosterBefore();
    const siblings = parent.children;
    const last = before ? siblings[siblings.indexOf(before) - 1] : siblings[siblings.length - 1];
    if (last?.kind === 'text') last.data += data;
    else insert(parent, new DomText(data), before);
  }

  private fosterParent(): DomParent & DomElement {
    const table = [...this.stack].reverse().find((x) => this.isTag(x, 'table'));
    return (table?.parent as DomElement | null) ?? this.stack[0];
  }

  private fosterBefore(): DomNode | undefined {
    return [...this.stack].reverse().find((x) => this.isTag(x, 'table'));
  }

  private push(tok: StartTag, ns: Namespace = 'html'): DomElement {
    const e = this.make(tok.name, tok.attrs, ns);
    this.place(e);
    this.stack.push(e);
    return e;
  }

  /** A part of a table goes in the table, where anything else would land in front of it. */
  private pushHere(tok: StartTag): DomElement {
    const e = this.make(tok.name, tok.attrs);
    insert(this.cur, e);
    this.stack.push(e);
    return e;
  }

  private voidTag(tok: StartTag): void {
    this.place(this.make(tok.name, tok.attrs));
  }

  private rawTag(tok: StartTag): void {
    const e = this.push(tok);
    const text = this.lex.rawUntil(tok.name);
    const data = tok.name === 'title' || tok.name === 'textarea' ? decodeEntities(text) : text;
    if (data) insert(e, new DomText(data));
    this.lex.next();
    this.stack.pop();
  }

  private reconstruct(): void {
    const list = this.formatting;
    if (!list.length) return;
    let i = list.length - 1;
    const last = list[i];
    if (last === null || this.stack.includes(last)) return;
    while (i > 0) {
      const prev = list[i - 1];
      if (prev === null || this.stack.includes(prev)) break;
      i--;
    }
    for (; i < list.length; i++) {
      const old = list[i] as DomElement;
      const e = this.make(old.tag, [...old.attrs]);
      this.place(e);
      this.stack.push(e);
      list[i] = e;
    }
  }

  private clearToMarker(): void {
    while (this.formatting.length && this.formatting.pop() !== null);
  }

  private formattingNamed(name: string): DomElement | undefined {
    for (let i = this.formatting.length - 1; i >= 0; i--) {
      const f = this.formatting[i];
      if (f === null) return undefined;
      if (f.tag === name) return f;
    }
    return undefined;
  }

  private dropFormatting(e: DomElement): void {
    const i = this.formatting.indexOf(e);
    if (i >= 0) this.formatting.splice(i, 1);
  }

  /** The element a foreign (svg) token should be judged by. */
  private inForeign(): boolean {
    const c = this.cur;
    return !!c && c.ns !== 'html' && !isIntegration(c);
  }

  private foreignStart(tok: StartTag): void {
    if (BREAKOUT.has(tok.name) || (tok.name === 'font' && tok.attrs.some(([k]) => k === 'color' || k === 'face' || k === 'size'))) {
      if (this.fragment && this.stack.length === 1) {
        // Inside `svg.innerHTML`, there's nothing to break out to.
      } else {
        while (this.inForeign() && this.stack.length > 1) this.stack.pop();
        return this.bodyStart(tok);
      }
    }
    const ns = this.cur.ns;
    const name = ns === 'svg' ? (SVG_TAGS.get(tok.name) ?? tok.name) : tok.name;
    const attrs = tok.attrs.map(([k, v]): [string, string] => [ns === 'svg' ? (SVG_ATTRS.get(k) ?? k) : k, v]);
    const e = this.make(name, attrs, ns);
    this.place(e);
    if (!tok.selfClosing) this.stack.push(e);
  }

  private foreignEnd(name: string): void {
    for (let i = this.stack.length - 1; i > 0; i--) {
      const e = this.stack[i];
      if (e.ns === 'html') break;
      if (e.tag.toLowerCase() === name) {
        this.stack.length = i;
        return;
      }
    }
    this.bodyEnd(name);
  }

  // --- the body ---

  private inBody(tok: Token): void {
    switch (tok.t) {
      case 'doctype':
        return;
      case 'comment':
        return insert(this.cur, new DomComment(tok.data));
      case 'text': {
        const blank = !/[^ \t\n\f\r]/.test(tok.data);
        if (!blank) {
          this.reconstruct();
        }
        return this.addText(tok.data);
      }
      case 'start':
        return this.inForeign() ? this.foreignStart(tok) : this.bodyStart(tok);
      default:
        return this.inForeign() ? this.foreignEnd(tok.name) : this.bodyEnd(tok.name);
    }
  }

  private frameIn(): void {
    /* A hook for frameset pages, which this parser leaves out. */
  }

  private inSelect(): boolean {
    return !!this.inScope((e) => this.isTag(e, 'select'), new Set(['html', 'table', 'td', 'th', 'caption']));
  }

  private tableMode(): 'table' | 'section' | 'row' | 'colgroup' | undefined {
    const c = this.cur;
    if (c.ns !== 'html') return undefined;
    if (c.tag === 'table') return 'table';
    if (c.tag === 'tbody' || c.tag === 'thead' || c.tag === 'tfoot') return 'section';
    if (c.tag === 'tr') return 'row';
    if (c.tag === 'colgroup') return 'colgroup';
    return undefined;
  }

  /** Tags that mean something inside a table. Returns true once the tag is dealt with. */
  private tableStart(tok: StartTag): boolean {
    const mode = this.tableMode();
    const name = tok.name;
    if (mode === 'row') {
      if (name === 'td' || name === 'th') {
        this.pushHere(tok);
        this.formatting.push(null);
        return true;
      }
      if (CELL_ENDS.has(name)) {
        if (this.stack.length === 1 && this.fragment) return true;
        this.stack.pop();
        this.bodyStart(tok);
        return true;
      }
      return false;
    }
    if (mode === 'section') {
      if (name === 'tr') {
        this.pushHere(tok);
        return true;
      }
      if (name === 'td' || name === 'th') {
        this.pushHere({ t: 'start', name: 'tr', attrs: [], selfClosing: false });
        this.bodyStart(tok);
        return true;
      }
      if (CELL_ENDS.has(name)) {
        if (this.stack.length === 1 && this.fragment) return true;
        this.stack.pop();
        this.bodyStart(tok);
        return true;
      }
      return false;
    }
    if (mode === 'table') {
      if (name === 'caption') {
        this.pushHere(tok);
        this.formatting.push(null);
        return true;
      }
      if (name === 'colgroup' || name === 'tbody' || name === 'thead' || name === 'tfoot') {
        this.pushHere(tok);
        return true;
      }
      if (name === 'col') {
        this.pushHere({ t: 'start', name: 'colgroup', attrs: [], selfClosing: false });
        this.bodyStart(tok);
        return true;
      }
      if (name === 'tr' || name === 'td' || name === 'th') {
        this.pushHere({ t: 'start', name: 'tbody', attrs: [], selfClosing: false });
        this.bodyStart(tok);
        return true;
      }
      if (name === 'table') {
        this.stack.pop();
        this.bodyStart(tok);
        return true;
      }
      if (name === 'style' || name === 'script' || name === 'template') {
        this.headTag(tok);
        return true;
      }
      if (name === 'input' && tok.attrs.some(([k, v]) => k === 'type' && v.toLowerCase() === 'hidden')) {
        insert(this.cur, this.make(tok.name, tok.attrs));
        return true;
      }
      return false;
    }
    if (mode === 'colgroup') {
      if (name === 'col') {
        insert(this.cur, this.make(tok.name, tok.attrs));
        return true;
      }
      if (this.stack.length === 1 && this.fragment) return true;
      this.stack.pop();
      this.bodyStart(tok);
      return true;
    }
    return false;
  }

  private closeCell(): boolean {
    const cell = this.inScope((e) => this.isTag(e, 'td') || this.isTag(e, 'th'), TABLE_SCOPE);
    if (!cell) return false;
    this.impliedEnds();
    this.popTo((e) => e === cell);
    this.clearToMarker();
    return true;
  }

  private bodyStart(tok: StartTag): void {
    if (this.inForeign()) return this.foreignStart(tok);
    const { name } = tok;
    if (this.tableStart(tok)) return;
    // A new cell or row closes the cell it's in.
    if (CELL_ENDS.has(name) && this.inScope((e) => this.isTag(e, 'td') || this.isTag(e, 'th'), TABLE_SCOPE)) {
      this.closeCell();
      return this.bodyStart(tok);
    }
    if (CELL_ENDS.has(name) && this.inScope((e) => this.isTag(e, 'caption'), TABLE_SCOPE)) {
      this.impliedEnds();
      this.popTo((e) => this.isTag(e, 'caption'));
      this.clearToMarker();
      return this.bodyStart(tok);
    }
    if (this.inSelect()) return this.selectStart(tok);
    if (name === 'html') return this.mergeAttrs(this.stack[0], tok.attrs);
    if (name === 'body') {
      if (this.bodyEl) this.mergeAttrs(this.bodyEl, tok.attrs);
      return;
    }
    if (IN_HEAD.has(name)) return this.headTag(tok);
    if (BODY_IGNORES.has(name)) return;

    if (CLOSES_P.has(name)) {
      this.closeP();
      this.push(tok);
      return;
    }
    if (HEADINGS.has(name)) {
      this.closeP();
      if (this.cur.ns === 'html' && HEADINGS.has(this.cur.tag)) this.stack.pop();
      this.push(tok);
      return;
    }
    if (name === 'pre' || name === 'listing') {
      this.closeP();
      this.push(tok);
      this.skipNewline = true;
      return;
    }
    if (name === 'form') {
      if (this.stack.some((e) => this.isTag(e, 'form'))) return;
      this.closeP();
      this.push(tok);
      return;
    }
    if (name === 'li' || name === 'dd' || name === 'dt') return this.listItem(tok);
    if (name === 'plaintext') {
      this.closeP();
      const e = this.push(tok);
      const rest = this.lex.rest();
      if (rest) insert(e, new DomText(rest));
      return;
    }
    if (name === 'button') {
      if (this.inScope((e) => this.isTag(e, 'button'))) {
        this.impliedEnds();
        this.popTo((e) => this.isTag(e, 'button'));
      }
      this.reconstruct();
      this.push(tok);
      return;
    }
    if (FORMATTING.has(name)) {
      if (name === 'a') {
        const open = this.formattingNamed('a');
        if (open) {
          if (this.stack.includes(open)) this.popTo((e) => e === open);
          this.dropFormatting(open);
        }
      }
      this.reconstruct();
      const e = this.push(tok);
      this.formatting.push(e);
      return;
    }
    if (name === 'applet' || name === 'marquee' || name === 'object') {
      this.reconstruct();
      this.push(tok);
      this.formatting.push(null);
      return;
    }
    if (name === 'table') {
      if (!this.quirks) this.closeP();
      this.push(tok);
      return;
    }
    if (name === 'hr') {
      this.closeP();
      this.voidTag(tok);
      return;
    }
    if (name === 'image') return this.bodyStart({ ...tok, name: 'img' });
    if (VOID_TAGS.has(name)) {
      this.reconstruct();
      this.voidTag(tok);
      return;
    }
    if (name === 'textarea') {
      const e = this.push(tok);
      this.lex.skipNewline();
      const text = decodeEntities(this.lex.rawUntil('textarea'));
      if (text) insert(e, new DomText(text));
      this.lex.next();
      this.stack.pop();
      return;
    }
    if (name === 'xmp') {
      this.closeP();
      this.reconstruct();
      return this.rawTag(tok);
    }
    if (name === 'iframe' || name === 'noembed') return this.rawTag(tok);
    if (name === 'option' || name === 'optgroup') {
      if (this.isTag(this.cur, 'option')) this.stack.pop();
      this.reconstruct();
      this.push(tok);
      return;
    }
    if (name === 'svg' || name === 'math') {
      this.reconstruct();
      const ns: Namespace = name;
      const attrs = tok.attrs.map(([k, v]): [string, string] => [ns === 'svg' ? (SVG_ATTRS.get(k) ?? k) : k, v]);
      const e = this.make(name, attrs, ns);
      this.place(e);
      if (!tok.selfClosing) this.stack.push(e);
      return;
    }
    this.reconstruct();
    this.push(tok);
  }

  private selectStart(tok: StartTag): void {
    const { name } = tok;
    if (name === 'option') {
      if (this.isTag(this.cur, 'option')) this.stack.pop();
      this.push(tok);
    } else if (name === 'optgroup') {
      if (this.isTag(this.cur, 'option')) this.stack.pop();
      if (this.isTag(this.cur, 'optgroup')) this.stack.pop();
      this.push(tok);
    } else if (name === 'hr') {
      if (this.isTag(this.cur, 'option')) this.stack.pop();
      if (this.isTag(this.cur, 'optgroup')) this.stack.pop();
      insert(this.cur, this.make(name, tok.attrs));
    } else if (name === 'select') {
      this.popTo((e) => this.isTag(e, 'select'));
    } else if (name === 'input' || name === 'textarea') {
      this.popTo((e) => this.isTag(e, 'select'));
      this.bodyStart(tok);
    } else if (name === 'script' || name === 'template') {
      this.headTag(tok);
    }
  }

  private listItem(tok: StartTag): void {
    const same = tok.name === 'li' ? ['li'] : ['dd', 'dt'];
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const e = this.stack[i];
      if (e.ns === 'html' && same.includes(e.tag)) {
        this.impliedEnds(e.tag);
        this.popTo((x) => x === e);
        break;
      }
      if (e.ns === 'html' && SPECIAL.has(e.tag) && !['address', 'div', 'p'].includes(e.tag)) break;
    }
    this.closeP();
    this.push(tok);
  }

  private bodyEnd(name: string): void {
    if (name === 'body' || name === 'html') {
      if (this.fragment || !this.bodyEl) return;
      this.phase = 'afterBody';
      if (name === 'html') this.phase = 'afterAfterBody';
      return;
    }
    if (name === 'p') {
      if (!this.hasP()) this.bodyStart({ t: 'start', name: 'p', attrs: [], selfClosing: false });
      this.closeP();
      return;
    }
    if (name === 'br') return this.bodyStart({ t: 'start', name: 'br', attrs: [], selfClosing: false });
    if (name === 'li') {
      if (!this.inScope((e) => this.isTag(e, 'li'), SCOPE, 'ol') || !this.inScope((e) => this.isTag(e, 'li'), SCOPE, 'ul')) return;
      this.impliedEnds('li');
      this.popTo((e) => this.isTag(e, 'li'));
      return;
    }
    if (name === 'dd' || name === 'dt') {
      if (!this.inScope((e) => this.isTag(e, name))) return;
      this.impliedEnds(name);
      this.popTo((e) => this.isTag(e, name));
      return;
    }
    if (HEADINGS.has(name)) {
      if (!this.inScope((e) => e.ns === 'html' && HEADINGS.has(e.tag))) return;
      this.impliedEnds();
      this.popTo((e) => e.ns === 'html' && HEADINGS.has(e.tag));
      return;
    }
    if (name === 'td' || name === 'th') {
      const cell = this.inScope((e) => this.isTag(e, name), TABLE_SCOPE);
      if (!cell) return;
      this.impliedEnds();
      this.popTo((e) => e === cell);
      this.clearToMarker();
      return;
    }
    if (name === 'caption') {
      if (!this.inScope((e) => this.isTag(e, 'caption'), TABLE_SCOPE)) return;
      this.impliedEnds();
      this.popTo((e) => this.isTag(e, 'caption'));
      this.clearToMarker();
      return;
    }
    if (name === 'tr' || name === 'tbody' || name === 'thead' || name === 'tfoot' || name === 'table' || name === 'colgroup') {
      const open = this.inScope((e) => this.isTag(e, name), TABLE_SCOPE);
      if (!open) return;
      this.closeCell();
      this.popTo((e) => e === open);
      return;
    }
    if (TABLE_PARTS.has(name)) return;
    if (name === 'applet' || name === 'marquee' || name === 'object') {
      if (!this.inScope((e) => this.isTag(e, name))) return;
      this.impliedEnds();
      this.popTo((e) => this.isTag(e, name));
      this.clearToMarker();
      return;
    }
    if (BLOCK_END.has(name) || name === 'form') {
      if (!this.inScope((e) => this.isTag(e, name))) return;
      this.impliedEnds();
      this.popTo((e) => this.isTag(e, name));
      return;
    }
    if (FORMATTING.has(name)) {
      const f = this.formattingNamed(name);
      if (f) {
        if (!this.stack.includes(f)) return this.dropFormatting(f);
        if (!this.inScope((e) => e === f)) return;
        // The standard's adoption agency reshuffles here when a block sits inside. This parser closes it.
        this.popTo((e) => e === f);
        this.dropFormatting(f);
        return;
      }
    }
    for (let i = this.stack.length - 1; i >= (this.fragment ? 1 : 0); i--) {
      const e = this.stack[i];
      if (e.ns === 'html' && e.tag === name) {
        this.impliedEnds(name);
        this.popTo((x) => x === e);
        return;
      }
      if (e.ns === 'html' && SPECIAL.has(e.tag)) return;
    }
  }
}

export interface ParseOptions {
  /** Called on each element as it's made. */
  fresh?: (e: DomElement) => void;
  /** Counts work against the program's budget. */
  charge?: (n: number) => void;
}

const none = () => undefined;

/** Reads a whole page. */
export function parseHtml(html: string, options: ParseOptions = {}): DomDocument {
  const doc = new DomDocument();
  const normal = html.replace(/\r\n?/g, '\n');
  // No doctype so far, so quirks until the builder sees one.
  const b = new Builder(normal, doc, undefined, !/^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype\s+html\s*>/i.test(normal), options.fresh ?? none, options.charge ?? none);
  b.document();
  return doc;
}

/** Reads what goes into `innerHTML`: the result depends on the element it lands in. */
export function parseFragment(html: string, context: DomElement, quirks: boolean, options: ParseOptions = {}): DomFragment {
  const fragment = new DomFragment();
  const normal = html.replace(/\r\n?/g, '\n');
  const b = new Builder(normal, undefined, fragment, quirks, options.fresh ?? none, options.charge ?? none);
  b.fragmentOf(context);
  return fragment;
}
