/**
 * The page a student's code acts on: a small tree of elements and text, with no
 * browser behind it, so it runs in the same pure model as everything else. Every
 * run builds a new tree from the student's files. host.ts puts the JavaScript
 * face on it, html.ts reads HTML into it, and differential.test.ts holds the
 * two of them to a real DOM.
 */
export type Namespace = 'html' | 'svg' | 'math';

export class DomText {
  readonly kind = 'text';
  parent: DomParent | null = null;
  constructor(public data: string) {}
}

export class DomComment {
  readonly kind = 'comment';
  parent: DomParent | null = null;
  constructor(public data: string) {}
}

export class DomElement {
  readonly kind = 'element';
  parent: DomParent | null = null;
  children: DomNode[] = [];
  /** In document order, as a browser serializes them. */
  readonly attrs = new Map<string, string>();
  /** Came from the student's HTML file, not from their script. */
  original = false;
  constructor(
    /** Lowercase for HTML. SVG keeps its capitals: linearGradient. */
    public tag: string,
    public ns: Namespace = 'html',
  ) {}
}

/** Holds a list of nodes on its way to being added somewhere else. */
export class DomFragment {
  readonly kind = 'fragment';
  parent: null = null;
  children: DomNode[] = [];
}

export class DomDocument {
  readonly kind = 'document';
  parent: null = null;
  children: DomNode[] = [];
  doctype = false;
  /** No doctype, so a browser keeps an old quirk or two: `<table>` doesn't close a `<p>`. */
  quirks = true;

  get root(): DomElement {
    return this.children.find((c): c is DomElement => c.kind === 'element')!;
  }
  private part(tag: string): DomElement | undefined {
    return this.root?.children.find((c): c is DomElement => c.kind === 'element' && c.tag === tag);
  }
  get head(): DomElement {
    return this.part('head')!;
  }
  get body(): DomElement {
    return this.part('body')!;
  }
}

export type DomNode = DomElement | DomText | DomComment;
export type DomParent = DomElement | DomDocument | DomFragment;

export function detach(n: DomNode | DomElement): void {
  const p = n.parent;
  if (!p) return;
  p.children.splice(p.children.indexOf(n), 1);
  n.parent = null;
}

/** Adds `n` to `p`, before `before` if it's given. A node already somewhere else moves. */
export function insert(p: DomParent, n: DomNode, before?: DomNode | null): void {
  detach(n);
  if (before) p.children.splice(p.children.indexOf(before), 0, n);
  else p.children.push(n);
  n.parent = p;
}

export const elementsIn = (p: DomParent): DomElement[] => p.children.filter((c): c is DomElement => c.kind === 'element');

export function parentElement(n: DomNode): DomElement | null {
  return n.parent?.kind === 'element' ? n.parent : null;
}

/** Calls `f` on every element below `p`, in document order. `f` returning true stops the walk. */
export function walkElements(p: DomParent, f: (e: DomElement) => boolean | void): boolean {
  for (const c of p.children) {
    if (c.kind !== 'element') continue;
    if (f(c) || walkElements(c, f)) return true;
  }
  return false;
}

export function allElements(p: DomParent): DomElement[] {
  const out: DomElement[] = [];
  walkElements(p, (e) => void out.push(e));
  return out;
}

export function textOf(n: DomNode | DomParent): string {
  if (n.kind === 'text') return n.data;
  if (n.kind === 'comment') return '';
  let out = '';
  for (const c of n.children) if (c.kind !== 'comment') out += textOf(c);
  return out;
}

/** The node's top: a document, a fragment, or a loose element. */
export function rootOf(n: DomNode | DomParent): DomNode | DomParent {
  let at: DomNode | DomParent = n;
  while (at.parent) at = at.parent;
  return at;
}

export const isConnected = (n: DomNode): boolean => rootOf(n).kind === 'document';

export const VOID_TAGS = new Set(['area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** Their text is kept as it is, with nothing escaped. */
export const RAW_TEXT_TAGS = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

const NBSP = / /g;
export const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(NBSP, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(NBSP, '&nbsp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function serializeNode(n: DomNode, parent: DomParent | null, out: string[]): void {
  if (n.kind === 'text') {
    const raw = parent?.kind === 'element' && parent.ns === 'html' && RAW_TEXT_TAGS.has(parent.tag);
    out.push(raw ? n.data : escapeText(n.data));
  } else if (n.kind === 'comment') {
    out.push(`<!--${n.data}-->`);
  } else {
    out.push('<', n.tag);
    for (const [k, v] of n.attrs) out.push(' ', k, '="', escapeAttr(v), '"');
    out.push('>');
    if (n.ns === 'html' && VOID_TAGS.has(n.tag)) return;
    for (const c of n.children) serializeNode(c, n, out);
    out.push('</', n.tag, '>');
  }
}

/** A browser's `innerHTML` for this node. */
export function innerHtml(p: DomParent): string {
  const out: string[] = [];
  for (const c of p.children) serializeNode(c, p, out);
  return out.join('');
}

/** A browser's `outerHTML` for this element. */
export function outerHtml(e: DomElement): string {
  const out: string[] = [];
  serializeNode(e, null, out);
  return out.join('');
}
